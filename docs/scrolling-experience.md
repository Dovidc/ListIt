# Mobile scrolling experience after performance refactor

## What users will notice
- **Smoother flick scrolling on phones.** Scroll and resize work is now scheduled with `requestAnimationFrame`, so the app updates its grid and pagination state once per frame instead of reacting to every momentum tick. Fast flicks feel steadier and are less likely to stutter or reload the WebView. 
- **Listings load at the right moment without over-fetching.** Infinite scroll now reuses the mobile scroll container, checks distance from the bottom inside animation frames, and throttles requests. Users see the next page appear when they get close to the end of the grid without bursts of requests during rapid swipes.
- **Fewer "spin back to the homepage" crashes.** Pace detection watches scroll speed and temporarily switches to smaller batches when swipes are very fast, reducing CPU and memory spikes that previously caused the WebView to refresh.

## Technical references
- Scroll-driven pagination is throttled and pace-aware around the `main.container` scroll area, using animation-frame scheduling and near-bottom checks to trigger loads only when appropriate.【F:public/app/features/listings.js†L405-L562】
- Virtual grid measurements for scroll position and viewport height now run once per animation frame on the same mobile scroll container, avoiding redundant state updates during momentum scrolling.【F:public/app/helpers.js†L32-L140】
