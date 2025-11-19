/**
 * Background Worker Service
 *
 * Handles:
 * - Stripe webhook processing
 * - Email sending
 * - Push notifications
 * - Long-running async tasks
 * - Job queuing and retries
 */

const { TOPICS } = require('../lib/message-bus');
const db = require('../db-wrapper');
const {
  SUPPORTER_BADGE_CODE,
  SUPPORTER_BADGE_CODE_PREMIUM
} = require('../lib/supporter-config');
const defaultMailService = require('../mail-service');
const pushServiceModule = require('../lib/push-service');

function nowIso() {
  return new Date().toISOString();
}

class WorkerService {
  constructor(config, messageBus) {
    this.config = config;
    this.messageBus = messageBus;

    // Job queue for resilience
    this.jobQueue = [];
    this.activeJobs = new Set();
    this.completedJobs = new Map();

    // Worker configuration
    this.maxRetries = 3;
    this.retryDelayMs = 1000;
    this.maxConcurrency = Math.max(1, Number(config.WORKER_CONCURRENCY || config.WORKER_MAX_CONCURRENCY || 4));
    this.jobTimeoutMs = Math.max(1000, Number(config.WORKER_JOB_TIMEOUT_MS || 15000));
    this.processingInterval = Math.max(250, Number(config.WORKER_INTERVAL_MS || 1000)); // tighter loop for bursts
    this.processing = false;

    // Processing loop
    this.processingLoop = null;

    // Service references (injected later)
    this.stripe = null;
    this.mailService = defaultMailService;
    this.pushService = pushServiceModule;

    // Bind methods
    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);
    this.enqueueJob = this.enqueueJob.bind(this);
    this.processQueue = this.processQueue.bind(this);
  }

  /**
   * Start the worker service
   */
  async start() {
    console.log('[Worker] Service starting...');

    // Subscribe to relevant topics
    this.messageBus.subscribe(TOPICS.STRIPE_WEBHOOK, async (event) => {
      await this.handleStripeWebhook(event);
    });

    this.messageBus.subscribe(TOPICS.USER_REGISTERED, async (event) => {
      await this.handleUserRegistered(event);
    });

    this.messageBus.subscribe(TOPICS.USER_VERIFIED, async (event) => {
      await this.handleUserVerified(event);
    });

    this.messageBus.subscribe(TOPICS.PUSH_SEND, async (event) => {
      await this.handlePushNotification(event);
    });

    this.messageBus.subscribe(TOPICS.MESSAGE_SENT, async (event) => {
      await this.handleMessageSent(event);
    });

    this.messageBus.subscribe(TOPICS.USER_PASSWORD_RESET, async (event) => {
      await this.handlePasswordResetRequested(event);
    });

    this.messageBus.subscribe(TOPICS.NEARBY_LISTING_AVAILABLE, async (event) => {
      await this.handleNearbyListing(event);
    });

    // Start job processor
    this.processingLoop = setInterval(() => {
      this.processQueue().catch(err => {
        console.error('[Worker] Error processing queue:', err);
      });
    }, this.processingInterval);

    if (typeof this.processingLoop.unref === 'function') {
      this.processingLoop.unref();
    }

    console.log('[Worker] Service started');
  }

  /**
   * Stop the worker service
   */
  async stop() {
    if (this.processingLoop) {
      clearInterval(this.processingLoop);
      this.processingLoop = null;
    }

    // Wait for active jobs to complete (with timeout)
    const timeout = 30000; // 30 seconds
    const start = Date.now();
    while (this.activeJobs.size > 0 && Date.now() - start < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (this.activeJobs.size > 0) {
      console.warn(`[Worker] ${this.activeJobs.size} jobs still active after timeout`);
    }

    console.log('[Worker] Service stopped');
  }

  /**
   * Enqueue a job for processing
   */
  async enqueueJob(job) {
    const jobId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const wrappedJob = {
      id: jobId,
      type: job.type,
      payload: job.payload,
      retries: 0,
      maxRetries: job.maxRetries || this.maxRetries,
      createdAt: Date.now(),
      priority: job.priority || 0
    };

    this.jobQueue.push(wrappedJob);

    // Sort by priority (higher first)
    this.jobQueue.sort((a, b) => b.priority - a.priority);

    console.log(`[Worker] Job queued: ${jobId} (type: ${job.type})`);
    // Kick the processor quickly instead of waiting for the next interval tick
    this.processQueue().catch(err => {
      console.error('[Worker] Failed to start queue processor:', err);
    });
    return jobId;
  }

  /**
   * Process queued jobs
   */
  async processQueue() {
    if (this.processing) return;
    this.processing = true;

    try {
      // Launch jobs up to the configured concurrency
      while (this.jobQueue.length > 0 && this.activeJobs.size < this.maxConcurrency) {
        const job = this.jobQueue.shift();
        if (!job || this.activeJobs.has(job.id)) {
          continue;
        }
        this.activeJobs.add(job.id);
        this._runJob(job).catch((err) => {
          console.error(`[Worker] Unhandled job error (${job.id}):`, err?.message || err);
        });
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Run a single job with timeout and retry handling
   */
  async _runJob(job) {
    const timeoutMs = Math.max(500, Number(job.timeoutMs || this.jobTimeoutMs));
    let timer = null;

    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`job_timeout:${job.type}`));
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    });

    try {
      const result = await Promise.race([
        this.processJob(job),
        timeoutPromise
      ]);

      this.completedJobs.set(job.id, {
        status: 'success',
        completedAt: Date.now(),
        result
      });
    } catch (err) {
      console.error(`[Worker] Job failed: ${job.id}`, err?.message || err);

      if (job.retries < job.maxRetries) {
        job.retries++;
        this.jobQueue.push(job);
        // Keep queue ordered after requeue
        this.jobQueue.sort((a, b) => b.priority - a.priority);
        console.log(`[Worker] Job requeued: ${job.id} (attempt ${job.retries + 1}/${job.maxRetries + 1})`);
      } else {
        this.completedJobs.set(job.id, {
          status: 'failed',
          error: err?.message || 'unknown_error',
          completedAt: Date.now()
        });
        console.error(`[Worker] Job failed permanently: ${job.id}`);
      }
    } finally {
      if (timer) clearTimeout(timer);
      this.activeJobs.delete(job.id);
      // Continue draining after this job completes
      this.processQueue().catch((err) => {
        console.error('[Worker] Failed to continue draining queue:', err?.message || err);
      });
    }
  }

  /**
   * Process individual job
   */
  async processJob(job) {
    switch (job.type) {
      case 'send_email':
        return await this.sendEmail(job.payload);
      case 'send_push':
        return await this.sendPushNotification(job.payload);
      case 'process_stripe_event':
        return await this.processStripeEvent(job.payload);
      case 'notify_nearby_listing':
        return await this.notifyNearbyListing(job.payload);
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
  }

  /**
   * Handle Stripe webhook
   */
  async handleStripeWebhook(event) {
    if (!event || !event.type) return;

    await this.enqueueJob({
      type: 'process_stripe_event',
      payload: event,
      priority: 10 // High priority
    });
  }

  /**
   * Handle user registered event
   */
  async handleUserRegistered(event) {
    const { userId, email, verificationCode } = event || {};
    if (!email || !verificationCode) {
      return;
    }

    // Enqueue verification email
    await this.enqueueJob({
      type: 'send_email',
      payload: {
        to: email,
        template: 'verification',
        userId,
        code: verificationCode
      }
    });
  }

  /**
   * Handle user verified event
   */
  async handleUserVerified(event) {
    const { userId, email } = event;

    // Enqueue welcome email
    await this.enqueueJob({
      type: 'send_email',
      payload: {
        to: email,
        template: 'welcome',
        userId
      }
    });
  }

  /**
   * Handle push notification request
   */
  async handlePushNotification(event) {
    await this.enqueueJob({
      type: 'send_push',
      payload: event,
      priority: 5 // Medium priority
    });
  }

  /**
   * Handle password reset request events
   */
  async handlePasswordResetRequested(event) {
    if (!event || !event.email || !event.token) return;

    await this.enqueueJob({
      type: 'send_email',
      payload: {
        to: event.email,
        template: 'password_reset',
        token: event.token
      },
      priority: 8
    });
  }

  /**
   * Handle nearby listing notifications
   */
  async handleNearbyListing(event) {
    if (!event || !event.listing) return;

    await this.enqueueJob({
      type: 'notify_nearby_listing',
      payload: event.listing,
      priority: 4
    });
  }

  /**
   * Handle chat message events for push notifications
   */
  async handleMessageSent(event) {
    if (!event || !event.recipientId) {
      return;
    }

    const payload = this.buildMessagePushPayload(event);
    if (!payload) {
      return;
    }

    await this.enqueueJob({
      type: 'send_push',
      payload: {
        userId: event.recipientId,
        notification: payload
      },
      priority: 5
    });
  }

  buildMessagePushPayload(event) {
    if (!event || !event.message) return null;

    const hasImages = Array.isArray(event.message.images) && event.message.images.length > 0;
    const senderName = event.senderUsername || event.message.sender_username || null;
    const body = typeof event.preview === 'string'
      ? event.preview
      : (typeof event.message.body === 'string' ? event.message.body.slice(0, 160) : '');

    return {
      type: 'new_message',
      conversation_id: event.conversationId,
      message_id: event.message.id,
      sender_id: event.senderId,
      sender_username: senderName,
      sender_name: senderName,
      listing_id: event.listingId || null,
      body,
      has_images: hasImages,
      created_at: event.message.created_at
    };
  }

  /**
   * Notify users about nearby listings
   */
  async notifyNearbyListing(listing) {
    if (!this.pushService || typeof this.pushService.notifyNearbyListing !== 'function') {
      throw new Error('Push service not available');
    }
    if (!listing) return;
    await this.pushService.notifyNearbyListing(listing);
  }

  /**
   * Send email
   */
  async sendEmail({ to, template, code, token }) {
    if (!this.mailService) {
      throw new Error('Mail service not available');
    }

    if (!to || !template) return;

    if (template === 'verification') {
      if (!code) {
        throw new Error('Verification code missing');
      }
      await this.mailService.sendVerificationEmail(to, code);
      return;
    }

    if (template === 'password_reset') {
      if (!token) {
        throw new Error('Password reset token missing');
      }
      await this.mailService.sendPasswordResetEmail(to, token);
      return;
    }

    console.warn(`[Worker] Unknown email template "${template}" - skipping`);
  }

  /**
   * Send push notification
   */
  async sendPushNotification(payload) {
    if (!this.pushService || typeof this.pushService.sendPushToUser !== 'function') {
      throw new Error('Push service not available');
    }

    if (!payload || !payload.userId || !payload.notification) return;

    await this.pushService.sendPushToUser(
      payload.userId,
      payload.notification,
      payload.options || {}
    );
  }

  /**
   * Process Stripe event
   */
  async processStripeEvent(event = {}) {
    const type = event.type;
    const payload = event.data || event.payload;

    if (!type || !payload) {
      console.warn('[Worker] Received malformed Stripe event payload');
      return;
    }

    console.log(`[Worker] Processing Stripe event: ${type}`);
    switch (type) {
      case 'checkout.session.completed':
        return await this.handleCheckoutSessionCompleted(payload);
      case 'customer.subscription.created':
        return await this.handleSubscriptionCreated(payload);
      case 'customer.subscription.updated':
        return await this.handleSubscriptionUpdated(payload);
      case 'customer.subscription.deleted':
        return await this.handleSubscriptionDeleted(payload);
      case 'invoice.payment_succeeded':
        return await this.handleInvoicePaymentSucceeded(payload);
      case 'invoice.payment_failed':
        return await this.handleInvoicePaymentFailed(payload);
      default:
        console.log(`[Worker] No handler registered for Stripe event type "${type}"`);
    }
  }

  async handleCheckoutSessionCompleted(session) {
    if (!session) return;
    console.log('Processing checkout.session.completed:', session.id);

    const userId = session.client_reference_id || session.metadata?.user_id;
    if (!userId) {
      console.error('No user_id found in checkout session');
      return;
    }

    if (session.mode === 'subscription') {
      console.log(`Subscription checkout completed for user ${userId}`);
      return;
    }

    const supporterSince = nowIso();
    await db.prepare(`
      UPDATE users
      SET supporter_badge = ?,
          supporter_tier = 'basic',
          supporter_since = COALESCE(supporter_since, ?),
          supporter_checkout_id = NULL
      WHERE id = ?
    `).run(SUPPORTER_BADGE_CODE, supporterSince, userId);
    console.log(`Basic supporter badge granted to user ${userId}`);
  }

  async handleSubscriptionCreated(subscription) {
    if (!subscription) return;
    console.log('Processing subscription.created:', subscription.id);

    const userId = subscription.metadata?.user_id;
    if (!userId) {
      console.error('No user_id found in subscription metadata');
      return;
    }

    const supporterSince = nowIso();
    const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();

    await db.prepare(`
      UPDATE users
      SET supporter_badge = ?,
          supporter_tier = 'premium',
          supporter_since = COALESCE(supporter_since, ?),
          stripe_subscription_id = ?,
          stripe_customer_id = ?,
          subscription_status = ?,
          subscription_current_period_end = ?,
          supporter_checkout_id = NULL
      WHERE id = ?
    `).run(
      SUPPORTER_BADGE_CODE_PREMIUM,
      supporterSince,
      subscription.id,
      subscription.customer,
      subscription.status,
      periodEnd,
      userId
    );

    console.log(`Premium supporter badge granted to user ${userId}`);
  }

  async handleSubscriptionUpdated(subscription) {
    if (!subscription) return;
    console.log('Processing subscription.updated:', subscription.id);

    const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();

    await db.prepare(`
      UPDATE users
      SET subscription_status = ?,
          subscription_current_period_end = ?
      WHERE stripe_subscription_id = ?
    `).run(subscription.status, periodEnd, subscription.id);

    console.log(`Subscription ${subscription.id} updated to status: ${subscription.status}`);
  }

  async handleSubscriptionDeleted(subscription) {
    if (!subscription) return;
    console.log('Processing subscription.deleted:', subscription.id);

    const user = await db.prepare(`
      SELECT supporter_tier, supporter_since FROM users WHERE stripe_subscription_id = ?
    `).get(subscription.id);

    if (user) {
      await db.prepare(`
        UPDATE users
        SET supporter_badge = NULL,
            supporter_tier = NULL,
            subscription_status = 'canceled',
            stripe_subscription_id = NULL
        WHERE stripe_subscription_id = ?
      `).run(subscription.id);

      console.log(`Subscription ${subscription.id} canceled, badge removed`);
    }
  }

  async handleInvoicePaymentSucceeded(invoice) {
    if (!invoice) return;
    console.log('Processing invoice.payment_succeeded:', invoice.id);

    if (invoice.subscription) {
      await db.prepare(`
        UPDATE users
        SET subscription_status = 'active'
        WHERE stripe_subscription_id = ?
      `).run(invoice.subscription);
    }
  }

  async handleInvoicePaymentFailed(invoice) {
    if (!invoice) return;
    console.log('Processing invoice.payment_failed:', invoice.id);

    if (invoice.subscription) {
      await db.prepare(`
        UPDATE users
        SET subscription_status = 'past_due'
        WHERE stripe_subscription_id = ?
      `).run(invoice.subscription);

      console.log(`Payment failed for subscription ${invoice.subscription}, marked as past_due`);
    }
  }

  /**
   * Inject external dependencies
   */
  setDependencies({ stripe, mailService, pushService } = {}) {
    if (stripe) {
      this.stripe = stripe;
    }
    if (mailService) {
      this.mailService = mailService;
    }
    if (pushService) {
      this.pushService = pushService;
    }
  }

  /**
   * Get queue stats
   */
  getStats() {
    return {
      queueLength: this.jobQueue.length,
      activeJobs: this.activeJobs.size,
      completedJobs: this.completedJobs.size
    };
  }

  /**
   * Health check
   */
  async healthCheck() {
    return {
      ok: true,
      ...this.getStats()
    };
  }
}

/**
 * Create and export worker service
 */
async function createWorkerService(config, messageBus, dependencies = {}) {
  const service = new WorkerService(config, messageBus);
  service.setDependencies(dependencies);
  return service;
}

module.exports = {
  WorkerService,
  createWorkerService
};
