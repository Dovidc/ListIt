# ListIt

## Local environment variables

1. Copy `.env.example` to `.env.local` (preferred) or `.env` in the project root.
2. Fill in the values you need for your environment. Any values already supplied in the example file are safe development defaults.
3. Start the server with `npm start` — environment variables from `.env.local`/`.env` are automatically loaded before the application boots.

Environment variables explicitly set in your shell always take precedence over the values in the file. To avoid accidentally committing secrets, `.env`, `.env.local`, and other environment-specific files are ignored by Git, while `.env.example` remains tracked as the canonical reference.

### S3 clock skew override

If your production environment cannot immediately correct its system clock, you can supply `AWS_TIME_OFFSET_SECONDS` (or `AWS_TIME_OFFSET_MS`) to offset the AWS SDK’s signing clock. A negative offset compensates for a fast clock, while a positive offset compensates for a slow one. The same adjustment is used when generating dated S3 object keys so newly uploaded assets continue to land under the expected date prefix.
