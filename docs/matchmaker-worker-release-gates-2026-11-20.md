# Den Matchmaker — worker launch gates (2026-11-20)

Status: **review only**. No permission to enable Discord posting, deletion, scheduler, or production launch. This checklist is not launch approval.

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
