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

## Staging Edge database configuration improved

- Current deployed **staging-only Edge Function is version 5**, with updated typed Deno environment handling. It can use Supabase's automatically available **`SUPABASE_DB_URL`** without asking the user to create or paste another database password.
- This default DB URL is permitted **ONLY when `SUPABASE_URL` exactly identifies the isolated staging project `tcxktyqywsqafnyxhpgy`**. Production Den Missions never falls back to its privileged default DB URL; a separately reviewed private connection is required there.
- `DEN_MATCHMAKER_DATABASE_URL` remains an optional explicit least-privilege override. A real signed gateway test still requires a Discord **public signing key**, `DEN_MATCHMAKER_DISCORD_PUBLIC_KEY`, securely provisioned in staging through the Supabase project secrets UI.
- The code and new production-isolation tests passed on commit `d9e715b05137b14e31f48b85ffc30bfaaafab61f`: JS run **#44423055528**, Deno and live staging HTTP smoke run **#44423055539**, and disposable Postgres run **#44423055509**.
- **No real Edge→PostgreSQL request has been verified yet**, because the key is not configured and the signed gateway remains fail-closed. No Discord bot token, app configuration or public posting was introduced.

## Discord public key installed — hosted authentication gate verified

- User saved `DEN_MATCHMAKER_DISCORD_PUBLIC_KEY` in **Den Matchmaker Staging** Edge Function secrets. Only the secret name and digest were visible in the UI; the public key was not copied into GitHub or Canva.
- Supabase reports `den-matchmaker` version **6** after the secrets update.
- Real hosted GitHub Actions run **#44430018684 SUCCESS**: `GET /health` HTTP 200, and unsigned `POST` HTTP **401 Unauthorized** (rather than previous 503 Not configured). This proves the configured signing public key is recognized and the authenticated request handler is running.
- A 401 unsigned test **does not** prove a valid Discord signature, replay-claim database write, or response latency for a signed request. No bot token, Discord endpoint URL, public message or production setting was changed.
- **Important:** The Discord application visible to the user is currently described as the Den Missions bot. Do **not** set or replace its Interactions Endpoint URL until we confirm the existing bot's command handling; changing it could interrupt Den Missions. Prefer a **separate Discord testing application** with its own public key for the staged signed-PING test, then update staging's public key securely. Any real Discord configuration needs separate approval.

## November 19 live signed verification, runtime timing, and replay safety

- **Separate Discord app:** user created `Den Matchmaker Test`, replaced the staging `DEN_MATCHMAKER_DISCORD_PUBLIC_KEY` with that app's public key, and saved the isolated staging interaction URL. It has **0 installed servers**, so there were no member-facing commands, posts or DM events.
- **Real Discord signature handshake:** Supabase `function_edge_logs` recorded Discord user-agent POST **401** for Discord's deliberate invalid-signature check, followed by **200** for the genuine signed PING on **2026-11-19 00:41:13 UTC**. The successful signed request inserted **one** private replay claim via the actual deployed Edge-to-PostgreSQL connection. The private ledger had exactly 1 row afterward, with **zero** listings/post jobs/cleanup jobs.
- **Observed gateway execution time:** signed PING **73 ms** and deliberately bad-signature probe **247 ms** (2 samples). This is **Supabase Edge execution time**, not network-wide latency or a p95 for real commands. The saved Discord endpoint demonstrates the handshake met Discord's validation criteria; separate load/command response timing remains necessary.
- **Database replay idempotency:** on isolated staging, a synthetic interaction claim returned true once and false on duplicate inside an explicit **rolled-back SQL transaction**. Verified ledger remained 1 row and no listings/posts were added.
- **Safe hosted negative checks:** staging-only GitHub Actions run **#44432676708 PASSED** health GET 200, unsigned POST 401, and forged signed-looking POST 401. This test does not need a Discord secret, does not send genuine signed requests, and therefore cannot add replay claims.
- **Cleanup hardening in review branch:** corrected the older message deletion transport so it delegates to bot-authorship verification (GET exact original message from fixed channel and verify message ID, bot author and bot flag) before DELETE. JS and Postgres CI must pass before this can be considered a tested change; no live Discord API requests have been sent.

## What is NOT yet verified / release-blocking

- Guild-scoped `/squad` registration and authorized real Discord member test (the test app is deliberately **not installed**). Staging command flag is still OFF.
- Real end-to-end command interaction with Edge-to-DB and initial response under Discord's three-second deadline, including delayed connection and failure scenarios. A single PING's 73 ms Edge time is **not** sufficient evidence.
- A protected Discord sender and cleanup worker, scheduler permission boundaries, uncertain-delivery reconciliation, and original bot-owned post lifecycle in a controlled channel. These have extensive offline/disposable PostgreSQL tests but **no real Discord posting test**.
- Least-privilege production service role, private schema migration review and rollback, explicit owner-controlled launch gate.
- Do NOT merge PR #2, enable guild commands, deploy to Den Missions production, or publish/delete member-facing messages without explicit separate approval. Keep existing Squad Finder running.

## Next controlled rollout steps

1. Keep the test Discord app and original Den Missions bot separate. Continue authenticated and negative tests in isolated staging.
2. Finish reviewed, bot-ownership-verified sending and cleanup worker with fail-closed no-retry-on-uncertainty rules; verify CI and launch rollback.
3. After a new explicit owner authorization to install the test app, register **test-only** guild `/squad` commands with posting OFF; perform controlled secondary-account tests.
4. Require separate approval for publishing, private schema production migration, and production release. Preserve manual Squad Finder fallback.

**This is a staging verification record, not launch authorization.**

## November 19: private-confirmation consent gate and staging Edge v8

- **Safety issue identified and corrected:** The previous private `/squad` confirmation path called `confirm_and_enqueue` even when public posting was OFF. That left an unposted job which could have been picked up if a publishing worker was later enabled. The review branch now calls `confirm_preview` by default, saving a private listing **without enqueueing any future public post**. Only a separate explicit `publishingEnabled:true` gate calls `confirm_and_enqueue`. This gate remains **OFF** in the deployed staging entrypoint.
- The preview/confirmation copy distinguishes **Save privately** from **Post to #squad-up**, and the dispatcher rejects a mismatch between requested publishing consent and the store's actual queue result. The server will not enable publishing while commands are disabled.
- **Verified GitHub Actions on commit `995c7dda`:** core Node tests **#44436900562 SUCCESS**, Deno TypeScript **#44436900509 SUCCESS**, disposable PostgreSQL integration **#44436900467 SUCCESS**. New tests prove a private SQL confirmation produces **zero** post-outbox rows; the explicit publishing fixture continues testing queue + mocked Discord posting/cleanup.
- The corrected four shared modules were deployed **only to Den Matchmaker Staging** as Edge Function **version 8**, verified by fetching the deployed bundle back. Staging commands remain OFF; no bot token or public posting transport exists in that function.
- After v8 deployment, the GitHub-hosted *read-only/negative* staging HTTP workflow re-run **#44432676708 SUCCESS**: `/health` returns 200 with commands/posting disabled, unsigned POST returns 401, forged signed-looking PING returns 401.
- Verified staging remains empty of user listings and post/cleanup jobs (each **0**); the single genuine prior Discord PING replay claim remains **1**. **No new genuine signed interaction was sent to v8**, so the earlier successful real Discord handshake still belongs to v7, not a fresh post-deployment handshake.
- Production Den Missions and the original Squad Finder remain unchanged. No guild install, command registration, real Discord messages or launch authorization. Future rollout requires test-app permission, command deadline evidence, ownership-verified posting/cleanup and explicit approval.

## November 19: unsigned payload bounds, honest member visibility and scheduler prototype

- **Unbounded body allocation blocked:** The Discord webhook no longer calls unbounded `request.arrayBuffer()` on user-controlled POST bodies. It now streams into a hard 1 MiB cap, rejects oversized or falsely declared lengths with HTTP 413 **before signature verification or a replay database write**, and cancels excess stream input. Tests include omitted Content-Length, oversized declared length and ensuring replay claimant is never invoked. GitHub Actions core Node **#44437552919 SUCCESS**, Deno **#44437552967 SUCCESS**, disposable PostgreSQL **#44437553230 SUCCESS** on commit `e4ef1d7e`.
- **Accurate opt-in disclosure:** The staging-only non-posting UI now explicitly tells a member that a saved opt-in listing is visible through `/squad list` to other Matchmaker users, even though no public `#squad-up` message is queued. Button now says **Save to /squad list**, not falsely “Save privately”. The separately gated public path still says **Post to #squad-up**. GitHub Actions core Node **#44437842154 SUCCESS**, Deno **#44437842100 SUCCESS**, PostgreSQL **#44437842204 SUCCESS**.
- Updated these shared modules **only on the isolated staging Edge** as **version 10**, fetched deployed bundle to verify `readLimitedBody`, correct disclosure and private `confirm_preview` path. Hosted read-only/negative HTTP run **#44432676708 SUCCESS** after v10 deploy; real commands/publishing remain disabled. Staging currently: **0** opt-in listings, **0** posts, **0** cleanup jobs, **1** original real v7 signed PING replay claim. **No real signed v10 command has occurred.**
- Added a **review-only** `scheduled-worker-gateway.mjs` prototype plus tests. It has two separate defenses for a future scheduler: intended Supabase gateway JWT plus a distinct 32+-character server-side scheduler secret, fail-closed master/task flags, one job per POST, no body/member parameters, and sanitized response statuses. **No scheduler secret has been provisioned, no worker endpoint deployed and no cron job enabled.** GitHub Actions on commit `4788675e`: Node **#44438290675 SUCCESS**, Deno **#44438290791 SUCCESS**, PostgreSQL **#44438290588 SUCCESS**.
- All production systems and Discord member-facing channels remain untouched. Pending: authenticated scheduler composition, real authorized test-app E2E and deadline, staged lifetime/cleanup operations, approved bot/channel identity and explicit release sign-off.
