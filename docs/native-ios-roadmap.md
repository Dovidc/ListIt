# Native iOS Feature & Visual Parity Roadmap

This roadmap outlines the steps required to deliver a fully native SwiftUI implementation of ListIt that offers functionality comparable to the web client while preserving a cohesive visual identity.

## Shared Core & Configuration
- [ ] Harden the shared JavaScript bundle so **all** web-exposed APIs (listings CRUD, nearby, conversations, uploads, admin tools) are exported for Swift via `SharedCoreBridge` using both embedded script and XCFramework distribution options.
- [ ] Expand Swift service wrappers to cover every exported API, mirroring request/response helpers such as `normalizeListingsResponse` and `formatDistance` so native features inherit consistent business logic.

## Visual Alignment & Theming
- [ ] Capture the web palette, typography, spacing, and control shapes in environment theme tokens so `DesignSystemProvider` reproduces comparable styling by default across SwiftUI and UIKit surfaces.
- [ ] Add reusable SwiftUI component variants (brand headers, masonry grids, modal cards, pill filters) that echo key web visuals, enabling native screens to opt into familiar patterns without bespoke styling.
  - [x] Ship a pill filter control styled with design tokens so list and nearby filters can match the web experience.

## Navigation & Surface Structure
- [x] Mirror the browser shell's navigation entry points (Listings, Nearby, Messages, Profile, Admin) within the SwiftUI tab/stack hierarchy so the native app exposes the same primary flows.
- [x] Surface profile/preferences toggles (auto list, AI description, auto-post nearby, inquiry, notifications) in native settings screens with the same defaults and helper text as the React experience.

## Feature Parity Builds
- [x] Implement a SwiftUI Nearby feature with geolocation prompts, radius/search controls, masonry results, and listing actions powered by shared-core data.
- [ ] Expand Listings to include search, filters, infinite scrolling, detail sheets, AI-assisted creation/editing, mass list, and cover management via shared-core helpers and upload services.
- [ ] Port the messaging inbox and thread UI, including unread indicators, attachments, lightbox, and deletion flows, backed by shared messaging APIs.
- [ ] Rebuild admin dashboards, ads management, and reporting workflows using the admin endpoints exposed through the shared core.

## Platform Capabilities & Polish
- [ ] Connect shared-core events (favorites, uploads, messages, admin alerts) to capability adapters for haptics, Live Activities, widgets, and intents so native affordances reinforce major interactions.
- [ ] Establish SwiftUI previews, snapshot/UI tests, and Fastlane automation that validate themed components and feature flows against shared-core fixtures, keeping the native build aligned with web contracts.

