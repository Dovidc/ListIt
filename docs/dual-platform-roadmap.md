# Dual-Platform Roadmap

This roadmap outlines the major workstreams required to evolve ListIt from a browser-only React application into a codebase that serves both the existing web client and an upcoming Xcode-delivered iOS experience.

## 1. Establish a Shared Core Package
- Extract reusable business logic (API client, validation, model transformers, feature services) from `public/app.js` into framework-agnostic modules published under a new `shared/` or `packages/core/` workspace.
- Convert the extracted modules to TypeScript or modern ES modules, add unit tests, and expose typed entry points that can be consumed by both the web bundler and native build tooling.
- Introduce a bundling step (e.g., Vite, Rollup, or tsup) that can output both browser-friendly bundles and Node-compatible builds for reuse in native bridge layers.

## 2. Modularize the Web Client
- Split the monolithic React bundle into feature folders (auth, listings, uploads, notifications) that import the shared core instead of duplicating logic.
- Replace global state managed inside the 7k-line `App` component with context providers and hooks per feature so behavior is easier to reuse or port.
- Add integration tests that exercise the shared modules through the refactored web UI to prevent regressions while the codebase is being reorganized.

## 3. Harden the Backend Contracts
- Document the existing REST and WebSocket endpoints, payload schemas, and authentication flows so both clients have stable contracts to target.
- Add automated schema validation (e.g., using `zod` or `joi`) and response snapshots to detect breaking changes before they reach either client.
- Implement versioning or feature-flag strategies for server endpoints so the native app can evolve independently from the browser without forcing simultaneous releases.

## 4. Prepare Native Platform Abstractions
- Define interface layers for features that require platform-specific implementations (push notifications, file uploads, persistent storage, background sync).
- Provide browser implementations inside the web client and plan native counterparts (Apple Push Notification service, Photos picker, Keychain/CoreData, background tasks) that adhere to the same interfaces.
- Evaluate bridging strategies: a thin Swift wrapper around the shared JavaScript bundle (via JavaScriptCore/React Native) or rewriting the UI natively while reusing the shared business logic and API contracts.

### Choosing the Right iOS Approach
- **Full Native (SwiftUI/UIKit)** – Highest degree of customization and access to platform features. Reuse the shared business logic via modularized TypeScript/ESM bundles exposed as Swift Packages or through a lightweight JS runtime. Plan to rebuild screens with SwiftUI components while calling into the shared core for data and state.
- **Hybrid Bridge (React Native/Expo or Capacitor)** – Faster to ship because the existing React mental model carries over. Wrap the shared core as a reusable package, then implement platform-specific modules (e.g., notifications, file system) in Swift that are exposed to JavaScript through the bridge. Customization is limited by the bridge’s rendering model but still allows native modules when you need to drop down to Swift.
- **Enhanced Web (PWA/WebView Shell)** – Lowest engineering lift since the current web UI runs inside a WKWebView shell. Offers minimal native customization, so reserve this for interim distribution or if App Store requirements are minimal.
- Decide up front which path balances your customization requirements, maintenance budget, and release cadence. All approaches benefit from the shared core, typed contracts, and interface boundaries defined above.

## 5. Set Up Native Project Infrastructure
- Initialize an Xcode workspace that mirrors the web app's feature boundaries and can import the shared core package. For the shared JavaScript bundle, provide two consumption options: (1) compile it to an XCFramework via Swift Package Manager for SwiftUI/UIKit usage, and (2) embed the bundle inside a JavaScriptCore runtime for fast iteration. Wire the workspace to the existing Express backend by reusing the same `.env` contract (base URL, API keys) and adding per-scheme overrides for staging vs. production.
- Stand up thin Swift service layers (AuthService, ListingsService, UploadService) that call into the shared validation and transformation logic before talking to `URLSession` or WebSockets. Persist auth tokens and cached data using a Keychain + CoreData stack that can later be swapped for platform abstractions defined in Step 4.
- Establish a native design system that unlocks full SwiftUI customization: codify typography, spacing, and color tokens in Swift packages, expose dynamic type scaling, and create reusable components (navigation chrome, cards, pickers) that map to ListIt's brand but leverage platform idioms like large titles, swipe actions, and contextual menus. Ensure each component can bind to the shared core view models so feature parity is maintained while the UI remains fully native.
- Define platform-specific capability shims that go beyond the bridge requirements in Step 4. Implement native-only hooks such as haptic feedback, Live Activities, lock-screen widgets, and Siri/App Intent integrations so the iOS experience differentiates from the web. Maintain lightweight adapters that translate shared feature events into these native affordances without leaking platform code back into the shared core.
- Ship a native design system package that reads theme tokens from the shared environment contract (`LISTIT_IOS_THEME_*`) so product teams can reskin typography, spacing, and component styles without recompiling JavaScript. Pair the theme loader with SwiftUI previews (e.g., a `ThemePlaygroundView`) to let designers iterate on palettes and motion in isolation.
- Document the customization workflow inside the iOS workspace: add preview-driven SwiftUI sample targets, theming playgrounds, and snapshot tests that guard bespoke UI polish. Treat these as first-class artifacts checked into the repo so designers and native engineers can iterate independently of the web release cadence.
- Set up native CI alongside the web pipeline: use Fastlane to drive unit/UI tests and TestFlight uploads, and add a GitHub Actions workflow that runs `xcodebuild test` on pull requests, produces archived builds on main merges, and publishes build artifacts for QA. Configure the workflow to reuse backend contract fixtures so both platforms validate against the same schemas.

## 6. Rollout & Maintenance Strategy
- Adopt feature parity guidelines so new capabilities land in the shared core first, then receive platform-specific UI implementations.
- Monitor analytics and error reporting for both clients to ensure contract stability and performance expectations are met.
- Schedule periodic cross-platform audits to reconcile divergences and keep the shared modules lean, well-tested, and platform-agnostic.

Following these steps will let you maintain a single source of truth for business logic while delivering tailored user experiences on the web and in a native iOS application compiled through Xcode.
