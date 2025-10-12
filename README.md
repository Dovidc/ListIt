# ListIt

## Local environment variables

1. Copy `.env.example` to `.env.local` (preferred) or `.env` in the project root.
2. Fill in the values you need for your environment. Any values already supplied in the example file are safe development defaults.
3. Start the server with `npm start` — environment variables from `.env.local`/`.env` are automatically loaded before the application boots.

Environment variables explicitly set in your shell always take precedence over the values in the file. To avoid accidentally committing secrets, `.env`, `.env.local`, and other environment-specific files are ignored by Git, while `.env.example` remains tracked as the canonical reference.
