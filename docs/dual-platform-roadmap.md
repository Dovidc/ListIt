# Dual-Platform Roadmap

This roadmap outlines the major workstreams required to evolve ListIt from a browser-only React application into a codebase that serves both the existing web client and an upcoming Xcode-delivered iOS experience.

## 1. Establish a Shared Core Package
- Extract reusable business logic (API client, validation, model transformers, feature services) from `public/app.js` into framework-agnostic modules published under a new `shared/` or `packages/core/` workspace.
- Convert the extracted modules to TypeScript or modern ES modules, add unit tests, and expose typed entry points that can be consumed by both the web bundler and native build tooling.
- Introduce a bundling step (e.g., Vite, Rollup, or tsup) that can output both browser-friendly bundles and Node-compatible builds for reuse in native bridge layers.
- Ship an initial shared build that exposes a stable global (e.g., `window.ListItShared.createApiClient`) for the legacy web bundle while emitting CommonJS/ESM outputs native tooling can import during early integration work.

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

## 5. Set Up Native Project Infrastructure
- Create an Xcode workspace configured to consume the shared core (as a compiled module or via a JavaScript runtime) and wired to the existing Express backend for API calls.
- Implement authentication, data fetching, and storage using the documented server contracts and shared validation logic.
- Add platform-specific CI pipelines that build, test, and package the native app alongside the existing web CI to keep both experiences aligned.

## 6. Rollout & Maintenance Strategy
- Adopt feature parity guidelines so new capabilities land in the shared core first, then receive platform-specific UI implementations.
- Monitor analytics and error reporting for both clients to ensure contract stability and performance expectations are met.
- Schedule periodic cross-platform audits to reconcile divergences and keep the shared modules lean, well-tested, and platform-agnostic.

Following these steps will let you maintain a single source of truth for business logic while delivering tailored user experiences on the web and in a native iOS application compiled through Xcode.
