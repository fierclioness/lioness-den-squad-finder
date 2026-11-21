# Den Matchmaker — worker launch gates (2026-11-20)

Status: **review only**. No permission to enable Discord posting, deletion, scheduler, or production launch. This checklist is not launch approval.

## Verified signed offline actor guard — Nov 20, 2026 (DRAFT / no deployment)
- Security review found that the **legacy offline signed Discord adapter**, unlike the deployed signed HTTP handler, converted JSON member IDs with `String(...)` before authorizing and constructing the actor. A rounded JavaScript Number or a one-element array could be interpreted as a different, valid Discord snowflake. This was confined to the offline demonstration; do not treat the demo as a launch security boundary.
- Draft-only source and adversarial test updated in `matchmaker/discord-adapter-offline.mjs` and `discord-adapter-offline.test.mjs`. The adapter now requires an original **primitive exact-string member ID** and preserves it without coercion. Invalid numeric, array, null and object forms produce only an ephemeral rejection and cannot create a preview; a genuine string still works.
- **Verified** at test commit `d378ba5f`: [219/219 Node tests passed](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44820922510), [Edge TypeScript and hosted negative HTTP passed](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44820922567), and [disposable PostgreSQL integration passed](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44820922680). Source/test GitHub readback confirmed the exact-string guard and new regression.
- Isolated staging read-only: Edge `den-matchmaker` v18 ACTIVE; seven private RLS-enabled tables; one listing, one preview, nine replay rows and **zero** posting jobs, cleanup jobs, receipts or reconciliation audits. No migrations, database writes, deployment, Discord configuration changes, guild installation, messages, member edits, production Den Missions modifications or original manual Squad Finder replacement.
- **Still NOT launch-ready**: real client-visible acknowledgement latency under 3s, separately authorized authenticated scheduler and original-bot POST/GET-before-DELETE cleanup E2E, expiry/race testing, independent security review and explicit release consent are open. PR #2 remains DRAFT/unmerged.

## Verified staging baseline
- Separate Supabase staging project `tcxktyqywsqafnyxhpgy`, Edge function `den-matchmaker` v18 active.
- Private `matchmaker_internal` schema; seven RLS-enabled tables.
- Read-only consistency checks: 0 cleanup jobs without receipts, 0 cleanup/receipt mismatches, 0 posted rows without receipts, 0 overdue active listings; 0 uncertain post and cleanup records at inspection.
- One historical closed listing and one pending preview were observed. Do not assume these are cleared.
- `pg_cron` not installed; scheduler not demonstrated. No posting/cleanup worker end-to-end test completed.

## Must pass before controlled worker testing
1. Worker identity: independently authenticate worker, enforce staging-project and intended guild/channel allowlists, deny unauthenticated invocation, and fail closed on missing configuration.
2. Publish gate: independent OFF-by-default approval, explicit opt-in, confirmed active/unexpired listing, primitive exact-string Discord IDs, no automatic DMs.
3. Posting safety: claim once with database lease; use original bot identity and approved destination; persist message receipt; on network uncertainty quarantine instead of blind retry; prove crash-after-send does not double-post.
4. Cleanup safety: derive message/channel/bot identity **only from trusted stored receipt**, not caller-supplied IDs. GET-before-DELETE; require exact bot ownership and channel match; treat only verified Discord Unknown Message (10008) as absent; quarantine ambiguous 404, 403, 5xx, timeout, or malformed body.
5. Expiration: exercise 36-hour TTL boundary, posting-vs-expiry races, closed listing, batch bounds, stale claims and idempotent repeated runs in disposable PostgreSQL fixtures.
6. Scheduling: verify authenticated schedule, interval, bounded batches, alerts for uncertain jobs and failure, and recovery after missed ticks. Do not enable until worker tests pass.
7. Independent review: review Discord permissions, token handling, audit logging without secrets/member details, DB privilege boundaries and rollback/kill switches.
8. Authorized Discord client test: verify interaction ACK under three seconds on real client, controlled bot-owned post and deletion in approved test channel, then separate production release consent.

## Explicit stop conditions
- Any unknown message provenance, inconsistent receipt, missing original-bot verification, or uncertain delivery.
- Any attempted posting while publish flag OFF, or worker endpoint callable without authenticated staging authorization.
- Any request to deploy publicly, alter member data, change production database, or post/delete messages without separate approval.

## Next safe implementation step
Add a **pure, offline** receipt-to-cleanup authorization validator and adversarial unit tests in draft PR #2; do not wire it to Discord or deploy until reviewed. Track this as In Progress in the Canva project tracker.
