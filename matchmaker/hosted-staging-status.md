# Den Matchmaker Staging — hosted implementation record

**Date:** November 18, 2026
**Environment:** dedicated Supabase project Den Matchmaker Staging, `tcxktyqywsqafnyxhpgy` (us-east-1, PostgreSQL 17).
**Production project:** Den Missions 2.0, `cpjcjcxinhjusosaguyi` — untouched, verified healthy and still has no Matchmaker tables.
**Project quote:** $0/month base, subject to quota and metered usage.

## Completed on the independent staging project

1. New project creation succeeded; project status `ACTIVE_HEALTHY`, initially no tables or functions.
2. Nine private, ordered staging migrations applied successfully:
   - private schema
   - preview functions
   - posting outbox
   - cleanup outbox
   - guarded close and original post receipt
   - manual reconciliation/audit
   - unique UUID reference
   - atomic confirmation + post queue
   - stale-worker quarantine
3. Seven `matchmaker_internal` tables, all RLS-enabled and excluded from ordinary public/anonymous access. Anonymous and authenticated roles have **no USAGE** privilege on the private schema; service_role does.
4. Hosted database checks passed using a **rolled-back synthetic transaction**:
   - signed-gateway-style preview, one-time confirmation + automatic posting queue
   - duplicate confirmation denied
   - unique non-identifying reference exists
   - owner closes pending request, queued post cancelled
   - interaction ID replay rejected
   - in-flight worker, member close, late verified Discord-style receipt, atomic cleanup enqueue and original receipt retained
5. Verified all synthetic tests rolled back: 0 listings, 0 post jobs, 0 cleanup jobs, 0 replay rows.
6. **Staging-only Edge Function `den-matchmaker` deployed**, status `ACTIVE`, version 1, `verify_jwt=false` for future signed Discord webhook integration. Its actual bundled modules were fetched back and verified.
7. The staging endpoint is intentionally **fail-closed**: absent its separately configured signing public key and private DB URL, code responds HTTP 503 and cannot accept any Discord command. No posting worker, bot token or live Discord integration was deployed.

## Security advisor interpretation

Supabase staging security advisor reports INFO `rls_enabled_no_policy` on seven private RLS-protected tables. This is expected for deny-by-default private schema: **no public/anon/authenticated grants or RLS policies** are intentionally present. The advisor did not indicate a public RLS exposure in those results. New index unused notices are expected on an empty staging database.

## Hosted HTTP smoke verified

- Deployed staging-only Edge Function `den-matchmaker` **version 3** (9-file bundle). Added a public **static, read-only** health response, with no member data, secrets or DB writes.
- Verified actual HTTPS from GitHub Actions runner in workflow **#44422240687, successful re-run**:
  - `GET https://tcxktyqywsqafnyxhpgy.supabase.co/functions/v1/den-matchmaker/health` -> HTTP **200**, exact static JSON showing `environment=staging`, `commands_disabled`, `posting_enabled=false`.
  - An **unsigned POST** to the staging command endpoint -> HTTP **503**, `{"error":"Not configured"}`, confirming the missing signing key/private database URL fail closed.
  - Initial health test returned 503 because Supabase rewrites the function path. That was corrected to accept canonical Edge gateway routes; the re-run passed.
- Rechecked staging private listing, post, cleanup and replay tables: **zero test rows**. Rechecked Den Missions production project: no Matchmaker tables.
- **Important:** HTTP GET health verifies endpoint routing and availability only. Because staging signing and DB connection credentials are not yet provisioned, a real signed Discord PING and Edge-to-Postgres round trip **remain unverified**. Do not enable real Discord commands or posting without those checks.

## What is not yet verified

- Actual HTTP invocation status/latency from a live client. External connectivity from the assistant environment could not reach the URL; Edge Function `ACTIVE` confirms deployment metadata, **not successful runtime invocation**.
- Real private database connectivity from Edge: `DEN_MATCHMAKER_DATABASE_URL` and `DEN_MATCHMAKER_DISCORD_PUBLIC_KEY` are not set via the connector. The user must **not paste credentials into chat or GitHub**. Provision through secure Supabase Edge Function secrets when ready.
- Real signed Discord interaction signature using the authorized Discord application's public key.
- Hosted worker scheduling, posting and cleanup under authenticated bot credentials; Discord 3-second acknowledgement performance.
- Discord guild-only command registration, controlled test-account E2E, operational monitoring and release rollback.

## Next controlled rollout steps

1. Set the staging function's two required secret variables through Supabase dashboard or an authorized secure secrets workflow: `DEN_MATCHMAKER_DATABASE_URL` (staging-only private TLS DB connection string) and `DEN_MATCHMAKER_DISCORD_PUBLIC_KEY` (Discord app public signing key). Keep `DEN_MATCHMAKER_COMMANDS_ENABLED=false`.
2. Using an isolated Discord test application, verify signed PING requests and replay rejection against staging, without posting public messages. Confirm actual response-time budget and database connectivity.
3. Run the private outbox and cleanup worker on a properly authenticated scheduler, with real channel/bot provenance, no auto-retry of uncertain deliveries and a separate approval gate for public posting.
4. Never use the Den Missions production project as the staging DB. Leave the existing manual Squad Finder live. Do not merge the draft GitHub PR or register real commands until authorized.

**This status file documents genuine hosted staging progress; it is not a production launch approval.**
