# ListIt

## Local environment variables

1. Copy `.env.example` to `.env.local` (preferred) or `.env` in the project root.
2. Fill in the values you need for your environment. Any values already supplied in the example file are safe development defaults.
3. Start the server with `npm start` — environment variables from `.env.local`/`.env` are automatically loaded before the application boots.

Environment variables explicitly set in your shell always take precedence over the values in the file. To avoid accidentally committing secrets, `.env`, `.env.local`, and other environment-specific files are ignored by Git, while `.env.example` remains tracked as the canonical reference.

## Database configuration

The API requires a PostgreSQL database. Set `DATABASE_URL` in your `.env.local` or `.env` file to point at the connection string you want to use locally (for example, `postgres://user:pass@localhost:5432/listit`). SQLite is no longer supported. TLS is enforced by default; if you are connecting to a local instance without TLS, set `DATABASE_SSL=false` for development only. If your production database uses a self-signed certificate, set `DATABASE_SSL_MODE=self-signed` (or `DATABASE_SSL_REJECT_UNAUTHORIZED=false`) to permit the connection while still using TLS. Pool sizing can be tuned with `DB_POOL_MIN`, `DB_POOL_MAX`, `DB_IDLE_TIMEOUT_MS`, and `DB_CONNECTION_TIMEOUT_MS`.

## Capacitor + iOS wrapper

The repository is preconfigured to bundle the static assets under `public/` into a Capacitor shell for native distribution.

1. Install the workspace dependencies (Capacitor packages are now included) with `npm install`.
2. Update `FRONTEND_ORIGIN` in your environment file to list every allowed origin, separated by commas. Include `capacitor://localhost` so the native WebView can exchange cookies with the backend.
3. The first time you set up the native wrapper, run `npx cap add ios` (or `npm run sync:ios`, which will prompt to install the platform) after installing dependencies. Whenever you update the web assets, run `npm run build:core` followed by `npm run sync:ios` to copy the files into the native project.
4. Open the iOS workspace at any time with `npm run open:ios` to configure signing, run on devices, or produce App Store archives.

The generated native project lives in `ios/App`. Commit changes to that directory alongside web updates so the iOS container stays in sync with the bundled assets.
