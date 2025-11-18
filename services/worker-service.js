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
const { createJobQueue } = require('../lib/redis-job-queue');
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
  constructor(config, messageBus, options = {}) {
    this.config = config || {};
    this.messageBus = messageBus;

    const queueRequiresRedis = options.requireRedis ?? (!this.config.IS_TEST && (this.config.IS_PROD || process.env.NODE_ENV === 'production'));
    this.jobQueue = options.jobQueue || createJobQueue({
      name: options.queueName || 'worker',
      requireRedis: queueRequiresRedis
    });

    // Worker configuration
    this.maxRetries = options.maxRetries || 3;
    this.retryDelayMs = options.retryDelayMs || 1000;

    // Processing loop
    this.loopActive = false;
    this.loopPromise = null;

    // Service references (injected later)
    this.stripe = null;
    this.mailService = defaultMailService;
    this.pushService = pushServiceModule;

    this.metrics = {
      processed: 0,
      failed: 0,
      lastError: null
    };

    this.subscriptions = [];

    // Bind methods
    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);
    this.enqueueJob = this.enqueueJob.bind(this);
    this._processLoop = this._processLoop.bind(this);
  }

  /**
   * Start the worker service
   */
  async start() {
    console.log('[Worker] Service starting...');

    const subscribe = (topic, handler) => {
      const unsubscribe = this.messageBus.subscribe(topic, handler);
      this.subscriptions.push(unsubscribe);
    };

    // Subscribe to relevant topics
    subscribe(TOPICS.STRIPE_WEBHOOK, (event) => this.handleStripeWebhook(event));
    subscribe(TOPICS.USER_REGISTERED, (event) => this.handleUserRegistered(event));
    subscribe(TOPICS.USER_VERIFIED, (event) => this.handleUserVerified(event));
    subscribe(TOPICS.PUSH_SEND, (event) => this.handlePushNotification(event));
    subscribe(TOPICS.MESSAGE_SENT, (event) => this.handleMessageSent(event));
    subscribe(TOPICS.USER_PASSWORD_RESET, (event) => this.handlePasswordResetRequested(event));
    subscribe(TOPICS.NEARBY_LISTING_AVAILABLE, (event) => this.handleNearbyListing(event));

    if (typeof this.jobQueue.start === 'function') {
      await this.jobQueue.start();
    }
    this.loopActive = true;
    this.loopPromise = this._processLoop();

    console.log('[Worker] Service started');
  }

  /**
   * Stop the worker service
   */
  async stop() {
    this.loopActive = false;
    if (this.loopPromise) {
      try {
        await this.loopPromise;
      } catch (err) {
        console.error('[Worker] Error while stopping loop:', err);
      }
      this.loopPromise = null;
    }

    if (Array.isArray(this.subscriptions)) {
      for (const unsubscribe of this.subscriptions) {
        try {
          if (typeof unsubscribe === 'function') unsubscribe();
        } catch (err) {
          console.warn('[Worker] Failed to clean up subscription:', err?.message || err);
        }
      }
      this.subscriptions = [];
    }

    if (typeof this.jobQueue.stop === 'function') {
      await this.jobQueue.stop();
    }

    console.log('[Worker] Service stopped');
  }

  /**
   * Enqueue a job for processing
   */
  async enqueueJob(job) {
    const jobId = await this.jobQueue.enqueue({
      type: job.type,
      payload: job.payload,
      maxRetries: job.maxRetries || this.maxRetries,
      priority: job.priority || 0
    });
    console.log(`[Worker] Job queued: ${jobId} (type: ${job.type})`);
    return jobId;
  }

  async _processLoop() {
    while (this.loopActive) {
      try {
        const job = await this.jobQueue.reserveNext();
        if (!job) {
          continue;
        }
        await this._processReservedJob(job);
      } catch (err) {
        this.metrics.lastError = err?.message || err;
        console.error('[Worker] Processing loop error:', err);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  async _processReservedJob(job) {
    try {
      await this.processJob(job);
      await this.jobQueue.ack(job);
      this.metrics.processed += 1;
    } catch (err) {
      this.metrics.failed += 1;
      this.metrics.lastError = err?.message || err;
      console.error(`[Worker] Job failed: ${job.id}`, err);
      await this.jobQueue.fail(job, err);
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
  async getStats() {
    let queueStats = {};
    if (typeof this.jobQueue.getStats === 'function') {
      try {
        queueStats = await this.jobQueue.getStats();
      } catch (err) {
        console.warn('[Worker] Failed to read queue stats:', err?.message || err);
      }
    }

    return {
      ...queueStats,
      processed: this.metrics.processed,
      failed: this.metrics.failed,
      lastError: this.metrics.lastError
    };
  }

  /**
   * Health check
   */
  async healthCheck() {
    const stats = await this.getStats();
    return {
      ok: true,
      ...stats
    };
  }
}

/**
 * Create and export worker service
 */
async function createWorkerService(config, messageBus, dependencies = {}, options = {}) {
  const service = new WorkerService(config, messageBus, options);
  service.setDependencies(dependencies);
  return service;
}

module.exports = {
  WorkerService,
  createWorkerService
};
