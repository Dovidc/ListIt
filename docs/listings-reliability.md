# Listing view reliability improvements

This summarizes the behaviors that make the browsing experience resilient after the recent updates:

- **Abortable fetches with retry:** Each listing request uses an `AbortController` so superseded requests are cancelled before starting another. When an error surfaces (including auth expiry), the UI keeps already-loaded items on screen, shows the error inline, and offers a Retry button that reuses the current filters instead of dumping the session.
- **Safer pagination reset:** Pagination state resets when the query or location changes, preventing old cursors from corrupting the next request and ensuring the first page is always fresh.
- **Auto-load first, manual fallback always available:** Infinite scroll remains the default through an `IntersectionObserver` sentinel that prefetches the next page about 400px before the end. If the environment doesn’t support the observer, the UI tells the user and still provides a Load more button so they can continue manually.
- **Predictable memory footprint:** The listing array is capped to the newest 500 entries so long browsing sessions stay responsive without leaking memory, while deduplication prevents duplicate cards when a page overlaps with the prior one.
- **Smaller, privacy-safer requests:** The default page size is reduced to 48 items, keeping payloads lighter under spotty networks, and server logs no longer include raw latitude/longitude—only whether coordinates were present—reducing sensitive data exposure during errors.

These changes work together to keep the list responsive, recoverable, and trustworthy even when networks or auth sessions are unstable.
