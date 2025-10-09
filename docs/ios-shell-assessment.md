# iOS Shell Readiness Assessment

This document summarises the current ListIt repository state and outlines a practical path to wrap the existing experience in an iOS shell application. The aim is to identify which assets can be reused as-is, which pieces need refactoring for native reuse, and how to stage the implementation.

## 1. Current Repository Snapshot

- **Backend** – The Express server exposes REST and WebSocket contracts that already carry version metadata and validation hooks (`versionMiddleware`, schema guards, push notification endpoints). These contracts are documented for client teams in `docs/backend-contracts.md`, giving us a stable target for native consumers.
- **Web client bootstrap** – The browser build still mounts through `window.ListItApp.bootstrap.createBrowserApp`, expecting React/ReactDOM globals and a `window.ListItCore` bundle (`public/app.js`). This tells us the UI is delivered as a classic static bundle whose lifecycle is controlled from JavaScript, making it straightforward to host inside a WebView shell without reworking routing immediately.
- **Shared core** – A modular `@listit/core` package already lives in `packages/core` and exposes an API client factory that only depends on a Fetch implementation. The factory centralises authentication handling, push subscription, and listing CRUD helpers, giving us a natural boundary for code shared between the WebView and any Swift/React Native layer.
- **Build tooling** – The repository still serves `/public` assets through the Express server and relies on bespoke scripts instead of a modern bundler. There is no mobile build or asset pipeline yet, so we must introduce one to generate offline-friendly bundles for iOS packaging.

## 2. Target Experience for the First iOS Shell

Given the existing code, the fastest path to shipping an iOS app is a WebView container that loads the production web bundle while progressively introducing native affordances. This can be achieved either with a thin SwiftUI `WKWebView` host or a Capacitor/React Native shell. The following principles keep the shell maintainable:

1. **Ship the existing UI unmodified** to validate authentication, listings, messaging, and S3 uploads end to end.
2. **Expose bridge hooks** for capabilities that need native integrations (push notifications, share sheet uploads, background refresh) while keeping business logic in shared JavaScript modules.
3. **Refactor incrementally** – consolidate shared logic inside `@listit/core`, then replace individual screens with native SwiftUI components once telemetry justifies the effort.

## 3. Implementation Roadmap

### Step 0 – Stabilise shared assets
- Harden `@listit/core` so it can be consumed by both the browser and native bridge layers: ensure the package ships ESM/CJS builds with proper typings and no reliance on browser globals.
- Add automated tests around `createApiClient` and any other shared utilities so regressions are caught before they reach the shell.

### Step 1 – Produce an embeddable web bundle
- Introduce a bundler (Vite, Rollup, or esbuild) to emit a versioned `/public` bundle that can be copied into the iOS project at build time.
- Configure the build to output both online (`https://` hosted) and offline (local file URL) variants. For offline mode ensure API base URLs remain configurable via environment or injected script so the shell can point to staging/production servers.
- Automate asset checksum generation so the iOS app can detect stale bundles and fall back to the network when needed.

### Step 2 – Create the native shell project
- Scaffold an Xcode workspace with a SwiftUI app hosting a `WKWebView`. Xcode remains the IDE of record for provisioning profiles, signing, and simulator/device debugging.
- Inject the production URL for live builds and the packaged bundle for offline development using an app configuration plist so different schemes (Debug, Staging, Release) map cleanly to backend environments.
- Implement JavaScript ↔ Swift bridges using `WKScriptMessageHandler` to exchange events (`window.webkit.messageHandlers`). Start with analytics and error reporting, then extend to session lifecycle hooks (e.g., sign-out, maintenance modals).
- Mirror the Express cookie-based auth flow by enabling shared `WKWebsiteDataStore` cookies and, if necessary, relaying JWT refresh events from JavaScript to native code.

### Xcode workflow & testing cadence
- **Primary touch points** – Xcode is required to create the Swift target, manage signing certificates, and run the app in the iOS Simulator or on physical devices. Even if most UI changes happen in the web bundle, shell developers will open Xcode to wire new bridge APIs, update app icons, or adjust entitlements.
- **When to run the simulator** – Every PR that modifies Swift shell code, native bridges, or bundled assets should include a smoke test in the simulator (launch, login, navigate core flows). For web-only changes that do not touch the iOS bundle, simulator runs are optional but recommended before release candidates.
- **Automation** – Longer term, add a fastlane lane or `xcodebuild` command to CI that builds the shell against the latest web artefact to catch compilation/signing regressions without manual simulator runs on every PR.

### Step 3 – Native capability bridges
- **Push notifications** – Use Apple Push Notification service (APNs) on the native side. Forward device tokens to the backend via a new endpoint or reuse `/api/push/subscribe` by extending it to understand native payloads.
- **File & photo uploads** – Present `PHPickerViewController` or share-sheet entry points in Swift, then pass selected files to the web layer. The existing web bundle already supports presigned S3 uploads; we can reuse those flows by injecting upload tokens or by posting the file metadata to a new Swift-managed uploader that calls the same backend endpoints.
- **Deep links & share extensions** – Handle universal links in Swift, then communicate the intent (e.g., open conversation, prefill listing) to the WebView via JavaScript bridge events.

### Step 4 – Progressive native rewrites (optional medium term)
- Prioritise high-friction screens (e.g., MassList flows, conversation list) for native SwiftUI rewrites once the shared `@listit/core` exposes pure data operations. This reduces dependence on the WebView and improves performance while keeping networking/business rules centralised.

## 4. Dependencies & Tooling Updates

- Add workspace management to `package.json` (npm workspaces or pnpm) so `packages/core` and future shared modules build consistently.
- Introduce a CI step that produces the iOS web bundle artefact alongside existing tests. Publish the bundle to an artefact store so Xcode builds can download it without hitting the production server.
- Document environment variables (API base URL, feature flags, S3 configuration) required by both the Express server and the shell, ensuring they can be injected at runtime via configuration files or remote feature flag services.

## 5. Risks & Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Cookie-based auth failing inside WKWebView | Users stuck on login | Enable `WKWebpagePreferences.allowsContentJavaScript`, share cookies through `HTTPCookieStorage.shared`, and consider adding token-based fallbacks exposed by `@listit/core` if WebView storage proves brittle. |
| Upload latency with large images in WebView | Poor UX vs native expectations | Implement a Swift uploader that hands presigned URLs to `@listit/core`, or progressively enhance the existing JavaScript uploader with background transfer support via native bridge. |
| Divergent push notification handling | Missed conversations/listing alerts | Unify push subscription flows by extending backend contracts to accept APNs device tokens and align message payload formats with the documented schema. |

## 6. Next Actions

1. Formalise the bundling strategy and add scripts that emit an iOS-ready asset bundle.
2. Draft the SwiftUI shell with a proof-of-concept WebView loading staging assets.
3. Define the JavaScript ↔ native bridge API surface (e.g., `listit://` custom messages) and capture it in shared documentation so both teams can evolve it safely.
4. Schedule backend updates to accept native push tokens and to surface platform metadata in `push_meta` so the shell knows which channels are active.

This staged plan lets us ship an App Store-ready shell quickly while laying the groundwork for deeper native integrations as `@listit/core` matures.
