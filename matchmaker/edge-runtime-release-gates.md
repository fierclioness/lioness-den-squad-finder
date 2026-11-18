# Den Matchmaker Edge entrypoint — review only

The development file at supabase/functions/den-matchmaker/index.ts is NOT deployed. It composes the signed HTTP handler and private PostgreSQL adapter. Normal commands are OFF by default; no bot token or public posting capability is included.

## Private configuration names (never commit values)
- DEN_MATCHMAKER_DISCORD_PUBLIC_KEY: application public signing key.
- DEN_MATCHMAKER_DATABASE_URL: approved TLS private PostgreSQL connection string, server side only, minimal privileges.
- DEN_MATCHMAKER_COMMANDS_ENABLED: false by default; true only for controlled authorized testing.

The service responds 503 until required configuration exists. Even signed PING needs a durable database replay claim.

## Before activation
1. Verify Deno runtime npm pg compatibility, pool connection, TLS trust and function limits in an isolated environment.
2. Verify the minimal database role, private grants and migration rollback; do not expose the private schema through a public Data API.
3. For a Discord webhook, verify_jwt must be reviewed separately because Discord does not provide a Supabase JWT. Never bypass Ed25519 raw-body checks.
4. Ensure Discord's initial interaction response deadline (three seconds) is met; currently the HTTP handler has no deadline guard for slow DB queries.
5. Finish actual Discord post worker, durable reconciliation, message lifecycle and safe retry logic. A timeout is ambiguous and must NEVER auto-resend.
6. Register guild-only commands only after authorized test-account verification and explicit activation approval.
7. Keep original manual Squad Finder working alongside the new optional bot workflow.

The file is a *review candidate*, not a production runtime validation or release approval.
