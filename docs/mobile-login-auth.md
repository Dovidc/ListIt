# Mobile login 401 errors and bearer token persistence

## Issue summary
Mobile builds embed the Capacitor webview, so requests originate from the custom scheme `capacitor://localhost`. The login endpoint replies with a JSON payload that includes the authenticated user and a `token` string, and it also sets a `token` cookie. Browsers automatically replay that cookie, but the webview does **not**. Because the cookie is missing, every follow-up API request (for example `/api/me`) reaches the server without any authentication information and the API answers with `401 Unauthorized`.

## Resolution
The core API client now detects JWTs returned in the login JSON and stores them in memory. For each subsequent request it injects an `Authorization: Bearer <token>` header (unless one is already provided manually). If the server responds with `401`, the client clears the cached token so the app falls back to the login flow. This mirrors the server's cookie behaviour for browsers and keeps the native wrapper authenticated without relying on cookie support.

Refer to the implementation in `packages/core/src/index.js` for the token capture and header injection, and in `tests/core/apiClient.test.js` for a regression test that exercises the flow.
