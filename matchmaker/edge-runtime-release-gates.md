# Den Matchmaker Edge — staging verification and release gates

**Current status (November 20, 2026): isolated staging only, NOT approved for production.** Edge `den-matchmaker` in Supabase `tcxktyqywsqafnyxhpgy` is now **v18 ACTIVE**. Earlier numbered versions and command-disabled observations below are **dated historical test evidence**, not current staging configuration. An authorized restricted-tester private-only `/squad` create → preview → confirm → mine/list → close test is documented as successful, with no queued public posting. Commands are restricted to approved testers; **public posting and scheduler remain OFF**, and no live original-bot publishing/GET-before-DELETE cleanup E2E has been approved. Production Den Missions (`cpjcjcxinhjusosaguyi`), the original manual Squad Finder and the draft PR merge state remain unchanged. Read-only Edge log evidence: eight v18 successful POSTs, server-side execution p95 433 ms and max 433 ms; this is **not** a Discord-client-visible three-second ACK measurement.

## Verified November 19, 2026

- Separate **Den Matchmaker Test** Discord application saved the staging Interactions Endpoint URL. Discord's deliberately invalid signature returned HTTP **401**; correctly signed PING returned **200** with `type:1` and successfully recorded **one durable private PostgreSQL replay claim**.
- Supabase Edge gateway recorded **73 ms execution** for successful PING and **247 ms** for invalid-signature probe. These are only two gateway execution samples, **not** end-to-end command timing or an under-three-second load guarantee.
- The hosted CI negative suite **#44432676708 SUCCESS**: `GET /health` 200, unsigned POST 401, forged signed-looking POST 401. None require signing secrets or create member data.
- A synthetic private DB replay test succeeded inside a rolled-back transaction (first accepted, duplicate rejected); after rollback, **one real replay claim** persisted and all listings/post/cleanup job counts were zero.
- Private schema is not accessible to `anon` or `authenticated`; `service_role` has USAGE. Seven RLS-enabled private tables have no external policies by design.

## Staging-only runtime configuration (names only)

- `DEN_MATCHMAKER_DISCORD_PUBLIC_KEY` is the test application's **public** Ed25519 key, stored through staging Edge secrets, never committed.
- `DEN_MATCHMAKER_DATABASE_URL`: optional approved TLS private PostgreSQL connection. In the *separately isolated staging project only*, `resolvePrivateDatabaseUrl` can use Supabase's built-in `SUPABASE_DB_URL` instead. This privileged fallback is **forbidden** in Den Missions production.
- `DEN_MATCHMAKER_COMMANDS_ENABLED` defaults to false; public posting is not implemented or enabled in this Edge runtime.
- Discord webhook uses `verify_jwt=false` only because Discord does not send a Supabase JWT. **Raw Ed25519 signature, timestamp, durable replay claims and server-side authorization remain mandatory.**

## November 19, 2026: private listing non-publication guarantee

- Signed PING was confirmed on **v7**; v8 is verified through fetched deployed bundle plus GitHub-hosted health/unsigned/forged HTTP tests. A new genuine signed v8 command test has NOT occurred.
- When publication is disabled, confirmation saves privately with **zero post-outbox jobs**, so turning on the worker later cannot publish earlier private listings. The dispatcher and storage adapter must agree on explicit public-post consent; the server denies publishing if commands are disabled.
- Verified Node, Deno and disposable PostgreSQL CI on commit `995c7dda`, all SUCCESS. Public posting, command registration, bot installation and scheduler remain disabled.

## Additional November 19 checks

- Staging v10 deployed with signed webhook request bodies capped at 1 MiB even when Content-Length is missing. Explicit 413 rejection happens before the private replay ledger is accessed; unit/hosted negative tests pass.
- Non-posting confirmation is visible through `/squad list` to permitted Matchmaker users. Preview and button clearly disclose that visibility; no #squad-up post is queued. The original v7 signed PING verification does not count as an end-to-end command test for v10.
- A review-only private scheduler gateway is coded and tested but **not deployed**; requires independent JWT, secret provisioning, worker composition, staging expiry RPC review and explicit authorization.

## Gates that remain BLOCKING

1. **Private-only restricted tester command flow: verified historically on v18.** Preserve the signed create → ephemeral preview → owner confirmation → mine/list/close evidence, but separately measure genuine Discord-client first-response latency under three seconds across cold starts, DB delays and failure paths. No broader guild registration, public posting, app-setting change or launch is authorized.
2. Measure **actual** command acknowledgement performance within Discord's 3-second initial-response deadline, including cold starts, database delays, failure paths, and non-2xx responses. One successful PING does not satisfy this.
3. Independently review and authorize the existing **review-only** bot-owned posting and cleanup workers, authenticated scheduling, fixed destination channel and bot identity, reply restrictions, and explicit posting feature gates. A timed-out POST remains uncertain and is NEVER automatically retried; deletion must GET and verify the original bot-owned message first.
4. Retain successful offline/disposable-PostgreSQL uncertain-delivery, close/expiry-race, duplicate suppression and outbox-recovery tests; **still require separately approved bot-owned Discord POST + GET-before-DELETE and scheduler/expiry real E2E**. Never expose an unsafe retry mechanism.
5. Review production migrations, least-privilege credentials, rollback, retention and monitoring separately. **No production deployments, merges, Discord application installation, public posts or deletes without explicit approval.**
6. Keep the original `https://fierclioness.github.io/lioness-den-squad-finder/` available as a fallback and avoid modifying the separate Den Missions bot.

This file is a release gate record, not activation permission. Additional evidence: `matchmaker/hosted-staging-status.md` and draft PR #2.
