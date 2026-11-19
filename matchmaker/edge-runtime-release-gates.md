# Den Matchmaker Edge — staging verification and release gates

**Status: deployed only in isolated staging, NOT approved for the Lioness Den production release.** The Edge entrypoint in `supabase/functions/den-matchmaker/index.ts` is deployed to **Den Matchmaker Staging** (`tcxktyqywsqafnyxhpgy`) as version 7. Den Missions production (`cpjcjcxinhjusosaguyi`) and the original manual Squad Finder have not changed.

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

## Gates that remain BLOCKING

1. Verify full `/squad` create → ephemeral preview → owner confirmation → mine/list/close with a safely installed and explicitly authorized *test app*. No guild commands are currently registered; command execution is OFF.
2. Measure **actual** command acknowledgement performance within Discord's 3-second initial-response deadline, including cold starts, database delays, failure paths, and non-2xx responses. One successful PING does not satisfy this.
3. Finish audited bot-only posting transport and cleanup scheduling, fixed destination channel and bot identity, reply restrictions, and explicit posting feature gates. A timed-out POST remains uncertain and is NEVER automatically retried; deletion must GET and verify the original bot-owned message first.
4. Test uncertain-delivery reconciliation, close/expiry races, duplicate suppression and outbox recovery under isolated controlled conditions. Never expose an unsafe retry mechanism.
5. Review production migrations, least-privilege credentials, rollback, retention and monitoring separately. **No production deployments, merges, Discord application installation, public posts or deletes without explicit approval.**
6. Keep the original `https://fierclioness.github.io/lioness-den-squad-finder/` available as a fallback and avoid modifying the separate Den Missions bot.

This file is a release gate record, not activation permission. Additional evidence: `matchmaker/hosted-staging-status.md` and draft PR #2.
