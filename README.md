# ListIt

## Local environment variables

1. Copy `.env.example` to `.env.local` (preferred) or `.env` in the project root.
2. Fill in the values you need for your environment. Any values already supplied in the example file are safe development defaults.
3. Start the server with `npm start` — environment variables from `.env.local`/`.env` are automatically loaded before the application boots.

- **Redis-backed message bus**: Set `REDIS_URL` (for example, `redis://localhost:6379`) to enable cross-process pub/sub. The bus defaults to Redis when this variable is set; otherwise it uses an in-memory bus.
- **Bus namespace**: Use `MESSAGE_BUS_NAMESPACE` to isolate environments when sharing a Redis instance (e.g., `MESSAGE_BUS_NAMESPACE=dev`).
- **Service ports**: `PORT` controls the API port, while `WEBSOCKET_PORT` configures the WebSocket service when it runs separately.

Environment variables explicitly set in your shell always take precedence over the values in the file. To avoid accidentally committing secrets, `.env`, `.env.local`, and other environment-specific files are ignored by Git, while `.env.example` remains tracked as the canonical reference.

## Database configuration

The API requires a PostgreSQL database. Set `DATABASE_URL` in your `.env.local` or `.env` file to point at the connection string you want to use locally (for example, `postgres://user:pass@localhost:5432/listit`). SQLite is no longer supported.

## Running the API, WebSocket, and worker services

ListIt now runs as three cooperating processes that communicate over the shared message bus:

- **API** (HTTP/REST): `npm run start:api` (defaults to `PORT=3000`)
- **WebSocket** (real-time messaging): `npm run start:websocket` (defaults to `WEBSOCKET_PORT=3002`)
- **Worker** (background jobs, Stripe webhooks, notifications): `npm run start:worker`

When deploying, run each command in its own process/terminal (or supervisor). Ensure all services share the same `REDIS_URL` and, if you use a shared Redis cluster, the same `MESSAGE_BUS_NAMESPACE` so they can see each other's events.

## Capacitor + iOS wrapper

The repository is preconfigured to bundle the static assets under `public/` into a Capacitor shell for native distribution.

1. Install the workspace dependencies (Capacitor packages are now included) with `npm install`.
2. Update `FRONTEND_ORIGIN` in your environment file to list every allowed origin, separated by commas. Include `capacitor://localhost` so the native WebView can exchange cookies with the backend.
3. The first time you set up the native wrapper, run `npx cap add ios` (or `npm run sync:ios`, which will prompt to install the platform) after installing dependencies. Whenever you update the web assets, run `npm run build:core` followed by `npm run sync:ios` to copy the files into the native project.
4. Open the iOS workspace at any time with `npm run open:ios` to configure signing, run on devices, or produce App Store archives.

The generated native project lives in `ios/App`. Commit changes to that directory alongside web updates so the iOS container stays in sync with the bundled assets.
