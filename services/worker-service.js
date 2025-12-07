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
const { createWorkerQueue } = require('../lib/worker-queue');
const {
  SUPPORTER_BADGE_CODE,
  SUPPORTER_BADGE_CODE_PREMIUM
} = require('../lib/supporter-config');
const defaultMailService = require('../mail-service');
const pushServiceModule = require('../lib/push-service');
const iosPushServiceModule = require('../lib/ios-push-service');
const listingService = require('../lib/listing-service');
const {
  recordWorkerEnqueued,
  recordWorkerProcessed,
  updateWorkerQueueDepth
} = require('../lib/metrics');

function nowIso() {
  return new Date().toISOString();
}

class WorkerService {
  constructor(config, messageBus) {
    this.config = config;
    this.messageBus = messageBus;

    // Job queue for resilience (Redis-backed when available)
    this.jobQueue = createWorkerQueue({
      prefix: process.env.WORKER_QUEUE_PREFIX || 'listit:jobs',
      timeoutMs: config.WORKER_JOB_TIMEOUT_MS,
      retryDelayMs: config.WORKER_RETRY_DELAY_MS,
      concurrency: config.WORKER_CONCURRENCY || config.WORKER_MAX_CONCURRENCY
    });
    this.activeJobs = new Set();
    this.completedJobs = new Map();

    // Worker configuration
    this.maxRetries = 3;
    this.retryDelayMs = 1000;
    this.maxConcurrency = Math.max(1, Number(config.WORKER_CONCURRENCY || config.WORKER_MAX_CONCURRENCY || 4));
    this.jobTimeoutMs = Math.max(1000, Number(config.WORKER_JOB_TIMEOUT_MS || 15000));

    // Metrics
    this.metrics = {
      enqueued: 0,
      processed: 0,
      failed: 0,
      webhookProcessed: 0,
      pushProcessed: 0,
      durationsMs: []
    };

    // Service references (injected later)
    this.stripe = null;
    this.mailService = defaultMailService;
    this.pushService = pushServiceModule;
    this.iosPushService = iosPushServiceModule;

    // Bind methods
    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);
    this.enqueueJob = this.enqueueJob.bind(this);
    this._handleQueueJob = this._handleQueueJob.bind(this);
    this._trackCompletion = this._trackCompletion.bind(this);
    this._trackFailure = this._trackFailure.bind(this);
    this.refreshQueueDepth = this.refreshQueueDepth.bind(this);
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
    this.jobQueue.process(this._handleQueueJob, { concurrency: this.maxConcurrency });
    if (typeof this.jobQueue.on === 'function') {
      this.jobQueue.on('completed', this._trackCompletion);
      this.jobQueue.on('failed', this._trackFailure);
    }

    await this.refreshQueueDepth();

    console.log('[Worker] Service started');
  }

  /**
   * Stop the worker service
   */
  async stop() {
    await this.jobQueue.shutdown();

    console.log('[Worker] Service stopped');
  }

  /**
   * Enqueue a job for processing
   */
  async enqueueJob(job) {
    const jobId = this.buildJobId(job);

    const wrappedJob = {
      id: jobId,
      type: job.type,
      payload: job.payload,
      retries: 0,
      maxRetries: job.maxRetries || this.maxRetries,
      createdAt: Date.now(),
      priority: job.priority || 0,
      timeoutMs: job.timeoutMs || this.jobTimeoutMs,
      retryDelayMs: job.retryDelayMs || this.retryDelayMs,
      idempotencyKey: this.buildIdempotencyKey(job)
    };

    await this.jobQueue.enqueue(wrappedJob);

    this.metrics.enqueued += 1;
    recordWorkerEnqueued();
    await this.refreshQueueDepth();
    console.log(`[Worker] Job queued: ${jobId} (type: ${job.type})`);
    return jobId;
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
      case 'auto_create_listing':
        return await this.autoCreateListing(job.payload);
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
  }

  buildJobId(job) {
    if (job.id) return job.id;
    const stripeEventId = job?.payload?.id;
    if (job.type === 'process_stripe_event' && stripeEventId) {
      return `stripe:${stripeEventId}`;
    }

    if (job.type === 'send_push') {
      const { userId, notification } = job.payload || {};
      const notificationId = notification?.id || notification?.timestamp;
      if (userId && notificationId) {
        return `push:${userId}:${notificationId}`;
      }
    }

    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  buildIdempotencyKey(job) {
    if (job.idempotencyKey) return job.idempotencyKey;
    if (job.type === 'process_stripe_event' && job?.payload?.id) {
      return `stripe:${job.payload.id}`;
    }
    if (job.type === 'send_push' && job?.payload?.userId && job?.payload?.notification?.id) {
      return `push:${job.payload.userId}:${job.payload.notification.id}`;
    }
    if (job.type === 'auto_create_listing' && job?.payload?.jobId) {
      return `auto_listing:${job.payload.jobId}`;
    }
    return null;
  }

  async _handleQueueJob(job) {
    this.activeJobs.add(job.id);
    const startedAt = Date.now();

    try {
      const result = await this.processJob(job);
      this.metrics.processed += 1;
      recordWorkerProcessed(true);
      if (job.type === 'process_stripe_event') {
        this.metrics.webhookProcessed += 1;
      }
      if (job.type === 'send_push') {
        this.metrics.pushProcessed += 1;
      }
      this.completedJobs.set(job.id, {
        status: 'success',
        completedAt: Date.now(),
        result
      });
    } catch (err) {
      this.metrics.failed += 1;
      this.completedJobs.set(job.id, {
        status: 'failed',
        error: err?.message || 'unknown_error',
        completedAt: Date.now()
      });
      console.error(`[Worker] Job failed: ${job.id}`, err?.message || err);
      recordWorkerProcessed(false);
      throw err;
    } finally {
      const duration = Date.now() - startedAt;
      this.metrics.durationsMs.push(duration);
      if (this.metrics.durationsMs.length > 50) {
        this.metrics.durationsMs.shift();
      }
      this.activeJobs.delete(job.id);
      await this.refreshQueueDepth();
    }
  }

  _trackCompletion(event) {
    if (!event) return;
    if (event.duration) {
      this.metrics.durationsMs.push(event.duration);
      if (this.metrics.durationsMs.length > 50) this.metrics.durationsMs.shift();
    }
  }

  _trackFailure(event) {
    if (!event) return;
    console.error('[Worker] Queue failure observed:', event.err || event.failedReason || event);
  }

  async refreshQueueDepth() {
    if (!this.jobQueue || typeof this.jobQueue.size !== 'function') return;
    try {
      const depth = await this.jobQueue.size();
      updateWorkerQueueDepth(depth);
    } catch (err) {
      console.warn('[Worker] Failed to sample queue depth:', err?.message || err);
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
    console.log('[Worker] handleMessageSent called:', { recipientId: event?.recipientId, senderId: event?.senderId });

    if (!event || !event.recipientId) {
      console.log('[Worker] No recipientId, skipping push');
      return;
    }

    const payload = this.buildMessagePushPayload(event);
    if (!payload) {
      console.log('[Worker] buildMessagePushPayload returned null');
      return;
    }

    console.log('[Worker] Enqueueing push job for user:', event.recipientId);

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
   * Notify users about nearby listings (web + iOS/Android native)
   */
  async notifyNearbyListing(listing) {
    if (!listing) return;

    // Send web push
    if (this.pushService && typeof this.pushService.notifyNearbyListing === 'function') {
      try {
        await this.pushService.notifyNearbyListing(listing);
      } catch (err) {
        console.warn('[Worker] Web nearby push failed:', err?.message || err);
      }
    }

    // Send iOS/Android native push
    if (this.iosPushService && typeof this.iosPushService.broadcastIosPush === 'function') {
      try {
        const iosPayload = {
          type: 'nearby_listing',
          listingId: listing.id,
          title: listing.title,
          price: listing.price
        };
        await this.iosPushService.broadcastIosPush(iosPayload, {
          excludeUserId: listing.user_id
        });
      } catch (err) {
        console.warn('[Worker] iOS nearby push failed:', err?.message || err);
      }
    }
  }

  /**
   * Auto-create listing (fire-and-forget background job)
   *
   * Processes an auto_listing_jobs record:
   * 1. Updates job status to 'processing'
   * 2. Runs AI analysis if enabled
   * 3. Creates the listing
   * 4. Updates job with result
   */
  async autoCreateListing(payload) {
    const { jobId } = payload || {};
    if (!jobId) {
      throw new Error('auto_create_listing: missing jobId');
    }

    console.log(`[Worker] Starting auto_create_listing for job ${jobId}`);

    // Fetch the job record
    const job = await db.prepare(`
      SELECT * FROM auto_listing_jobs WHERE id = ?
    `).get(jobId);

    if (!job) {
      throw new Error(`auto_create_listing: job ${jobId} not found`);
    }

    if (job.status === 'completed') {
      console.log(`[Worker] Job ${jobId} already completed, skipping`);
      return { listingId: job.listing_id };
    }

    if (job.status === 'failed' && job.retry_count >= 3) {
      console.log(`[Worker] Job ${jobId} exceeded max retries, skipping`);
      return { error: 'max_retries_exceeded' };
    }

    // Update job to processing status
    await db.prepare(`
      UPDATE auto_listing_jobs
      SET status = 'processing',
          processing_started_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(listingService.nowIso(), listingService.nowIso(), jobId);

    try {
      // Parse upload tokens
      let uploadTokens;
      try {
        uploadTokens = JSON.parse(job.upload_tokens);
      } catch {
        throw new Error('invalid_upload_tokens');
      }

      if (!Array.isArray(uploadTokens) || !uploadTokens.length) {
        throw new Error('no_upload_tokens');
      }

      // Resolve upload drafts
      const drafts = await listingService.resolveUploadDrafts(job.user_id, uploadTokens);
      if (!drafts.length) {
        throw new Error('upload_drafts_expired');
      }

      // Get helper functions from dependencies
      const { canonicalAssetUrl, isAllowedPublicUrl, maybeUpdateListingGeography, incrementCityCount } = this.listingHelpers || {};
      if (!canonicalAssetUrl || !isAllowedPublicUrl) {
        throw new Error('listing_helpers_not_configured');
      }

      // Prepare listing data
      let title = '';
      let description = '';
      let tags = [];
      let price = 0;

      // Run AI analysis if enabled
      if (job.ai_enabled && this.aiAnalyzer) {
        try {
          const imageUrls = drafts.map(d => canonicalAssetUrl(d.url)).filter(Boolean);
          const aiResult = await this.aiAnalyzer({
            images: imageUrls,
            hint: job.hint || ''
          });

          if (aiResult) {
            title = aiResult.title || '';
            description = aiResult.description || '';
            tags = aiResult.tags || [];
            price = aiResult.suggested_price || 0;
          }
        } catch (aiErr) {
          console.warn(`[Worker] AI analysis failed for job ${jobId}:`, aiErr?.message || aiErr);
          // Fall back to hint-based description
          title = listingService.shortTitle(job.hint || 'Item for sale');
          description = listingService.synthesizeListingDescription(title, job.hint);
          tags = listingService.fallbackTagsFromTitleDesc(title, job.hint);
        }
      } else {
        // No AI - use hint-based fallback
        title = listingService.shortTitle(job.hint || 'Item for sale');
        description = listingService.synthesizeListingDescription(title, job.hint);
        tags = listingService.fallbackTagsFromTitleDesc(title, job.hint);
      }

      // Run content moderation if moderator is configured
      if (this.contentModerator) {
        const imageUrls = drafts.map(d => canonicalAssetUrl(d.url)).filter(Boolean);
        const flagged = await this.contentModerator({
          title,
          description,
          imageUrls
        });
        if (flagged?.length) {
          const error = new Error('moderation_flagged');
          error.code = 'moderation_flagged';
          error.flagged = flagged;
          throw error;
        }
      }

      // Create the listing
      const listing = await listingService.createListingFromUploads({
        userId: job.user_id,
        uploads: drafts,
        title,
        description,
        location: job.location,
        price,
        tags,
        enableNearby: !!job.enable_nearby,
        inquiryEnabled: !!job.inquiry_enabled,
        lat: job.lat,
        lon: job.lon,
        canonicalAssetUrl,
        isAllowedPublicUrl,
        maybeUpdateListingGeography,
        incrementCityCount
      });

      // Update job as completed
      await db.prepare(`
        UPDATE auto_listing_jobs
        SET status = 'completed',
            listing_id = ?,
            result = ?,
            completed_at = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        listing.id,
        JSON.stringify({ listingId: listing.id, title: listing.title }),
        listingService.nowIso(),
        listingService.nowIso(),
        jobId
      );

      console.log(`[Worker] Auto-listing job ${jobId} completed, listing ${listing.id} created`);

      // Publish nearby listing event if enabled
      if (listing.enable_nearby && this.messageBus) {
        this.messageBus.publish(TOPICS.NEARBY_LISTING_AVAILABLE, { listing });
      }

      return { listingId: listing.id };

    } catch (err) {
      // Update job as failed
      const errorMsg = err?.message || 'unknown_error';
      const newRetryCount = (job.retry_count || 0) + 1;
      const finalStatus = newRetryCount >= 3 ? 'failed' : 'pending';

      await db.prepare(`
        UPDATE auto_listing_jobs
        SET status = ?,
            error = ?,
            retry_count = ?,
            updated_at = ?
        WHERE id = ?
      `).run(finalStatus, errorMsg, newRetryCount, listingService.nowIso(), jobId);

      console.error(`[Worker] Auto-listing job ${jobId} failed:`, errorMsg);

      // Re-throw for worker retry mechanism if not at max retries
      if (finalStatus === 'pending') {
        throw err;
      }

      return { error: errorMsg };
    }
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
   * Check if current time is within quiet hours
   * @param {string} startTime - Start time in HH:MM format
   * @param {string} endTime - End time in HH:MM format
   * @param {number} timezoneOffset - User's timezone offset in minutes from getTimezoneOffset() (e.g., 300 for EST/UTC-5)
   */
  isWithinQuietHours(startTime, endTime, timezoneOffset = 0) {
    if (!startTime || !endTime) return false;

    // Get current time in user's timezone
    const now = new Date();
    // getTimezoneOffset() returns positive for timezones behind UTC (e.g., 300 for EST/UTC-5)
    // To convert UTC to local: subtract the offset
    const userLocalTime = new Date(now.getTime() - (timezoneOffset * 60 * 1000));
    const currentMinutes = userLocalTime.getUTCHours() * 60 + userLocalTime.getUTCMinutes();

    const [startHour, startMin] = startTime.split(':').map(Number);
    const [endHour, endMin] = endTime.split(':').map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    // Handle overnight quiet hours (e.g., 20:30 to 09:30)
    if (startMinutes > endMinutes) {
      // Quiet hours span midnight
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    } else {
      // Quiet hours within same day
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }
  }

  /**
   * Send push notification (web + iOS/Android native)
   */
  async sendPushNotification(payload) {
    console.log('[Worker] sendPushNotification called:', { userId: payload?.userId, hasNotification: !!payload?.notification });

    if (!payload || !payload.userId || !payload.notification) return;

    // Check user notification settings
    try {
      const userSettings = await db.prepare(`
        SELECT notifications_disabled, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, timezone_offset
        FROM users WHERE id = ?
      `).get(payload.userId);

      if (userSettings) {
        // Check if all notifications are disabled
        if (userSettings.notifications_disabled) {
          console.log('[Worker] User has notifications disabled, skipping push:', payload.userId);
          return;
        }

        // Check quiet hours
        if (userSettings.quiet_hours_enabled) {
          const inQuietHours = this.isWithinQuietHours(
            userSettings.quiet_hours_start,
            userSettings.quiet_hours_end,
            userSettings.timezone_offset || 0
          );
          if (inQuietHours) {
            console.log('[Worker] User is in quiet hours, skipping push:', payload.userId);
            return;
          }
        }
      }
    } catch (err) {
      console.warn('[Worker] Failed to check notification settings:', err?.message || err);
      // Continue sending if we can't check settings
    }

    // Send web push
    if (this.pushService && typeof this.pushService.sendPushToUser === 'function') {
      try {
        await this.pushService.sendPushToUser(
          payload.userId,
          payload.notification,
          payload.options || {}
        );
      } catch (err) {
        console.warn('[Worker] Web push failed:', err?.message || err);
      }
    }

    // Send iOS/Android native push
    console.log('[Worker] Checking iOS push service:', { hasService: !!this.iosPushService, hasMethod: typeof this.iosPushService?.sendIosPushToUser === 'function' });

    if (this.iosPushService && typeof this.iosPushService.sendIosPushToUser === 'function') {
      try {
        const notification = payload.notification;
        const iosPayload = {
          type: 'message',
          senderName: notification.sender_name || notification.sender_username,
          body: notification.body,
          conversationId: notification.conversation_id,
          senderId: notification.sender_id
        };
        console.log('[Worker] Calling sendIosPushToUser:', { userId: payload.userId, iosPayload });
        await this.iosPushService.sendIosPushToUser(payload.userId, iosPayload);
      } catch (err) {
        console.warn('[Worker] iOS push failed:', err?.message || err);
      }
    }
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
  setDependencies({ stripe, mailService, pushService, iosPushService, listingHelpers, aiAnalyzer, contentModerator } = {}) {
    if (stripe) {
      this.stripe = stripe;
    }
    if (mailService) {
      this.mailService = mailService;
    }
    if (pushService) {
      this.pushService = pushService;
    }
    if (iosPushService) {
      this.iosPushService = iosPushService;
    }
    // Listing-related dependencies for auto_create_listing
    if (listingHelpers) {
      this.listingHelpers = listingHelpers;
    }
    if (aiAnalyzer) {
      this.aiAnalyzer = aiAnalyzer;
    }
    if (contentModerator) {
      this.contentModerator = contentModerator;
    }
  }

  /**
   * Get queue stats
   */
  getStats() {
    const avgDuration = this.metrics.durationsMs.length
      ? Math.round(this.metrics.durationsMs.reduce((sum, val) => sum + val, 0) / this.metrics.durationsMs.length)
      : null;

    const summary = {
      activeJobs: this.activeJobs.size,
      completedJobs: this.completedJobs.size,
      metrics: {
        ...this.metrics,
        averageDurationMs: avgDuration
      }
    };

    return this.jobQueue.size().then((queued) => ({
      queueLength: queued,
      ...summary
    })).catch(() => ({
      queueLength: null,
      ...summary
    }));
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
async function createWorkerService(config, messageBus, dependencies = {}) {
  const service = new WorkerService(config, messageBus);
  service.setDependencies(dependencies);
  return service;
}

module.exports = {
  WorkerService,
  createWorkerService
};
