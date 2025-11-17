# ListIt

## Local environment variables

1. Copy `.env.example` to `.env.local` (preferred) or `.env` in the project root.
2. Fill in the values you need for your environment. Any values already supplied in the example file are safe development defaults.
3. Start the API service with `npm start` — environment variables from `.env.local`/`.env` are automatically loaded before the application boots.

## Service processes

ListIt now runs as three cooperating services so the HTTP API, WebSocket gateway, and background workers can scale independently:

| Script | Purpose |
| --- | --- |
| `npm run start:api` | Boots the Express API on `PORT` (also available as the default `npm start`). |
| `npm run start:realtime` | Runs the standalone WebSocket service on `REALTIME_PORT` (defaults to `4000`) and relays events from the message bus to connected clients. |
| `npm run start:worker` | Consumes background jobs (push notifications, nearby alerts) from the message bus. |

For local development run each command in its own terminal. In production deploy them as separate containers/pods so a crash or GC pause in one service does not impact the others.

### Message bus configuration

Both the worker and realtime services subscribe to the shared message bus. Set `MESSAGE_BUS_URL` (or `REDIS_URL`) to a Redis connection string so events fan out across all processes. If no URL is provided—or Redis cannot be reached—the bus falls back to an in-memory emitter, which is sufficient for single-process development but not for horizontal scaling. Install the optional `ioredis` package if you want the bus to speak to Redis in your environment.

Environment variables explicitly set in your shell always take precedence over the values in the file. To avoid accidentally committing secrets, `.env`, `.env.local`, and other environment-specific files are ignored by Git, while `.env.example` remains tracked as the canonical reference.

### Frontend realtime client configuration

The browser and native shells derive the WebSocket URL with `helpers.resolveRealtimeWebSocketUrl`. By default the helper connects back to the current origin (or `ws://localhost:4000/ws` when running on `localhost`). You can override the target in three ways:

1. Set `window.LISTIT_REALTIME_URL` (or `window.ListItRealtimeUrl`) before the app bundle loads. Provide the full `ws://`/`wss://` URL.
2. On native shells, edit `public/index.html` to change the `<meta name="listit-realtime-base">` value or expose a `window.ListItRealtimePort` if only the port differs.
3. Persist an override in `localStorage` under `listit.realtimeBaseUrl`/`listit.realtimePort` for debugging custom routing setups.

These overrides ensure the SPA continues to reach the realtime gateway even when it runs on a different host/port than the HTTP API.

## Database configuration

The API requires a PostgreSQL database. Set `DATABASE_URL` in your `.env.local` or `.env` file to point at the connection string you want to use locally (for example, `postgres://user:pass@localhost:5432/listit`). SQLite is no longer supported.

## Capacitor + iOS wrapper

The repository is preconfigured to bundle the static assets under `public/` into a Capacitor shell for native distribution.

1. Install the workspace dependencies (Capacitor packages are now included) with `npm install`.
2. Update `FRONTEND_ORIGIN` in your environment file to list every allowed origin, separated by commas. Include `capacitor://localhost` so the native WebView can exchange cookies with the backend.
3. The first time you set up the native wrapper, run `npx cap add ios` (or `npm run sync:ios`, which will prompt to install the platform) after installing dependencies. Whenever you update the web assets, run `npm run build:core` followed by `npm run sync:ios` to copy the files into the native project.
4. Open the iOS workspace at any time with `npm run open:ios` to configure signing, run on devices, or produce App Store archives.

The generated native project lives in `ios/App`. Commit changes to that directory alongside web updates so the iOS container stays in sync with the bundled assets.
