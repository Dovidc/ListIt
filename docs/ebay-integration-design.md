# eBay Cross-Posting Integration - Design Document

## Executive Summary

This document outlines the architecture for integrating eBay cross-posting functionality into Trovelr. Users will be able to connect their eBay seller account and automatically publish listings to both Trovelr and eBay Marketplace, with synchronized inventory management and sold status tracking.

---

## Table of Contents

1. [Goals & Non-Goals](#1-goals--non-goals)
2. [User Stories](#2-user-stories)
3. [System Architecture](#3-system-architecture)
4. [Data Model](#4-data-model)
5. [Authentication & Authorization](#5-authentication--authorization)
6. [API Design](#6-api-design)
7. [User Interface](#7-user-interface)
8. [Synchronization Logic](#8-synchronization-logic)
9. [Error Handling](#9-error-handling)
10. [Security Considerations](#10-security-considerations)
11. [Business Logic & Constraints](#11-business-logic--constraints)
12. [Third-Party Dependencies](#12-third-party-dependencies)
13. [Migration & Rollout](#13-migration--rollout)
14. [Testing Strategy](#14-testing-strategy)
15. [Monitoring & Observability](#15-monitoring--observability)
16. [Future Considerations](#16-future-considerations)

---

## 1. Goals & Non-Goals

### 1.1 Goals

| Priority | Goal |
|----------|------|
| P0 | Users can connect their eBay seller account to Trovelr via OAuth |
| P0 | Users can enable/disable eBay cross-posting via a toggle in their profile |
| P0 | When creating a listing (via + button), user chooses destination: Trovelr only OR Trovelr + eBay |
| P0 | When a listing is marked sold on Trovelr, the eBay listing is automatically ended |
| P0 | When a listing sells on eBay, Trovelr is automatically notified and marks it sold |
| P1 | Users can see eBay listing status (active, ended, error) in Trovelr |
| P1 | Price/title edits in Trovelr sync to eBay |
| P2 | Users can disconnect eBay and reconnect a different account |
| P2 | Support for eBay auction-style listings (not just fixed-price) |

### 1.2 Non-Goals (Out of Scope)

- **Editing listings from eBay → Trovelr**: Trovelr is the source of truth; we don't pull edits made directly on eBay
- **eBay messaging integration**: We won't handle eBay buyer messages in Trovelr
- **eBay shipping label generation**: Out of scope for v1
- **Multi-quantity inventory sync**: Each listing is assumed to be quantity=1 (single item)
- **eBay Motors / Vehicles**: These have special requirements and are out of scope
- **International marketplaces**: v1 targets eBay US (EBAY_US) only

---

## 2. User Stories

### 2.1 Connect eBay Account

```
AS A Trovelr user
I WANT TO connect my eBay seller account
SO THAT I can cross-post my listings to eBay
```

**Acceptance Criteria:**
- User clicks "Connect eBay" button in settings
- User is redirected to eBay's OAuth consent screen
- After approval, user is redirected back to Trovelr
- Trovelr stores the user's eBay access token and refresh token
- User sees "eBay Connected" status with their eBay username

### 2.2 Enable eBay Cross-Posting Toggle

```
AS A Trovelr user with eBay connected
I WANT TO enable a toggle in my profile
SO THAT I'm prompted to cross-post when creating new listings
```

**Acceptance Criteria:**
- After connecting eBay, user sees "Enable eBay Cross-Posting" toggle in profile/settings
- Toggle is OFF by default
- When ON, the listing creation flow will show a destination choice modal
- Toggle state is persisted in user profile

### 2.3 Create Listing with Destination Choice

```
AS A Trovelr user with eBay toggle enabled
I WANT TO choose where to post when creating a listing
SO THAT I can decide per-listing whether to cross-post
```

**Acceptance Criteria:**
- User takes a photo and presses "Use Image"
- A modal appears with two options:
  - **"Post to Trovelr"** - Creates listing only in Trovelr
  - **"Post to Trovelr + eBay"** - Creates listing in both Trovelr and eBay
- If user chooses Trovelr + eBay:
  - Listing is created in Trovelr first
  - Then automatically published to eBay with:
    - Same title (truncated to 80 chars for eBay)
    - Same description
    - Same price
    - Same images (up to 12 for eBay)
    - Auto-mapped category (or user selects if ambiguous)
    - Auto-mapped condition
  - User sees success message with link to eBay listing
- Listing card shows eBay icon/badge if cross-posted
- If eBay toggle is OFF, modal does not appear (listing goes straight to Trovelr)

### 2.4 Mark Sold on Trovelr

```
AS A Trovelr user
I WANT TO mark a cross-posted listing as sold
SO THAT it's removed from both Trovelr and eBay
```

**Acceptance Criteria:**
- User clicks "Mark as Sold" on a cross-posted listing
- Trovelr calls eBay API to end the listing (reason: "Sold")
- eBay listing is ended within 30 seconds
- User cannot "unmark" as sold (button is disabled/hidden)
- Listing shows "Sold" status on both platforms

### 2.5 Item Sells on eBay

```
AS A Trovelr user
I WANT Trovelr to automatically know when my item sells on eBay
SO THAT I don't have to manually update both platforms
```

**Acceptance Criteria:**
- eBay sends webhook notification when item sells
- Trovelr receives notification and marks listing as sold
- User sees "Sold on eBay" badge on the listing
- User cannot relist this item (must create new listing)

### 2.6 Disconnect eBay

```
AS A Trovelr user
I WANT TO disconnect my eBay account
SO THAT I can stop cross-posting or switch to a different account
```

**Acceptance Criteria:**
- User clicks "Disconnect eBay" in settings
- Confirmation modal warns about active listings
- Active eBay listings are NOT automatically ended (user's choice)
- OAuth tokens are deleted from Trovelr
- User can reconnect same or different eBay account

---

## 3. System Architecture

### 3.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              TROVELR FRONTEND                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Web App   │  │ Chrome Ext  │  │ Mobile App  │  │   Settings Page     │ │
│  │  (Listing   │  │ (FB Cross-  │  │   (Future)  │  │  (eBay Connection)  │ │
│  │  Management)│  │   Post)     │  │             │  │                     │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
└─────────┼────────────────┼────────────────┼────────────────────┼────────────┘
          │                │                │                    │
          └────────────────┴────────────────┴────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              TROVELR BACKEND                                 │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │   API Gateway   │  │  Auth Service   │  │     Listing Service         │  │
│  │   /api/*        │  │  JWT, Sessions  │  │  CRUD, Search, Images       │  │
│  └────────┬────────┘  └────────┬────────┘  └──────────────┬──────────────┘  │
│           │                    │                          │                  │
│           ▼                    ▼                          ▼                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                        eBay Integration Service                          ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ ││
│  │  │ OAuth Handler│  │ Listing Sync │  │ Webhook      │  │ Token        │ ││
│  │  │ /ebay/auth/* │  │ Create/End   │  │ Receiver     │  │ Refresh Job  │ ││
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                           Database (PostgreSQL)                          ││
│  │  users, listings, ebay_connections, ebay_listings, sync_logs            ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                    │                                         │
└────────────────────────────────────┼─────────────────────────────────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    │                                 │
                    ▼                                 ▼
┌───────────────────────────────┐    ┌───────────────────────────────────────┐
│         eBay APIs             │    │         eBay Notifications            │
│  ┌─────────────────────────┐  │    │  ┌─────────────────────────────────┐  │
│  │ Inventory API           │  │    │  │ Platform Notifications          │  │
│  │ - createOrReplaceItem   │  │    │  │ - ItemSold                      │  │
│  │ - createOffer           │  │    │  │ - FixedPriceTransaction         │  │
│  │ - publishOffer          │  │    │  │ - AuctionCheckoutComplete       │  │
│  │ - withdrawOffer         │  │    │  └─────────────────────────────────┘  │
│  └─────────────────────────┘  │    │                                       │
│  ┌─────────────────────────┐  │    │  ┌─────────────────────────────────┐  │
│  │ Account API             │  │    │  │ Webhook Delivery                │  │
│  │ - Fulfillment Policies  │  │    │  │ POST /api/ebay/webhooks         │  │
│  │ - Return Policies       │  │    │  │ Signature Verification          │  │
│  │ - Payment Policies      │  │    │  └─────────────────────────────────┘  │
│  └─────────────────────────┘  │    │                                       │
└───────────────────────────────┘    └───────────────────────────────────────┘
```

### 3.2 Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| **OAuth Handler** | Initiates eBay OAuth flow, exchanges auth code for tokens, stores tokens securely |
| **Listing Sync** | Creates eBay inventory items, offers, and publishes listings; ends listings when sold |
| **Webhook Receiver** | Receives and validates eBay notifications, updates Trovelr listing status |
| **Token Refresh Job** | Background job that refreshes eBay access tokens before expiry (every 1.5 hours) |

### 3.3 Data Flow: Create Listing with eBay Cross-Post

**Note:** This flow only applies when:
1. User has eBay connected, AND
2. User has enabled the eBay cross-posting toggle in settings

If toggle is OFF → listing is created directly in Trovelr (no modal shown).

```
User takes photo → presses "Use Image" → Destination Modal appears (if toggle ON)
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ User selects "Post to Trovelr + eBay" in destination modal      │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. Frontend sends POST /api/listings with postToEbay: true      │
│    - Includes all listing data (title, price, description, etc) │
│    - Optionally includes ebayCategoryId if user specified       │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Backend validates:                                           │
│    - User has connected eBay account                            │
│    - eBay cross-post toggle is enabled                          │
│    - Listing has required fields (title, price, image)          │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Backend creates Trovelr listing first:                       │
│    - INSERT INTO listings (...)                                 │
│    - Returns new listing ID                                     │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Backend calls eBay Inventory API:                            │
│    a. createOrReplaceInventoryItem (SKU = trovelr_listing_{id}) │
│    b. createOffer (links inventory item to marketplace)         │
│    c. publishOffer (makes listing live)                         │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Backend stores eBay listing ID in database                   │
│    - ebay_listings.ebay_listing_id = response.listingId         │
│    - ebay_listings.status = 'active'                            │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. Frontend receives success response                           │
│    - Shows listing with "Listed on eBay" badge                  │
│    - Displays eBay item number                                  │
│    - Provides link to eBay listing                              │
└─────────────────────────────────────────────────────────────────┘
```

### 3.4 Data Flow: Item Sold on eBay

```
Buyer purchases item on eBay
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. eBay sends webhook to POST /api/ebay/webhooks                │
│    Payload includes:                                            │
│    - notificationType: "ItemSold" or "FixedPriceTransaction"    │
│    - itemId: eBay listing ID                                    │
│    - transactionPrice, buyerUserId, etc.                        │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Backend validates webhook signature                          │
│    - Uses eBay's public key to verify HMAC signature            │
│    - Rejects invalid/tampered webhooks                          │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Backend looks up Trovelr listing by eBay item ID             │
│    SELECT * FROM ebay_listings WHERE ebay_listing_id = ?        │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Backend updates listing status                               │
│    - listings.sold = true                                       │
│    - listings.sold_at = NOW()                                   │
│    - listings.sold_on = 'ebay'                                  │
│    - ebay_listings.status = 'sold'                              │
│    - ebay_listings.sold_at = NOW()                              │
│    - ebay_listings.sale_price = transactionPrice                │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. (Optional) Send push notification to user                    │
│    "Your item 'Vintage Chair' sold on eBay for $50!"            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Data Model

### 4.1 Database Schema

#### 4.1.1 New Table: `ebay_connections`

Stores the OAuth connection between a Trovelr user and their eBay account.

```sql
CREATE TABLE ebay_connections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- eBay Account Info
    ebay_user_id    VARCHAR(255) NOT NULL,      -- eBay's unique user identifier
    ebay_username   VARCHAR(255),                -- Display username on eBay

    -- OAuth Tokens (encrypted at rest)
    access_token    TEXT NOT NULL,               -- Current access token
    refresh_token   TEXT NOT NULL,               -- Long-lived refresh token
    token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL, -- When access_token expires

    -- Connection Metadata
    scopes          TEXT[],                      -- Granted OAuth scopes
    connected_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_refreshed_at TIMESTAMP WITH TIME ZONE,

    -- Status
    status          VARCHAR(50) DEFAULT 'active', -- active, expired, revoked, error
    error_message   TEXT,                         -- Last error if status = error

    -- Cross-Posting Settings
    cross_post_enabled BOOLEAN DEFAULT FALSE,     -- Toggle: show destination modal on listing creation

    -- Audit
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Constraints
    UNIQUE(user_id),                             -- One eBay account per user
    UNIQUE(ebay_user_id)                         -- One Trovelr account per eBay account
);

CREATE INDEX idx_ebay_connections_user_id ON ebay_connections(user_id);
CREATE INDEX idx_ebay_connections_token_expires ON ebay_connections(token_expires_at);
```

#### 4.1.2 New Table: `ebay_listings`

Tracks the relationship between Trovelr listings and their eBay counterparts.

```sql
CREATE TABLE ebay_listings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id          UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    ebay_connection_id  UUID NOT NULL REFERENCES ebay_connections(id) ON DELETE CASCADE,

    -- eBay Identifiers
    ebay_listing_id     VARCHAR(255),            -- eBay's ItemID (null until published)
    ebay_sku            VARCHAR(255) NOT NULL,   -- Our SKU: trovelr_{listing_id}
    ebay_offer_id       VARCHAR(255),            -- eBay's OfferId (for Inventory API)

    -- Listing Details (cached from eBay)
    ebay_title          VARCHAR(80),             -- Title as it appears on eBay (max 80 chars)
    ebay_price          DECIMAL(10, 2),          -- Price on eBay
    ebay_category_id    VARCHAR(50),             -- eBay category ID
    ebay_category_name  VARCHAR(255),            -- eBay category name (for display)
    ebay_url            TEXT,                    -- Direct link to eBay listing

    -- Status
    status              VARCHAR(50) NOT NULL DEFAULT 'pending',
    -- Possible values:
    -- 'pending'    - Created in Trovelr, not yet published to eBay
    -- 'publishing' - In the process of being published
    -- 'active'     - Live on eBay
    -- 'sold'       - Sold on eBay
    -- 'ended'      - Ended by seller (via Trovelr or eBay)
    -- 'error'      - Failed to publish/sync

    -- Sale Info (if sold)
    sold_at             TIMESTAMP WITH TIME ZONE,
    sale_price          DECIMAL(10, 2),
    buyer_username      VARCHAR(255),

    -- Error Tracking
    last_error          TEXT,
    error_count         INTEGER DEFAULT 0,
    last_error_at       TIMESTAMP WITH TIME ZONE,

    -- Sync Tracking
    last_synced_at      TIMESTAMP WITH TIME ZONE,
    sync_version        INTEGER DEFAULT 0,       -- Incremented on each sync

    -- Audit
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    published_at        TIMESTAMP WITH TIME ZONE,
    ended_at            TIMESTAMP WITH TIME ZONE,

    -- Constraints
    UNIQUE(listing_id),                          -- One eBay listing per Trovelr listing
    UNIQUE(ebay_sku)
);

CREATE INDEX idx_ebay_listings_listing_id ON ebay_listings(listing_id);
CREATE INDEX idx_ebay_listings_ebay_listing_id ON ebay_listings(ebay_listing_id);
CREATE INDEX idx_ebay_listings_status ON ebay_listings(status);
CREATE INDEX idx_ebay_listings_connection ON ebay_listings(ebay_connection_id);
```

#### 4.1.3 Modified Table: `listings`

Add columns to track cross-platform status.

```sql
ALTER TABLE listings ADD COLUMN sold_on VARCHAR(50);
-- Possible values: NULL, 'trovelr', 'ebay', 'facebook'

ALTER TABLE listings ADD COLUMN sold_at TIMESTAMP WITH TIME ZONE;

-- Add a check constraint to prevent unmarking as sold if sold on external platform
-- This is enforced in application logic, not database constraint
```

#### 4.1.4 New Table: `ebay_sync_logs`

Audit log for all eBay API interactions.

```sql
CREATE TABLE ebay_sync_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ebay_listing_id UUID REFERENCES ebay_listings(id) ON DELETE SET NULL,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Operation Info
    operation       VARCHAR(100) NOT NULL,       -- e.g., 'create_inventory_item', 'publish_offer', 'end_listing'
    direction       VARCHAR(10) NOT NULL,        -- 'outbound' (to eBay) or 'inbound' (webhook)

    -- Request/Response
    request_payload  JSONB,
    response_payload JSONB,
    response_status  INTEGER,                    -- HTTP status code

    -- Result
    success         BOOLEAN NOT NULL,
    error_message   TEXT,
    error_code      VARCHAR(100),                -- eBay error code if applicable

    -- Timing
    started_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at    TIMESTAMP WITH TIME ZONE,
    duration_ms     INTEGER,

    -- Metadata
    idempotency_key VARCHAR(255),               -- For retry safety
    retry_count     INTEGER DEFAULT 0,

    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_ebay_sync_logs_listing ON ebay_sync_logs(ebay_listing_id);
CREATE INDEX idx_ebay_sync_logs_user ON ebay_sync_logs(user_id);
CREATE INDEX idx_ebay_sync_logs_created ON ebay_sync_logs(created_at);
CREATE INDEX idx_ebay_sync_logs_operation ON ebay_sync_logs(operation);
```

#### 4.1.5 New Table: `ebay_category_mappings`

Cache of eBay category suggestions to reduce API calls.

```sql
CREATE TABLE ebay_category_mappings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Input
    keywords        TEXT NOT NULL,               -- Normalized search terms

    -- eBay Category
    ebay_category_id    VARCHAR(50) NOT NULL,
    ebay_category_name  VARCHAR(255) NOT NULL,
    ebay_category_path  TEXT,                    -- e.g., "Home & Garden > Furniture > Chairs"

    -- Metadata
    confidence_score    DECIMAL(5, 4),           -- 0.0000 to 1.0000
    use_count          INTEGER DEFAULT 0,        -- How many times this mapping was used

    -- Cache Control
    fetched_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at      TIMESTAMP WITH TIME ZONE,    -- Re-fetch after this time

    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(keywords, ebay_category_id)
);

CREATE INDEX idx_ebay_category_mappings_keywords ON ebay_category_mappings(keywords);
```

### 4.2 Entity Relationship Diagram

```
┌─────────────────┐         ┌─────────────────────┐
│     users       │         │   ebay_connections  │
├─────────────────┤         ├─────────────────────┤
│ id (PK)         │◄───────┤ user_id (FK)        │
│ email           │    1:1  │ ebay_user_id        │
│ ...             │         │ access_token        │
└─────────────────┘         │ refresh_token       │
        │                   │ status              │
        │                   └─────────┬───────────┘
        │                             │
        │ 1:N                         │ 1:N
        ▼                             ▼
┌─────────────────┐         ┌─────────────────────┐
│    listings     │         │   ebay_listings     │
├─────────────────┤         ├─────────────────────┤
│ id (PK)         │◄───────┤ listing_id (FK)     │
│ user_id (FK)    │    1:1  │ ebay_connection_id  │
│ title           │         │ ebay_listing_id     │
│ price           │         │ ebay_sku            │
│ sold            │         │ status              │
│ sold_on         │         │ sold_at             │
│ sold_at         │         └─────────┬───────────┘
└─────────────────┘                   │
                                      │ 1:N
                                      ▼
                            ┌─────────────────────┐
                            │   ebay_sync_logs    │
                            ├─────────────────────┤
                            │ ebay_listing_id(FK) │
                            │ operation           │
                            │ success             │
                            │ request_payload     │
                            │ response_payload    │
                            └─────────────────────┘
```

---

## 5. Authentication & Authorization

### 5.1 eBay OAuth 2.0 Flow

eBay uses OAuth 2.0 Authorization Code Grant flow. Here's the detailed implementation:

#### 5.1.1 Step 1: Initiate Authorization

```
GET /api/ebay/auth/connect
```

**Backend generates authorization URL:**

```javascript
const authUrl = new URL('https://auth.ebay.com/oauth2/authorize');
authUrl.searchParams.set('client_id', process.env.EBAY_CLIENT_ID);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('redirect_uri', process.env.EBAY_REDIRECT_URI);
authUrl.searchParams.set('scope', [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/commerce.notification.subscription'
].join(' '));
authUrl.searchParams.set('state', encryptedState); // Contains user_id + CSRF token
```

**Frontend redirects user to eBay:**

```
https://auth.ebay.com/oauth2/authorize
  ?client_id=TrovelrPr-TrovelrA-PRD-abc123
  &response_type=code
  &redirect_uri=https://trovelr.com/api/ebay/auth/callback
  &scope=https://api.ebay.com/oauth/api_scope%20...
  &state=eyJhbGciOiJBMjU2R0NNIiwiZW5jIjoiQTI1NkdDTSJ9...
```

#### 5.1.2 Step 2: Handle Callback

```
GET /api/ebay/auth/callback?code=v^1.1...&state=eyJ...
```

**Backend exchanges code for tokens:**

```javascript
const tokenResponse = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Authorization': `Basic ${Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64')}`
  },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code: authorizationCode,
    redirect_uri: EBAY_REDIRECT_URI
  })
});

// Response:
{
  "access_token": "v^1.1#i^1#p^3#r^1#f^0#I^3#t^Ul4...",
  "expires_in": 7200,                    // 2 hours
  "refresh_token": "v^1.1#i^1#p^3#r^1...",
  "refresh_token_expires_in": 47304000, // 18 months
  "token_type": "User Access Token"
}
```

#### 5.1.3 Step 3: Store Tokens

```javascript
// Encrypt tokens before storing
const encryptedAccessToken = encrypt(accessToken, process.env.TOKEN_ENCRYPTION_KEY);
const encryptedRefreshToken = encrypt(refreshToken, process.env.TOKEN_ENCRYPTION_KEY);

await db.ebayConnections.create({
  user_id: userId,
  ebay_user_id: ebayUserId,        // Fetched from /sell/account/v1/user
  access_token: encryptedAccessToken,
  refresh_token: encryptedRefreshToken,
  token_expires_at: new Date(Date.now() + expiresIn * 1000),
  scopes: grantedScopes,
  status: 'active'
});
```

#### 5.1.4 Token Refresh Strategy

```javascript
// Background job runs every 30 minutes
async function refreshExpiringTokens() {
  // Find tokens expiring in the next hour
  const expiringConnections = await db.ebayConnections.findAll({
    where: {
      status: 'active',
      token_expires_at: {
        [Op.lt]: new Date(Date.now() + 60 * 60 * 1000) // Within 1 hour
      }
    }
  });

  for (const connection of expiringConnections) {
    try {
      const decryptedRefreshToken = decrypt(connection.refresh_token);

      const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${ebayBasicAuth}`
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: decryptedRefreshToken
        })
      });

      if (response.ok) {
        const tokens = await response.json();
        await connection.update({
          access_token: encrypt(tokens.access_token),
          token_expires_at: new Date(Date.now() + tokens.expires_in * 1000),
          last_refreshed_at: new Date()
        });
      } else {
        // Handle refresh failure
        await connection.update({
          status: 'expired',
          error_message: 'Token refresh failed'
        });
        // Notify user they need to reconnect
      }
    } catch (error) {
      logger.error('Token refresh failed', { connectionId: connection.id, error });
    }
  }
}
```

### 5.2 Required eBay Scopes

| Scope | Purpose |
|-------|---------|
| `https://api.ebay.com/oauth/api_scope` | Basic API access |
| `https://api.ebay.com/oauth/api_scope/sell.inventory` | Create/manage inventory items and offers |
| `https://api.ebay.com/oauth/api_scope/sell.account` | Read seller account info, policies |
| `https://api.ebay.com/oauth/api_scope/sell.fulfillment` | Required for listing policies |
| `https://api.ebay.com/oauth/api_scope/commerce.notification.subscription` | Subscribe to sold notifications |

### 5.3 Security Requirements

| Requirement | Implementation |
|-------------|----------------|
| Token encryption at rest | AES-256-GCM encryption for access_token and refresh_token columns |
| State parameter validation | CSRF protection using encrypted, expiring state tokens |
| HTTPS only | All OAuth redirects and API calls over HTTPS |
| Scope minimization | Only request scopes actually needed |
| Token rotation | Refresh tokens before expiry, never expose to frontend |
| Audit logging | Log all token operations (issue, refresh, revoke) |

---

## 6. API Design

### 6.1 REST Endpoints

#### 6.1.1 eBay Connection Endpoints

```
┌────────────────────────────────────────────────────────────────────────────┐
│ GET /api/ebay/auth/connect                                                 │
├────────────────────────────────────────────────────────────────────────────┤
│ Description: Initiates eBay OAuth flow                                     │
│ Auth: Required (Trovelr JWT)                                               │
│ Response: { redirectUrl: "https://auth.ebay.com/oauth2/authorize?..." }    │
└────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────┐
│ GET /api/ebay/auth/callback                                                │
├────────────────────────────────────────────────────────────────────────────┤
│ Description: OAuth callback handler (called by eBay)                       │
│ Auth: None (state parameter contains encrypted user info)                  │
│ Query Params: code, state                                                  │
│ Response: Redirect to /settings?ebay=connected or /settings?ebay=error    │
└────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────┐
│ GET /api/ebay/connection                                                   │
├────────────────────────────────────────────────────────────────────────────┤
│ Description: Get current user's eBay connection status                     │
│ Auth: Required                                                             │
│ Response:                                                                  │
│ {                                                                          │
│   "connected": true,                                                       │
│   "ebayUsername": "seller123",                                             │
│   "connectedAt": "2024-01-15T10:30:00Z",                                  │
│   "status": "active",                                                      │
│   "activeListings": 5,                                                     │
│   "crossPostEnabled": true                                                 │
│ }                                                                          │
│ OR                                                                         │
│ { "connected": false }                                                     │
└────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────┐
│ PUT /api/ebay/connection/settings                                          │
├────────────────────────────────────────────────────────────────────────────┤
│ Description: Update eBay cross-posting settings (toggle)                   │
│ Auth: Required                                                             │
│ Body: { "crossPostEnabled": true }                                         │
│ Response: { "success": true, "crossPostEnabled": true }                    │
└────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────┐
│ DELETE /api/ebay/connection                                                │
├────────────────────────────────────────────────────────────────────────────┤
│ Description: Disconnect eBay account                                       │
│ Auth: Required                                                             │
│ Body: { "endActiveListings": false }                                       │
│ Response: { "success": true, "activeListingsEnded": 0 }                    │
└────────────────────────────────────────────────────────────────────────────┘
```

#### 6.1.2 Listing Creation with eBay

```
┌────────────────────────────────────────────────────────────────────────────┐
│ POST /api/listings                                                         │
├────────────────────────────────────────────────────────────────────────────┤
│ Description: Create a new listing (optionally cross-post to eBay)          │
│ Auth: Required                                                             │
│ Body:                                                                      │
│ {                                                                          │
│   "title": "Vintage Wooden Chair",                                         │
│   "description": "Beautiful vintage chair...",                             │
│   "price": 50.00,                                                          │
│   "images": ["..."],                                                       │
│   "condition": "good",                                                     │
│   "postToEbay": true,             // NEW: if true, also publish to eBay   │
│   "ebayCategoryId": "11700"       // Optional: specify eBay category       │
│ }                                                                          │
│                                                                            │
│ Response (201 Created):                                                    │
│ {                                                                          │
│   "success": true,                                                         │
│   "listing": { ... },                                                      │
│   "ebay": {                        // Only present if postToEbay: true     │
│     "success": true,                                                       │
│     "ebayListingId": "123456789012",                                       │
│     "ebayUrl": "https://www.ebay.com/itm/123456789012"                     │
│   }                                                                        │
│ }                                                                          │
│                                                                            │
│ Error Response (partial success - Trovelr OK, eBay failed):                │
│ {                                                                          │
│   "success": true,                                                         │
│   "listing": { ... },                                                      │
│   "ebay": {                                                                │
│     "success": false,                                                      │
│     "error": "EBAY_CATEGORY_REQUIRED",                                     │
│     "message": "Could not auto-detect eBay category. Please retry."        │
│   }                                                                        │
│ }                                                                          │
└────────────────────────────────────────────────────────────────────────────┘
```

#### 6.1.3 eBay Listing Management Endpoints

```
┌────────────────────────────────────────────────────────────────────────────┐
│ POST /api/listings/:id/ebay                                                │
├────────────────────────────────────────────────────────────────────────────┤
│ Description: Retry cross-posting a listing to eBay                         │
│              (Used when initial cross-post during creation failed)         │
│ Auth: Required                                                             │
│ Body:                                                                      │
│ {                                                                          │
│   "categoryId": "11700",           // Optional: eBay category ID           │
│   "condition": "USED_GOOD"         // Optional: override condition         │
│ }                                                                          │
│                                                                            │
│ Response (201 Created):                                                    │
│ {                                                                          │
│   "success": true,                                                         │
│   "ebayListingId": "123456789012",                                         │
│   "ebayUrl": "https://www.ebay.com/itm/123456789012",                      │
│   "status": "active"                                                       │
│ }                                                                          │
│                                                                            │
│ Error Response (400):                                                      │
│ {                                                                          │
│   "error": "MISSING_REQUIRED_FIELD",                                       │
│   "message": "Listing must have at least one image",                       │
│   "field": "images"                                                        │
│ }                                                                          │
└────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────┐
│ GET /api/listings/:id/ebay                                                 │
├────────────────────────────────────────────────────────────────────────────┤
│ Description: Get eBay listing status for a Trovelr listing                 │
│ Auth: Required                                                             │
│ Response:                                                                  │
│ {                                                                          │
│   "crossPosted": true,                                                     │
│   "ebayListingId": "123456789012",                                         │
│   "ebayUrl": "https://www.ebay.com/itm/123456789012",                      │
│   "status": "active",                                                      │
│   "ebayPrice": 50.00,                                                      │
│   "ebayTitle": "Vintage Wooden Chair - Great Condition",                   │
│   "publishedAt": "2024-01-15T10:30:00Z",                                  │
│   "lastSyncedAt": "2024-01-15T12:00:00Z"                                  │
│ }                                                                          │
│ OR                                                                         │
│ { "crossPosted": false }                                                   │
└────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────┐
│ DELETE /api/listings/:id/ebay                                              │
├────────────────────────────────────────────────────────────────────────────┤
│ Description: End/remove eBay listing (without marking as sold)             │
│ Auth: Required                                                             │
│ Response: { "success": true, "ebayListingEnded": true }                    │
└────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────┐
│ PUT /api/listings/:id/ebay/sync                                            │
├────────────────────────────────────────────────────────────────────────────┤
│ Description: Sync changes (price, title) to eBay                           │
│ Auth: Required                                                             │
│ Response: { "success": true, "fieldsUpdated": ["price", "title"] }         │
└────────────────────────────────────────────────────────────────────────────┘
```

#### 6.1.4 eBay Webhook Endpoint

```
┌────────────────────────────────────────────────────────────────────────────┐
│ POST /api/ebay/webhooks                                                    │
├────────────────────────────────────────────────────────────────────────────┤
│ Description: Receives eBay platform notifications                          │
│ Auth: eBay signature verification (X-EBAY-SIGNATURE header)                │
│                                                                            │
│ Headers:                                                                   │
│   X-EBAY-SIGNATURE: eyJhbGciOiJFUzI1NiIsImtpZCI6IjEyMyJ9...               │
│   Content-Type: application/json                                           │
│                                                                            │
│ Body (ItemSold example):                                                   │
│ {                                                                          │
│   "metadata": {                                                            │
│     "topic": "MARKETPLACE_ACCOUNT_DELETION",                               │
│     "schemaVersion": "1.0",                                                │
│     "deprecated": false                                                    │
│   },                                                                       │
│   "notification": {                                                        │
│     "notificationId": "abc123",                                            │
│     "eventDate": "2024-01-15T10:30:00.000Z",                              │
│     "publishDate": "2024-01-15T10:30:01.000Z",                            │
│     "publishAttemptCount": 1,                                              │
│     "data": {                                                              │
│       "itemId": "123456789012",                                            │
│       "transactionId": "9876543210",                                       │
│       "price": { "value": "50.00", "currency": "USD" },                    │
│       "quantity": 1                                                        │
│     }                                                                      │
│   }                                                                        │
│ }                                                                          │
│                                                                            │
│ Response: 200 OK (empty body, or { "received": true })                     │
│                                                                            │
│ Note: Must respond within 3 seconds or eBay will retry                     │
└────────────────────────────────────────────────────────────────────────────┘
```

#### 6.1.5 Category Suggestion Endpoint

```
┌────────────────────────────────────────────────────────────────────────────┐
│ GET /api/ebay/categories/suggest?q=vintage+chair                           │
├────────────────────────────────────────────────────────────────────────────┤
│ Description: Get eBay category suggestions based on keywords               │
│ Auth: Required                                                             │
│ Query: q (search terms)                                                    │
│                                                                            │
│ Response:                                                                  │
│ {                                                                          │
│   "suggestions": [                                                         │
│     {                                                                      │
│       "categoryId": "11700",                                               │
│       "categoryName": "Chairs",                                            │
│       "categoryPath": "Home & Garden > Furniture > Chairs",                │
│       "confidence": 0.95                                                   │
│     },                                                                     │
│     {                                                                      │
│       "categoryId": "20563",                                               │
│       "categoryName": "Antique Chairs",                                    │
│       "categoryPath": "Antiques > Furniture > Chairs",                     │
│       "confidence": 0.82                                                   │
│     }                                                                      │
│   ]                                                                        │
│ }                                                                          │
└────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Internal Service Methods

```typescript
// ebay-integration.service.ts

interface EbayIntegrationService {
  // Connection management
  initiateOAuth(userId: string): Promise<{ redirectUrl: string }>;
  handleCallback(code: string, state: string): Promise<EbayConnection>;
  refreshToken(connectionId: string): Promise<void>;
  disconnect(userId: string, endListings: boolean): Promise<void>;

  // Listing operations
  createEbayListing(listingId: string, options?: CreateEbayListingOptions): Promise<EbayListing>;
  endEbayListing(listingId: string, reason: EndListingReason): Promise<void>;
  syncListingToEbay(listingId: string): Promise<SyncResult>;

  // Webhook handling
  handleWebhook(payload: EbayWebhookPayload, signature: string): Promise<void>;

  // Category helpers
  suggestCategories(keywords: string): Promise<CategorySuggestion[]>;
  mapConditionToEbay(trovelrCondition: string): EbayCondition;
}

type EndListingReason = 'SOLD' | 'NOT_AVAILABLE' | 'OTHER';

interface CreateEbayListingOptions {
  categoryId?: string;
  condition?: EbayCondition;
  shippingPolicyId?: string;
  returnPolicyId?: string;
  paymentPolicyId?: string;
}

type EbayCondition =
  | 'NEW'
  | 'LIKE_NEW'
  | 'NEW_OTHER'
  | 'NEW_WITH_DEFECTS'
  | 'CERTIFIED_REFURBISHED'
  | 'EXCELLENT_REFURBISHED'
  | 'VERY_GOOD_REFURBISHED'
  | 'GOOD_REFURBISHED'
  | 'SELLER_REFURBISHED'
  | 'USED_EXCELLENT'
  | 'USED_VERY_GOOD'
  | 'USED_GOOD'
  | 'USED_ACCEPTABLE'
  | 'FOR_PARTS_OR_NOT_WORKING';
```

---

## 7. User Interface

### 7.1 Settings Page - eBay Connection

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Settings                                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ Connected Marketplaces                                                  │ │
│ ├─────────────────────────────────────────────────────────────────────────┤ │
│ │                                                                         │ │
│ │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│ │  │ 🔵 Facebook Marketplace                              [Active ✓]│   │ │
│ │  │ Post to Facebook via Chrome Extension                          │   │ │
│ │  └─────────────────────────────────────────────────────────────────┘   │ │
│ │                                                                         │ │
│ │  ┌─────────────────────────────────────────────────────────────────┐   │ │
│ │  │ 🟡 eBay                                         [Not Connected]│   │ │
│ │  │                                                                 │   │ │
│ │  │  Connect your eBay seller account to:                          │   │ │
│ │  │  • Cross-post listings to eBay with one click                  │   │ │
│ │  │  • Automatically sync when items sell                          │   │ │
│ │  │  • Manage both platforms from Trovelr                          │   │ │
│ │  │                                                                 │   │ │
│ │  │  ┌──────────────────────────┐                                  │   │ │
│ │  │  │  🔗 Connect eBay Account │                                  │   │ │
│ │  │  └──────────────────────────┘                                  │   │ │
│ │  │                                                                 │   │ │
│ │  │  ⓘ Requires an eBay seller account. Listing fees apply         │   │ │
│ │  │    per eBay's standard rates (charged by eBay).                │   │ │
│ │  └─────────────────────────────────────────────────────────────────┘   │ │
│ │                                                                         │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**After connecting:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │ 🟢 eBay                                          [Connected ✓] │       │
│  │                                                                 │       │
│  │  Connected as: seller_username_123                              │       │
│  │  Connected on: January 15, 2024                                 │       │
│  │  Active listings on eBay: 5                                     │       │
│  │                                                                 │       │
│  │  ┌──────────────────────────────────────────────────────────┐  │       │
│  │  │ Enable eBay Cross-Posting                         [====] │  │       │
│  │  │ When enabled, you'll be asked where to post when         │  │       │
│  │  │ creating new listings.                                   │  │       │
│  │  └──────────────────────────────────────────────────────────┘  │       │
│  │                                                                 │       │
│  │  ┌────────────────────┐  ┌────────────────────┐                │       │
│  │  │  ⟳ Refresh Status  │  │  🔌 Disconnect     │                │       │
│  │  └────────────────────┘  └────────────────────┘                │       │
│  └─────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Listing Creation Flow - Destination Choice Modal

**When eBay toggle is OFF (or eBay not connected):**
- The destination modal does NOT appear
- Pressing "Use Image" proceeds directly to creating a Trovelr-only listing
- This is the default behavior for users who haven't enabled eBay cross-posting

**When eBay toggle is ON:**
After taking a photo and pressing "Use Image", the destination modal appears:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                    Where would you like to post?                            │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                                                                        │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │ │
│  │  │                                                                 │  │ │
│  │  │   📦  Post to Trovelr                                          │  │ │
│  │  │                                                                 │  │ │
│  │  │   List this item on Trovelr only                               │  │ │
│  │  │                                                                 │  │ │
│  │  └─────────────────────────────────────────────────────────────────┘  │ │
│  │                                                                        │ │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │ │
│  │  │                                                                 │  │ │
│  │  │   📦 + 🟡  Post to Trovelr + eBay                              │  │ │
│  │  │                                                                 │  │ │
│  │  │   List on both Trovelr and eBay Marketplace                    │  │ │
│  │  │   ⓘ Standard eBay fees apply                                   │  │ │
│  │  │                                                                 │  │ │
│  │  └─────────────────────────────────────────────────────────────────┘  │ │
│  │                                                                        │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│                          [Cancel]                                           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Flow when "Post to Trovelr + eBay" is selected:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                    Creating your listing...                                 │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                                                                        │ │
│  │   ✓ Created on Trovelr                                                │ │
│  │                                                                        │ │
│  │   ⏳ Publishing to eBay...                                             │ │
│  │      [████████░░░░░░░░░░░░░░]                                         │ │
│  │                                                                        │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Success state:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                         🎉 Listed!                                          │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                                                                        │ │
│  │   ✓ Created on Trovelr                                                │ │
│  │                                                                        │ │
│  │   ✓ Published to eBay                                                 │ │
│  │     Item #: 123456789012                                              │ │
│  │     [View on eBay →]                                                  │ │
│  │                                                                        │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│                         [Done]                                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.3 Listing Detail Page - eBay Status

**Listing that was cross-posted to eBay:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Vintage Wooden Chair                                            $50        │
│ 🟢 Active on eBay                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ [Image] [Image] [Image]                                                     │
│                                                                             │
│ Beautiful vintage chair in great condition...                               │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ Marketplace Status                                                          │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  🟢 eBay - Active                                                    │  │
│  │  Listed: January 15, 2024 at 10:30 AM                                │  │
│  │  eBay Item #: 123456789012                                           │  │
│  │                                                                       │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │  │
│  │  │ 🔗 View on eBay │  │ ⟳ Sync Changes  │  │ ⏹ End eBay Listing │  │  │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ Actions                                                                     │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │  ✓ Mark as Sold                                                    │    │
│  │  This will also end the eBay listing.                              │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.4 Listing Card Badge

```
┌─────────────────────┐
│  [    Image    ]    │
│                     │
│  Vintage Chair      │
│  $50                │
│  ──────────────────│
│  🟢 eBay  🔵 FB    │  ← Platform badges
└─────────────────────┘
```

### 7.5 Sold Listing (Cannot Unmark)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Vintage Wooden Chair                                            $50        │
│ ✅ SOLD on eBay • January 16, 2024                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ ...                                                                         │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  ⓘ This item was sold on eBay and cannot be relisted.               │  │
│  │     To sell another similar item, create a new listing.              │  │
│  │                                                                       │  │
│  │  ┌─────────────────────────┐                                         │  │
│  │  │ 📋 Duplicate as New     │  ← Creates copy as new listing          │  │
│  │  └─────────────────────────┘                                         │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.6 eBay Category Selection (During Listing Creation)

This step appears after user selects "Post to Trovelr + eBay" in the destination modal.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ eBay Listing Details                                                  [X]  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Your listing will be posted to both Trovelr and eBay                       │
│                                                                             │
│  Listing Preview                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Title: Vintage Wooden Chair - Great Condition                       │   │
│  │ Price: $50.00                                                       │   │
│  │ Images: 3 photos will be uploaded                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  eBay Category *                                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Home & Garden > Furniture > Chairs                              [▼]│   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│  Suggested based on your listing title                                      │
│                                                                             │
│  Condition *                                                                │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Used - Good                                                     [▼]│   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  ⓘ eBay Fees                                                               │
│  • Insertion fee: $0.35 (after free listings)                              │
│  • Final value fee: ~13% of sale price                                     │
│  • Fees are charged by eBay to your eBay account                           │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    📤 Create Listing                                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Synchronization Logic

### 8.1 Source of Truth

**Trovelr is the source of truth for all listing data.**

| Scenario | Behavior |
|----------|----------|
| Edit title in Trovelr | Syncs to eBay (if connected) |
| Edit title on eBay | Ignored (not synced back to Trovelr) |
| Edit price in Trovelr | Syncs to eBay |
| Edit price on eBay | Ignored |
| Delete in Trovelr | Ends eBay listing |
| End on eBay manually | NOT synced to Trovelr (listing remains active in Trovelr) |
| Mark sold in Trovelr | Ends eBay listing with "Sold" reason |
| Item sells on eBay | Trovelr listing marked as sold (via webhook) |

### 8.2 Sync Operations

#### 8.2.1 Trovelr → eBay Sync

```typescript
async function syncListingToEbay(listingId: string): Promise<SyncResult> {
  const listing = await db.listings.findByPk(listingId, {
    include: [{ model: db.ebayListings, as: 'ebayListing' }]
  });

  if (!listing.ebayListing || listing.ebayListing.status !== 'active') {
    return { synced: false, reason: 'No active eBay listing' };
  }

  const connection = await getActiveConnection(listing.userId);
  const ebayClient = createEbayClient(connection);

  // Update inventory item
  await ebayClient.inventory.createOrReplaceInventoryItem(listing.ebayListing.ebay_sku, {
    product: {
      title: truncate(listing.title, 80),  // eBay max title length
      description: listing.description,
      imageUrls: listing.images.slice(0, 12)  // eBay max 12 images
    },
    condition: mapConditionToEbay(listing.condition),
    availability: {
      shipToLocationAvailability: {
        quantity: listing.sold ? 0 : 1
      }
    }
  });

  // Update offer (price)
  await ebayClient.inventory.updateOffer(listing.ebayListing.ebay_offer_id, {
    pricingSummary: {
      price: {
        value: listing.price.toString(),
        currency: 'USD'
      }
    }
  });

  await listing.ebayListing.update({
    ebay_title: truncate(listing.title, 80),
    ebay_price: listing.price,
    last_synced_at: new Date(),
    sync_version: listing.ebayListing.sync_version + 1
  });

  return { synced: true, fieldsUpdated: ['title', 'description', 'price', 'images'] };
}
```

#### 8.2.2 Mark Sold Logic

```typescript
async function markListingAsSold(listingId: string, soldOn: 'trovelr' | 'ebay'): Promise<void> {
  const listing = await db.listings.findByPk(listingId, {
    include: [{ model: db.ebayListings, as: 'ebayListing' }]
  });

  // Start transaction
  await db.sequelize.transaction(async (t) => {
    // Update Trovelr listing
    await listing.update({
      sold: true,
      sold_at: new Date(),
      sold_on: soldOn
    }, { transaction: t });

    // If sold on Trovelr and has active eBay listing, end it
    if (soldOn === 'trovelr' && listing.ebayListing?.status === 'active') {
      const connection = await getActiveConnection(listing.userId);
      const ebayClient = createEbayClient(connection);

      // End the eBay listing
      await ebayClient.inventory.withdrawOffer(listing.ebayListing.ebay_offer_id);

      await listing.ebayListing.update({
        status: 'ended',
        ended_at: new Date()
      }, { transaction: t });

      // Log the operation
      await db.ebaySyncLogs.create({
        ebay_listing_id: listing.ebayListing.id,
        user_id: listing.userId,
        operation: 'withdraw_offer',
        direction: 'outbound',
        success: true
      }, { transaction: t });
    }

    // If sold on eBay, update eBay listing status
    if (soldOn === 'ebay' && listing.ebayListing) {
      await listing.ebayListing.update({
        status: 'sold',
        sold_at: new Date()
      }, { transaction: t });
    }
  });
}
```

#### 8.2.3 Prevent Unmark as Sold

```typescript
async function updateListing(listingId: string, updates: ListingUpdates): Promise<Listing> {
  const listing = await db.listings.findByPk(listingId, {
    include: [{ model: db.ebayListings, as: 'ebayListing' }]
  });

  // BUSINESS RULE: Cannot unmark as sold if sold on external platform
  if (listing.sold && updates.sold === false) {
    if (listing.sold_on === 'ebay') {
      throw new BusinessError(
        'CANNOT_UNMARK_SOLD',
        'This item was sold on eBay and cannot be marked as available. ' +
        'eBay listings cannot be reactivated once ended. ' +
        'To sell a similar item, please create a new listing.'
      );
    }

    // Also prevent if cross-posted (even if sold on Trovelr)
    // because eBay listing was already ended
    if (listing.ebayListing && listing.ebayListing.status === 'ended') {
      throw new BusinessError(
        'CANNOT_UNMARK_SOLD',
        'This item was cross-posted to eBay and the eBay listing has been ended. ' +
        'To sell a similar item, please create a new listing.'
      );
    }
  }

  // Proceed with update...
  return listing.update(updates);
}
```

### 8.3 Webhook Processing

```typescript
async function handleEbayWebhook(payload: EbayWebhookPayload): Promise<void> {
  const { topic, data } = payload;

  switch (topic) {
    case 'MARKETPLACE_ITEM_SOLD':
    case 'ITEM_SOLD': {
      const ebayListing = await db.ebayListings.findOne({
        where: { ebay_listing_id: data.itemId }
      });

      if (!ebayListing) {
        logger.warn('Received sold notification for unknown eBay listing', { itemId: data.itemId });
        return;
      }

      // Idempotency check
      if (ebayListing.status === 'sold') {
        logger.info('eBay listing already marked as sold', { ebayListingId: ebayListing.id });
        return;
      }

      await markListingAsSold(ebayListing.listing_id, 'ebay');

      // Log the webhook
      await db.ebaySyncLogs.create({
        ebay_listing_id: ebayListing.id,
        user_id: ebayListing.userId,
        operation: 'item_sold_webhook',
        direction: 'inbound',
        request_payload: payload,
        success: true
      });

      // Optional: Send notification to user
      await notifyUser(ebayListing.userId, {
        type: 'EBAY_ITEM_SOLD',
        title: 'Item Sold on eBay!',
        body: `Your item "${ebayListing.ebay_title}" sold for $${data.price.value}`
      });

      break;
    }

    case 'MARKETPLACE_ACCOUNT_DELETION': {
      // GDPR/legal requirement: delete eBay connection when user deletes their eBay account
      const connection = await db.ebayConnections.findOne({
        where: { ebay_user_id: data.userId }
      });

      if (connection) {
        await connection.update({ status: 'revoked' });
        // Note: We keep the record for audit, but tokens are invalidated
      }
      break;
    }

    default:
      logger.info('Unhandled eBay webhook topic', { topic });
  }
}
```

---

## 9. Error Handling

### 9.1 Error Categories

| Category | Examples | User Message | Retry |
|----------|----------|--------------|-------|
| **Auth Errors** | Token expired, invalid token, scope missing | "Please reconnect your eBay account" | No |
| **Validation Errors** | Missing required field, invalid category, title too long | Specific field error message | No |
| **eBay API Errors** | Rate limit, service unavailable, invalid request | "eBay is temporarily unavailable. Please try again." | Yes (with backoff) |
| **Business Errors** | Listing already on eBay, user not eligible | Specific business rule message | No |
| **Network Errors** | Timeout, connection refused | "Connection failed. Please try again." | Yes |

### 9.2 Error Response Format

```typescript
interface EbayError {
  code: string;           // e.g., 'EBAY_TOKEN_EXPIRED', 'EBAY_CATEGORY_INVALID'
  message: string;        // User-friendly message
  details?: string;       // Technical details (for debugging)
  field?: string;         // Which field caused the error
  retryable: boolean;     // Whether client should retry
  retryAfter?: number;    // Seconds to wait before retry
}

// Example error responses:

// Token expired
{
  "error": {
    "code": "EBAY_TOKEN_EXPIRED",
    "message": "Your eBay connection has expired. Please reconnect your account.",
    "retryable": false
  }
}

// Rate limited
{
  "error": {
    "code": "EBAY_RATE_LIMITED",
    "message": "eBay is temporarily limiting requests. Please try again in a moment.",
    "retryable": true,
    "retryAfter": 60
  }
}

// Validation error
{
  "error": {
    "code": "EBAY_TITLE_TOO_LONG",
    "message": "eBay titles must be 80 characters or less. Your title is 95 characters.",
    "field": "title",
    "retryable": false
  }
}
```

### 9.3 Retry Strategy

```typescript
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  retryableErrorCodes: ['SERVICE_UNAVAILABLE', 'TOO_MANY_REQUESTS']
};

async function callEbayWithRetry<T>(
  operation: () => Promise<T>,
  context: { operationName: string; listingId?: string }
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const isRetryable = isRetryableError(error);
      const isLastAttempt = attempt === RETRY_CONFIG.maxRetries;

      if (!isRetryable || isLastAttempt) {
        logger.error('eBay API call failed', {
          ...context,
          attempt,
          error: error.message,
          retryable: isRetryable
        });
        throw error;
      }

      const delay = Math.min(
        RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt),
        RETRY_CONFIG.maxDelayMs
      );

      logger.warn('eBay API call failed, retrying', {
        ...context,
        attempt,
        nextRetryInMs: delay,
        error: error.message
      });

      await sleep(delay);
    }
  }

  throw lastError;
}
```

### 9.4 Partial Failure Handling

When cross-posting fails partway through:

```typescript
async function createEbayListing(listingId: string): Promise<EbayListing> {
  const listing = await db.listings.findByPk(listingId);
  const connection = await getActiveConnection(listing.userId);

  // Create tracking record first
  const ebayListing = await db.ebayListings.create({
    listing_id: listingId,
    ebay_connection_id: connection.id,
    ebay_sku: `trovelr_${listingId}`,
    status: 'publishing'
  });

  try {
    // Step 1: Create inventory item
    await ebayClient.inventory.createOrReplaceInventoryItem(ebayListing.ebay_sku, {...});

    // Step 2: Create offer
    const offer = await ebayClient.inventory.createOffer({...});
    await ebayListing.update({ ebay_offer_id: offer.offerId });

    // Step 3: Publish offer
    const published = await ebayClient.inventory.publishOffer(offer.offerId);
    await ebayListing.update({
      ebay_listing_id: published.listingId,
      ebay_url: `https://www.ebay.com/itm/${published.listingId}`,
      status: 'active',
      published_at: new Date()
    });

    return ebayListing;

  } catch (error) {
    // Record the failure
    await ebayListing.update({
      status: 'error',
      last_error: error.message,
      error_count: ebayListing.error_count + 1,
      last_error_at: new Date()
    });

    // Clean up partial state on eBay if needed
    if (ebayListing.ebay_offer_id) {
      try {
        await ebayClient.inventory.deleteOffer(ebayListing.ebay_offer_id);
      } catch (cleanupError) {
        logger.error('Failed to clean up eBay offer after error', { cleanupError });
      }
    }

    throw new EbayPublishError(
      'PUBLISH_FAILED',
      'Failed to publish listing to eBay. Please try again.',
      { originalError: error }
    );
  }
}
```

---

## 10. Security Considerations

### 10.1 Token Security

| Concern | Mitigation |
|---------|------------|
| Token storage | Encrypt at rest using AES-256-GCM |
| Token in logs | Never log token values; use truncated hashes for debugging |
| Token in errors | Strip tokens from error messages before returning to client |
| Token in transit | HTTPS only; tokens never sent to browser |
| Token exposure | Refresh tokens stored server-side only; never exposed via API |

### 10.2 Webhook Security

```typescript
async function verifyEbayWebhook(
  payload: string,
  signatureHeader: string
): Promise<boolean> {
  // eBay sends signature in X-EBAY-SIGNATURE header
  // Format: eyJhbGciOiJFUzI1NiIsImtpZCI6IjEyMyJ9.eyJub3RpZmljYXRpb25JZCI6...

  try {
    // 1. Decode the signature header (JWT format)
    const [headerB64, payloadB64, signatureB64] = signatureHeader.split('.');
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());

    // 2. Fetch eBay's public key using the key ID (kid)
    const publicKey = await getEbayPublicKey(header.kid);

    // 3. Verify the signature
    const signaturePayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

    // 4. Check timestamp (prevent replay attacks)
    const timestamp = new Date(signaturePayload.signatureTime);
    const maxAge = 10 * 60 * 1000; // 10 minutes
    if (Date.now() - timestamp.getTime() > maxAge) {
      logger.warn('Webhook signature expired', { signatureTime: timestamp });
      return false;
    }

    // 5. Verify payload hash
    const expectedHash = crypto
      .createHash('sha256')
      .update(payload)
      .digest('base64');

    if (signaturePayload.digest !== expectedHash) {
      logger.warn('Webhook payload hash mismatch');
      return false;
    }

    // 6. Verify signature using eBay's public key
    const verified = crypto.verify(
      'sha256',
      Buffer.from(`${headerB64}.${payloadB64}`),
      publicKey,
      Buffer.from(signatureB64, 'base64url')
    );

    return verified;
  } catch (error) {
    logger.error('Webhook verification failed', { error });
    return false;
  }
}
```

### 10.3 CSRF Protection for OAuth

```typescript
function generateOAuthState(userId: string): string {
  const payload = {
    userId,
    nonce: crypto.randomBytes(16).toString('hex'),
    timestamp: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
  };

  // Encrypt the state
  return encrypt(JSON.stringify(payload), process.env.OAUTH_STATE_SECRET);
}

function validateOAuthState(encryptedState: string, expectedUserId: string): boolean {
  try {
    const decrypted = decrypt(encryptedState, process.env.OAUTH_STATE_SECRET);
    const payload = JSON.parse(decrypted);

    // Validate user ID matches
    if (payload.userId !== expectedUserId) {
      return false;
    }

    // Validate not expired
    if (Date.now() > payload.expiresAt) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
```

### 10.4 API Security

| Control | Implementation |
|---------|----------------|
| Authentication | Trovelr JWT required for all endpoints except webhook receiver |
| Authorization | Verify user owns the listing before any eBay operation |
| Rate limiting | 10 eBay operations per minute per user |
| Input validation | Sanitize all inputs; validate category IDs, condition values |
| Output sanitization | Strip sensitive data from API responses |

---

## 11. Business Logic & Constraints

### 11.1 Listing Lifecycle Rules

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          LISTING STATE MACHINE                              │
└─────────────────────────────────────────────────────────────────────────────┘

                            ┌──────────────┐
                            │   CREATED    │
                            │  (Trovelr)   │
                            └──────┬───────┘
                                   │
                     ┌─────────────┼─────────────┐
                     │             │             │
                     ▼             ▼             ▼
              ┌──────────┐  ┌──────────┐  ┌──────────┐
              │ Post to  │  │ Post to  │  │ Mark as  │
              │ Facebook │  │   eBay   │  │   Sold   │
              └────┬─────┘  └────┬─────┘  └────┬─────┘
                   │             │             │
                   ▼             ▼             ▼
              ┌──────────┐  ┌──────────┐  ┌──────────┐
              │ ACTIVE   │  │ ACTIVE   │  │   SOLD   │
              │ (FB)     │  │ (eBay)   │  │(Trovelr) │
              └────┬─────┘  └────┬─────┘  └──────────┘
                   │             │              ▲
                   │             │              │
                   ▼             ▼              │
              ┌──────────────────────────┐     │
              │    ACTIVE (Both)         │     │
              │  (Facebook + eBay)       │     │
              └────────────┬─────────────┘     │
                           │                   │
              ┌────────────┼────────────┐      │
              │            │            │      │
              ▼            ▼            ▼      │
        ┌──────────┐ ┌──────────┐ ┌──────────┐│
        │ Sold on  │ │ Sold on  │ │ Sold on  ││
        │ Trovelr  │ │   eBay   │ │ Facebook ││
        └────┬─────┘ └────┬─────┘ └────┬─────┘│
             │            │            │      │
             └────────────┴────────────┴──────┘
                          │
                          ▼
                   ┌──────────────┐
                   │     SOLD     │
                   │  (TERMINAL)  │
                   │              │
                   │ • Cannot     │
                   │   unmark     │
                   │ • All        │
                   │   external   │
                   │   listings   │
                   │   ended      │
                   └──────────────┘
```

### 11.2 Business Rules

| Rule | Description | Enforcement |
|------|-------------|-------------|
| **One eBay listing per Trovelr listing** | A Trovelr listing can only be cross-posted to eBay once | Database unique constraint |
| **Cannot unmark if sold on eBay** | If `sold_on = 'ebay'`, the `sold` field cannot be set to `false` | Application logic |
| **Cannot unmark if cross-posted and sold** | If listing has eBay listing and is sold, cannot unmark | Application logic |
| **eBay requires images** | Cannot cross-post to eBay without at least 1 image | Validation |
| **eBay title max 80 chars** | Title is truncated if longer | Automatic truncation |
| **eBay max 12 images** | Only first 12 images are sent | Automatic slicing |
| **Price must be > 0** | eBay requires positive price | Validation |
| **User must have eBay connection** | Cannot cross-post without active connection | Authorization check |
| **Cannot end sold listing** | If eBay listing status is 'sold', cannot manually end | Application logic |

### 11.3 Condition Mapping

| Trovelr Condition | eBay Condition |
|-------------------|----------------|
| New | NEW |
| Like New | LIKE_NEW |
| Excellent | USED_EXCELLENT |
| Very Good | USED_VERY_GOOD |
| Good | USED_GOOD |
| Fair | USED_ACCEPTABLE |
| Poor / For Parts | FOR_PARTS_OR_NOT_WORKING |
| (default) | USED_GOOD |

---

## 12. Third-Party Dependencies

### 12.1 eBay APIs Used

| API | Version | Purpose | Documentation |
|-----|---------|---------|---------------|
| Identity API | v1 | OAuth token exchange and refresh | [Link](https://developer.ebay.com/api-docs/static/oauth-credentials.html) |
| Inventory API | v1 | Create inventory items, offers, publish listings | [Link](https://developer.ebay.com/api-docs/sell/inventory/overview.html) |
| Account API | v1 | Get seller policies (shipping, return, payment) | [Link](https://developer.ebay.com/api-docs/sell/account/overview.html) |
| Taxonomy API | v1 | Category suggestions and validation | [Link](https://developer.ebay.com/api-docs/commerce/taxonomy/overview.html) |
| Notification API | v1 | Subscribe to sold notifications | [Link](https://developer.ebay.com/api-docs/commerce/notification/overview.html) |

### 12.2 eBay SDK Options

| Option | Pros | Cons |
|--------|------|------|
| **Official eBay SDK** | Official support, typed | Limited languages, sometimes outdated |
| **Custom HTTP client** | Full control, lightweight | More code to maintain |
| **ebay-api (npm)** | Popular, well-maintained | Third-party dependency |

**Recommendation**: Use official eBay SDK if available for your language, fall back to custom HTTP client with proper typing.

### 12.3 Required eBay Developer Credentials

| Credential | Purpose | How to Obtain |
|------------|---------|---------------|
| Client ID (App ID) | Identifies your application | eBay Developer Portal |
| Client Secret (Cert ID) | Authenticates your application | eBay Developer Portal |
| Redirect URI | OAuth callback URL | Configure in Developer Portal |
| Webhook Endpoint | Receives notifications | Configure in Developer Portal |

### 12.4 eBay Sandbox vs Production

| Environment | Base URL | Purpose |
|-------------|----------|---------|
| Sandbox | `https://api.sandbox.ebay.com` | Development and testing |
| Production | `https://api.ebay.com` | Live marketplace |

---

## 13. Migration & Rollout

### 13.1 Database Migration Steps

```sql
-- Migration: 001_add_ebay_tables.sql

BEGIN;

-- 1. Create ebay_connections table
CREATE TABLE ebay_connections (...);

-- 2. Create ebay_listings table
CREATE TABLE ebay_listings (...);

-- 3. Create ebay_sync_logs table
CREATE TABLE ebay_sync_logs (...);

-- 4. Create ebay_category_mappings table
CREATE TABLE ebay_category_mappings (...);

-- 5. Add columns to listings table
ALTER TABLE listings ADD COLUMN sold_on VARCHAR(50);
ALTER TABLE listings ADD COLUMN sold_at TIMESTAMP WITH TIME ZONE;

-- 6. Create indexes
CREATE INDEX idx_ebay_connections_user_id ON ebay_connections(user_id);
-- ... (all indexes from section 4)

COMMIT;
```

### 13.2 Rollout Phases

| Phase | Duration | Scope | Success Criteria |
|-------|----------|-------|------------------|
| **Phase 1: Internal** | 1 week | Trovelr team only | All features work, no critical bugs |
| **Phase 2: Beta** | 2 weeks | 10 selected beta users | <1% error rate, user feedback incorporated |
| **Phase 3: Limited** | 2 weeks | 10% of users (feature flag) | <0.5% error rate, no performance degradation |
| **Phase 4: GA** | Ongoing | All users | Monitoring in place, support docs ready |

### 13.3 Feature Flags

```typescript
const EBAY_FEATURE_FLAGS = {
  // Master enable/disable
  EBAY_INTEGRATION_ENABLED: true,

  // Rollout percentage (0-100)
  EBAY_ROLLOUT_PERCENTAGE: 10,

  // Specific features
  EBAY_AUTO_SYNC_ENABLED: true,
  EBAY_WEBHOOK_ENABLED: true,
  EBAY_CATEGORY_SUGGESTIONS_ENABLED: true,

  // Limits
  EBAY_MAX_LISTINGS_PER_USER: 100,
  EBAY_MAX_SYNC_RETRIES: 3
};

function isEbayEnabledForUser(userId: string): boolean {
  if (!EBAY_FEATURE_FLAGS.EBAY_INTEGRATION_ENABLED) {
    return false;
  }

  // Consistent hashing for gradual rollout
  const hash = hashUserId(userId);
  return hash % 100 < EBAY_FEATURE_FLAGS.EBAY_ROLLOUT_PERCENTAGE;
}
```

### 13.4 Rollback Plan

1. **Immediate**: Disable feature flag → hides all eBay UI
2. **Soft rollback**: Stop new connections, existing listings remain
3. **Hard rollback**: End all eBay listings, delete connections (last resort)

---

## 14. Testing Strategy

### 14.1 Test Categories

| Category | Scope | Tools |
|----------|-------|-------|
| **Unit Tests** | Individual functions, mappers, validators | Jest |
| **Integration Tests** | API endpoints, database operations | Jest + Supertest |
| **E2E Tests** | Full user flows | Playwright |
| **Contract Tests** | eBay API compatibility | Pact |
| **Load Tests** | Performance under load | k6 |

### 14.2 Key Test Scenarios

#### Unit Tests
- [ ] Token encryption/decryption
- [ ] Condition mapping (Trovelr → eBay)
- [ ] Title truncation
- [ ] Price formatting
- [ ] Webhook signature verification
- [ ] OAuth state validation

#### Integration Tests
- [ ] OAuth flow (mock eBay responses)
- [ ] Create eBay listing (mock eBay API)
- [ ] End eBay listing
- [ ] Handle webhook (sold notification)
- [ ] Token refresh job
- [ ] Error handling and rollback

#### E2E Tests
- [ ] Full OAuth connect flow
- [ ] Cross-post a listing
- [ ] Mark as sold → verify eBay listing ended
- [ ] Receive sold webhook → verify Trovelr updated
- [ ] Disconnect eBay account

### 14.3 eBay Sandbox Testing

```typescript
// Use sandbox for all non-production testing
const EBAY_CONFIG = {
  development: {
    authUrl: 'https://auth.sandbox.ebay.com/oauth2/authorize',
    apiUrl: 'https://api.sandbox.ebay.com',
    clientId: process.env.EBAY_SANDBOX_CLIENT_ID,
    clientSecret: process.env.EBAY_SANDBOX_CLIENT_SECRET
  },
  production: {
    authUrl: 'https://auth.ebay.com/oauth2/authorize',
    apiUrl: 'https://api.ebay.com',
    clientId: process.env.EBAY_CLIENT_ID,
    clientSecret: process.env.EBAY_CLIENT_SECRET
  }
};
```

---

## 15. Monitoring & Observability

### 15.1 Metrics to Track

| Metric | Type | Alert Threshold |
|--------|------|-----------------|
| `ebay.oauth.connect.success` | Counter | N/A |
| `ebay.oauth.connect.failure` | Counter | >5 in 5 min |
| `ebay.oauth.token_refresh.success` | Counter | N/A |
| `ebay.oauth.token_refresh.failure` | Counter | >3 in 5 min |
| `ebay.listing.create.success` | Counter | N/A |
| `ebay.listing.create.failure` | Counter | Error rate >5% |
| `ebay.listing.create.latency_ms` | Histogram | p99 >10s |
| `ebay.webhook.received` | Counter | N/A |
| `ebay.webhook.processed` | Counter | N/A |
| `ebay.webhook.failed` | Counter | >0 |
| `ebay.api.rate_limited` | Counter | >10 in 5 min |
| `ebay.connection.active` | Gauge | N/A |
| `ebay.listing.active` | Gauge | N/A |

### 15.2 Logging

```typescript
// Structured logging for eBay operations
logger.info('eBay listing created', {
  service: 'ebay-integration',
  operation: 'create_listing',
  userId: user.id,
  listingId: listing.id,
  ebayListingId: result.listingId,
  durationMs: performance.now() - start,
  success: true
});

logger.error('eBay API call failed', {
  service: 'ebay-integration',
  operation: 'create_inventory_item',
  userId: user.id,
  listingId: listing.id,
  error: error.message,
  errorCode: error.code,
  ebayErrorId: error.ebayErrorId,
  attempt: retryCount,
  success: false
});
```

### 15.3 Alerts

| Alert | Condition | Severity | Action |
|-------|-----------|----------|--------|
| High OAuth failure rate | >5 failures in 5 min | Warning | Check eBay status |
| Token refresh failing | >3 failures in 5 min | Critical | Page on-call; users can't sync |
| Webhook processing failed | Any failure | Warning | Investigate; may need manual intervention |
| API rate limited | >10 in 5 min | Warning | Review usage patterns |
| Listing creation p99 >10s | Latency threshold | Warning | Check eBay API performance |

### 15.4 Dashboard Panels

1. **eBay Connection Status**
   - Active connections count
   - Connections by status (active, expired, error)
   - New connections over time

2. **Listing Activity**
   - Cross-posts per day
   - Success vs failure rate
   - Listings by status (active, sold, ended)

3. **Sync Health**
   - Webhook volume
   - Sync latency distribution
   - Error breakdown by type

4. **API Performance**
   - eBay API latency by endpoint
   - Rate limit hits
   - Token refresh timing

---

## 16. Future Considerations

### 16.1 Potential Enhancements (v2+)

| Feature | Description | Complexity |
|---------|-------------|------------|
| **eBay → Trovelr sync** | Pull edits made on eBay back to Trovelr | Medium |
| **Auction support** | Support eBay auction-style listings | Medium |
| **Bulk cross-post** | Post multiple listings to eBay at once | Low |
| **eBay analytics** | Show views, watchers from eBay | Medium |
| **Promoted listings** | Support eBay promoted listings | High |
| **International** | Support eBay UK, DE, AU marketplaces | High |
| **eBay messaging** | Forward eBay buyer messages to Trovelr | High |
| **Shipping integration** | Generate eBay shipping labels | High |

### 16.2 Scalability Considerations

- **Token refresh job**: As user count grows, batch token refreshes
- **Webhook processing**: Move to queue-based processing for high volume
- **API rate limits**: Implement user-level rate limiting; consider eBay API call pooling
- **Database**: Partition sync_logs table by date for cleanup

### 16.3 Compliance & Legal

- **GDPR**: Handle eBay account deletion notifications (required by eBay)
- **eBay TOS**: Ensure compliance with eBay's API License Agreement
- **Data retention**: Define retention policy for sync logs
- **User consent**: Clear disclosure that we store eBay tokens

---

## Appendix A: eBay API Response Examples

### A.1 Create Inventory Item Response

```json
{
  "sku": "trovelr_abc123",
  "locale": "en_US",
  "product": {
    "title": "Vintage Wooden Chair",
    "description": "Beautiful vintage chair...",
    "imageUrls": [
      "https://trovelr.com/images/abc123-1.jpg"
    ]
  },
  "condition": "USED_GOOD",
  "availability": {
    "shipToLocationAvailability": {
      "quantity": 1
    }
  }
}
```

### A.2 Create Offer Response

```json
{
  "offerId": "5678901234",
  "sku": "trovelr_abc123",
  "marketplaceId": "EBAY_US",
  "format": "FIXED_PRICE",
  "pricingSummary": {
    "price": {
      "value": "50.00",
      "currency": "USD"
    }
  },
  "listingPolicies": {
    "fulfillmentPolicyId": "policy123",
    "returnPolicyId": "policy456",
    "paymentPolicyId": "policy789"
  },
  "categoryId": "11700",
  "status": "UNPUBLISHED"
}
```

### A.3 Publish Offer Response

```json
{
  "listingId": "123456789012",
  "offerId": "5678901234",
  "statusCode": 200,
  "listingIdUnified": "v1|123456789012|0"
}
```

### A.4 Sold Webhook Payload

```json
{
  "metadata": {
    "topic": "MARKETPLACE_ITEM_SOLD",
    "schemaVersion": "1.0"
  },
  "notification": {
    "notificationId": "notif-abc123",
    "eventDate": "2024-01-16T14:30:00.000Z",
    "data": {
      "itemId": "123456789012",
      "transactionId": "9876543210",
      "sellerId": "seller123",
      "buyerId": "buyer456",
      "price": {
        "value": "50.00",
        "currency": "USD"
      },
      "quantity": 1
    }
  }
}
```

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **Cross-post** | Publishing a listing to multiple marketplaces simultaneously |
| **SKU** | Stock Keeping Unit - unique identifier for inventory items |
| **Offer** | eBay's representation of a listing before/after publication |
| **Inventory Item** | eBay's representation of a product in your inventory |
| **Business Policies** | eBay seller policies for shipping, returns, and payment |
| **Webhook** | HTTP callback notification from eBay when events occur |
| **OAuth** | Open Authorization - protocol for secure API authorization |
| **Source of Truth** | The authoritative system for a piece of data |

---

*Document Version: 1.0*
*Last Updated: January 2024*
*Author: Trovelr Engineering*
