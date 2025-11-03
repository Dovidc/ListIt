# Backend Contracts

This document captures the server-side API surface that both the web client and the upcoming native application consume. It consolidates request/response expectations, documents authentication flows, and explains the versioning and validation layers introduced in roadmap step 3.

## API Versioning

* Clients send the desired contract version with the `X-API-Version` header. Optional fallbacks include `X-Client-Version`, `X-App-Version`, or the `apiVersion` query parameter.
* The server currently supports `2024-06-01` (latest) and `2024-04-15`. Requests that declare an unsupported version receive `412 Precondition Failed` with the supported set. Supported responses always echo the resolved version and latest version via `X-API-Version` and `X-API-Latest` headers.
* Feature gates are derived from the version: `structuredListings` unlocks at `2024-04-15` and `richConversations` at `2024-06-01`. The resolved feature flags are exposed on `req.featureFlags` for downstream handlers.

## Authentication Flows

### Register `POST /api/register`

* **Body** – `{ username, email, password }` (username 3–32 chars, password ≥6 chars). Older clients may still post `name`; the validator normalises it to `username`.
* **Response** – `{ status: 'verification_required', email }` after staging the new user record and issuing a six-digit verification code via email.
* **Notes** – Users must confirm the emailed code via the endpoint below before receiving an auth cookie.

### Confirm Registration `POST /api/register/verify`

* **Body** – `{ email, code }` where `code` is the six-digit token from the email.
* **Response** – Authenticated user payload identical to login (`{ id, email, username, is_admin, account_status, created_at, status_note, status_updated_at, last_login_at, token, push_meta }`).
* **Errors** – `400 invalid_code`, `400 verification_expired`, `400 verification_not_requested`, `403 account_banned`.

### Login `POST /api/login`

* **Body** – `{ email, password }` (same formatting rules as register).
* **Response** – Same payload shape as verification with `last_login_at` reflecting the latest login timestamp.
* **Errors** – `401` for invalid credentials, `403` for banned accounts, and `403 email_unverified` when verification is still pending (a fresh code is emailed on each attempt). Validation errors land as `400 invalid_request` with per-field issues.

### Password Reset `POST /api/password/reset/request`

* **Body** – `{ email }`.
* **Response** – `{ ok: true }` regardless of whether the email exists (to avoid disclosure).
* **Behaviour** – Generates a one-hour reset token, stores its hash on the user record, and sends the plaintext token via the configured support email transport.

### Password Reset Confirm `POST /api/password/reset/confirm`

* **Body** – `{ email, token, password }`.
* **Response** – `{ ok: true }` once the password is updated and the token cleared.
* **Errors** – `400 invalid_token` for unknown tokens, `400 token_expired` when the stored token has lapsed, `500 reset_failed` for unexpected errors.

### Session Management

* `POST /api/logout` clears the auth cookie and always succeeds (idempotent).
* `GET /api/me` returns the authenticated profile using the same shape as login without a `token` field.

## Listings

### Create Listing `POST /api/listings`

* **Headers** – Requires authentication and a supported API version.
* **Body** –
  ```json
  {
    "title": "Trail bike",
    "description": "< 400 chars",
    "location": "City, ST",
    "price": 120.5,
    "upload_tokens": ["<12 presigned upload tokens>"],
    "tags": ["bike", "trail"],
    "enable_nearby": true,
    "lat": 40.72,
    "lon": -73.99
  }
  ```
* **Validation** – Title ≤80 chars, location ≤80 chars, non-negative price, at least one upload token (deduped to 12). Tags are normalised to lowercase alphanumeric slugs, geocoordinates are optional.
* **Response** – Normalised listing record with canonicalised `image_data`, e.g. `{ id, user_id, title, description, location, price, created_at, tags, enable_nearby, image_data }` plus any persisted metadata.

### Update Listing `PUT /api/listings/:id`

* **Body** – Partial update; accepts any combination of `title`, `description`, `location`, `price`, `tags`, `enable_nearby`, `sold`, `lat`, `lon`, and `deletedImages` (array of canonical image URLs to remove).
* **Validation** – At least one recognised field must be present. Length and numeric constraints mirror creation. Unknown fields are passed through for backward compatibility but do not satisfy the minimum-field requirement.
* **Response** – Updated listing record (same shape as creation response).

### Listing Retrieval

* `GET /api/listings` returns the paginated marketplace feed.
* `GET /api/users/:id/listings` returns public listings for a specific user.
* `GET /api/listings/:id/images` enumerates stored image assets per listing.

## Conversations & Messaging

### Create Conversation `POST /api/conversations`

* **Body** – `{ with_user_id, listing_id? }`. For admin inbox sharing, existing threads are reused.
* **Response** – Conversation envelope including membership metadata. Responds with `404` when the target user or listing is missing.

### Send Message `POST /api/conversations/:id/messages`

* **Body** – At least one of `body` (trimmed ≤2000 chars) or `images` (≤10 strings pointing to data URIs or HTTPS assets). Empty bodies are rejected with `400 invalid_request` and a `body` issue entry.
* **Response** – `{ message: {...}, other_user_deleted: boolean }` where `message` includes canonicalised `images`, sender metadata, and timestamps. Response validation ensures numeric identifiers and array payloads stay in sync with consumer expectations.
* **WebSocket Broadcast** – Each accepted message is fanned out via `/ws` as `{ type: 'new_message', conversation_id, message, sender_id, recipient_id, listing_id }` to subscribed participants.

## Uploads

* `POST /api/uploads/sign` and `POST /api/uploads/finalize` orchestrate S3 presigned uploads. Finalisation returns an `uploadToken` referenced in listing creation. The validator enforces that listings provide at least one valid token.

## Push Notifications

* `POST /api/push/subscribe` stores browser push subscriptions (requires auth).
* `DELETE /api/push/unsubscribe` removes a stored subscription.
* Push availability is reflected in `push_meta.available` so native clients can decide whether to hydrate device-specific channels.

## Error Envelope

Validation middleware standardises request errors:

```json
{
  "error": "invalid_request",
  "version": "2024-06-01",
  "latest": "2024-06-01",
  "issues": [
    { "path": "email", "message": "Email must be valid", "code": "invalid_email" }
  ]
}
```

Server-side schema checks guard responses. Failures surface as `500 response_validation_failed` and log detailed issue lists during development/testing.

## WebSocket Contract

* Endpoint: `wss://<host>/ws` (or `ws://` in development).
* **Authentication** – Provide the JWT via `token` query string (`/ws?token=<jwt>`) or by reusing the `token` cookie. Invalid/missing tokens result in `1008` closes.
* **Messages** –
  * Server → Client handshake: `{ type: 'connected', userId }`.
  * Heartbeat: clients should respond to `ping` frames; the server sends `pong` replies when receiving `{ type: 'ping' }` messages.
  * Conversation updates: `new_message` payloads mirror the REST response structure described above, keeping clients synchronised.

## Testing & Snapshots

* Contract-level Jest tests live in `tests/contracts/api-contracts.test.js` and assert:
  * Registration responses remain stable (snapshot sanitises dynamic fields).
  * Invalid payloads emit granular field issues.
  * Version negotiation rejects unsupported clients before hitting business logic.
  * Messaging endpoints enforce body/image requirements.

Use `npm test` to execute the schema contract suite alongside existing integration coverage.

