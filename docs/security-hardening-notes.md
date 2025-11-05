# Security hardening summary

## Origin guard false positives

**Issue.** The original CSRF origin guard rejected every non-GET/HEAD/OPTIONS request when the `Origin` or `Referer` header was missing. Legitimate API clients such as native mobile apps and command-line tools routinely omit these headers, so the guard blocked their POST/PUT/PATCH/DELETE calls with `403 bad_origin` even when the request was authenticated.

**Impact.** Blocking these requests effectively made the API unusable for first-party clients that do not send browser-style headers, leading to failed form submissions, broken automation, and support burden.

**Resolution.** The new guard now only compares the header values when they are present. If both headers are missing, the request is allowed to continue, restoring support for headerless clients while keeping the host check for browsers. 【F:server.js†L713-L765】

## Plaintext reset and verification token retention

**Issue.** Password-reset tokens and email verification codes were cached in process memory as raw values with no expiry or size limit. Every generated token stayed in memory indefinitely as long as the process ran.

**Impact.** This created two risks: unbounded memory growth proportional to the number of unique addresses and exposure of sensitive secrets if the process memory or logs were inspected.

**Resolution.** Both caches now use a bounded, expiring in-memory store. Entries automatically expire after an hour (reset tokens) or 30 minutes (verification codes), and the cache only retains plaintext values during automated tests. This prevents long-lived plaintext secrets and caps memory usage. 【F:mail-service.js†L1-L119】
