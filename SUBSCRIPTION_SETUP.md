# Subscription Tier Setup Guide

## Overview

Your Trovelr application now supports two supporter tiers:
- **Basic Tier**: $3 one-time payment → Golden badge
- **Premium Tier**: $5/month subscription → Platinum badge + perks

## What I've Implemented

### ✅ Backend Changes

1. **Database Schema** ([server.js:917-921](server.js#L917-L921))
   - Added `supporter_tier` (basic/premium)
   - Added `stripe_subscription_id`
   - Added `subscription_status` (active/canceled/past_due)
   - Added `subscription_current_period_end`
   - Added `stripe_customer_id`

2. **Stripe Webhook Handler** ([server.js:656-707](server.js#L656-L707))
   - Created `/api/webhooks/stripe` endpoint
   - Handles 6 event types:
     - `checkout.session.completed` - One-time & subscription signup
     - `customer.subscription.created` - Premium tier activation
     - `customer.subscription.updated` - Status changes
     - `customer.subscription.deleted` - Cancellations
     - `invoice.payment_succeeded` - Successful renewals
     - `invoice.payment_failed` - Failed payments

3. **Updated Checkout Endpoint** ([server.js:3718-3832](server.js#L3718-L3832))
   - Accepts `tier` parameter ('basic' or 'premium')
   - Creates one-time payment for basic tier
   - Creates subscription for premium tier
   - Passes tier in metadata for webhook processing

4. **New Constants** ([server.js:266-280](server.js#L266-L280))
   - `SUPPORTER_BADGE_CODE_PREMIUM` = 'trovelr_platinum'
   - `SUPPORTER_PREMIUM_AMOUNT` = 500 ($ 5.00)
   - `STRIPE_WEBHOOK_SECRET` - for webhook verification
   - `STRIPE_PREMIUM_PRICE_ID` - Stripe recurring price ID

### ✅ Frontend Changes

1. **Premium Badge Design** ([supporter.js:46-91](public/app/components/supporter.js#L46-L91))
   - Created beautiful platinum badge with:
     - Purple/indigo gradient
     - Three sparkle stars
     - Center gem accent
     - Distinct from gold badge

2. **Tier Selection UI** ([supporter.js:280-350](public/app/components/supporter.js#L280-L350))
   - Radio button selection between tiers
   - Visual preview of selected badge
   - Price display for each tier
   - Premium badge indicator

3. **Updated Badge Component** ([supporter.js:107-150](public/app/components/supporter.js#L107-L150))
   - Accepts `tier` and `badge` props
   - Auto-detects tier from badge code
   - Shows correct label (Basic/Premium Supporter)

4. **API Integration** ([packages/core/src/index.js:173-177](packages/core/src/index.js#L173-L177))
   - Updated `startSupporterCheckout()` to send tier parameter

5. **Badge Display Everywhere**
   - Grid listings ([grid.js:115-119](public/app/components/grid.js#L115-L119))
   - Listing cards ([listings.js:1567-1571](public/app/components/listings.js#L1567-L1571))
   - Seller profiles ([listings.js:2016-2022](public/app/components/listings.js#L2016-L2022))

---

## Your Setup Steps

### Step 1: Set Up Stripe Products

You need to create a **recurring price** in your Stripe Dashboard:

1. Go to https://dashboard.stripe.com/products
2. Click **"+ Add product"**
3. Fill in:
   - **Name**: Trovelr Premium Supporter
   - **Description**: Monthly subscription for premium supporter badge
   - **Pricing model**: Recurring
   - **Price**: $5.00
   - **Billing period**: Monthly
4. Click **Save product**
5. Copy the **Price ID** (starts with `price_...`)

### Step 2: Configure Webhook in Stripe

1. Go to https://dashboard.stripe.com/webhooks
2. Click on your existing webhook **"energetic-spark"**
3. Update the **Endpoint URL** to:
   ```
   https://trovelr.com/api/webhooks/stripe
   ```
4. Under **"Events to send"**, ensure these are selected:
   - ✅ `checkout.session.completed`
   - ✅ `customer.subscription.created`
   - ✅ `customer.subscription.updated`
   - ✅ `customer.subscription.deleted`
   - ✅ `invoice.payment_succeeded`
   - ✅ `invoice.payment_failed`

5. Copy the **Signing secret** (starts with `whsec_...`)

### Step 3: Update Environment Variables

Add these to your `.env` file or hosting environment:

```bash
# Stripe Premium Tier Configuration
STRIPE_PREMIUM_PRICE_ID=price_xxxxxxxxxxxxx  # From Step 1
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx     # From Step 2

# Optional: Customize amounts (in cents)
SUPPORTER_DONATION_AMOUNT=300        # $3.00 for basic tier (already set)
SUPPORTER_PREMIUM_AMOUNT=500         # $5.00 for premium tier (already set)

# Optional: Customize badge codes
SUPPORTER_BADGE_CODE=trovelr_gold              # Basic tier badge code
SUPPORTER_BADGE_CODE_PREMIUM=trovelr_platinum  # Premium tier badge code
```

### Step 4: Rebuild and Deploy

Since you modified the core package, you need to rebuild:

```bash
# Rebuild the core package
npm run build:core

# Or if you have a full build command:
npm run build

# Deploy your changes
# (Your deployment command here - depends on your hosting)
```

### Step 5: Test the Flow

#### Test Basic Tier (One-time Payment)
1. Log in to your app
2. Trigger the supporter modal
3. Select "$ 3.00 once - Golden supporter badge"
4. Click "Continue"
5. Complete checkout with Stripe test card: `4242 4242 4242 4242`
6. Verify golden badge appears on your profile

#### Test Premium Tier (Subscription)
1. Log in with a different account (or remove badge from DB)
2. Trigger the supporter modal
3. Select "$5.00/month - Premium platinum badge + perks"
4. Click "Continue"
5. Complete checkout with Stripe test card: `4242 4242 4242 4242`
6. Verify platinum badge appears on your profile
7. Check Stripe Dashboard → Subscriptions to see active subscription

#### Test Webhooks
1. Open your server logs
2. In Stripe Dashboard, go to Webhooks → your webhook
3. Click "Send test webhook"
4. Send `checkout.session.completed` event
5. Verify your logs show: `Received Stripe webhook event: checkout.session.completed`

---

## Subscription Management

### For Users to Cancel Subscriptions

Users will need a way to manage their subscriptions. You have a few options:

**Option A: Stripe Customer Portal (Easiest)**
```javascript
// Add this endpoint to server.js
app.post('/api/supporters/manage', auth, async (req, res) => {
  if (!stripe || !req.user.stripe_customer_id) {
    return res.status(400).json({ error: 'no_subscription' });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: req.user.stripe_customer_id,
    return_url: `${resolveAppBaseUrl(req)}/profile`
  });

  res.json({ url: session.url });
});
```

Then add a "Manage Subscription" button in the profile page.

**Option B: Build Custom UI**
- Add a "Cancel Subscription" button in profile
- Call Stripe API to cancel subscription
- Show current billing period end date

### What Happens When Subscription Cancels

Based on the webhook handler I implemented:
- Badge is removed immediately
- User loses premium status
- No refunds (Stripe default behavior)

You can modify [handleSubscriptionDeleted](server.js#L3661-L3682) to:
- Downgrade to basic tier instead of removing badge entirely
- Keep badge until end of billing period
- Send email notification

---

## Database Migration

The new columns will be automatically created when your server starts (thanks to the `ALTER TABLE` statements).

To manually verify they were created:

```sql
-- Check the users table schema
PRAGMA table_info(users);

-- Should see:
-- supporter_tier
-- stripe_subscription_id
-- subscription_status
-- subscription_current_period_end
-- stripe_customer_id
```

---

## Monitoring & Troubleshooting

### Check Webhook Logs

```bash
# View server logs for webhook events
# You should see:
# "Received Stripe webhook event: checkout.session.completed"
# "Basic supporter badge granted to user 123"
# "Premium supporter badge granted to user 456"
```

### Common Issues

**❌ "premium_tier_not_configured" error**
- You didn't set `STRIPE_PREMIUM_PRICE_ID` in your environment variables

**❌ Webhook signature verification failed**
- Wrong `STRIPE_WEBHOOK_SECRET` - get it from Stripe Dashboard

**❌ Webhooks not being received**
- Check your webhook URL is correct: `https://trovelr.com/api/webhooks/stripe`
- Verify SSL certificate is valid
- Check firewall/hosting allows POST requests

**❌ Badge doesn't show after payment**
- Check server logs for webhook processing
- Verify webhook events are enabled in Stripe
- Check database to see if `supporter_badge` column was updated

**❌ Premium badge shows as gold instead of platinum**
- Make sure you're passing `badge` prop to SupporterBadge component
- Check `owner_supporter_badge` is being returned from API

---

## Testing with Stripe Test Mode

Use these test cards:

- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- **Requires authentication**: `4000 0025 0000 3155`

For subscriptions, use:
- Any future expiry date (e.g., 12/34)
- Any 3-digit CVC (e.g., 123)
- Any valid ZIP code (e.g., 12345)

---

## Future Enhancements

Ideas for premium perks you could add:

1. **Priority listings** - Premium users' listings appear higher in search
2. **Custom badge colors** - Let premium users choose badge color
3. **Analytics** - Show premium users their listing view counts
4. **No ads** - Hide ads from premium supporters
5. **Bulk listing tools** - Upload multiple listings at once
6. **Featured badge** - Bigger, animated badge on listings
7. **Early access** - New features released to premium first

To implement perks, check `user.supporter_tier === 'premium'` in your code.

---

## Support

If you encounter issues:

1. Check your server logs for webhook events
2. Verify environment variables are set correctly
3. Test webhooks in Stripe Dashboard
4. Check database to see if columns exist and are being updated

You can also test the webhook endpoint directly:

```bash
curl -X POST https://trovelr.com/api/webhooks/stripe \
  -H "Content-Type: application/json" \
  -d '{"type":"test"}'

# Should return: {"error":"webhook_not_configured"} if STRIPE_WEBHOOK_SECRET not set
# Or signature verification error if secret is wrong
```

---

## Summary Checklist

- [ ] Create Stripe recurring price product
- [ ] Copy Price ID (price_xxx)
- [ ] Copy Webhook signing secret (whsec_xxx)
- [ ] Update webhook URL to `/api/webhooks/stripe`
- [ ] Enable 6 webhook events
- [ ] Add environment variables to `.env`
- [ ] Rebuild core package (`npm run build:core`)
- [ ] Deploy changes
- [ ] Test basic tier checkout
- [ ] Test premium tier checkout
- [ ] Verify webhooks are being received
- [ ] Test subscription cancellation

---

**All code changes are complete and ready to go!** 🎉

Just complete the Stripe configuration steps above and you'll have a fully functional two-tier subscription system.
