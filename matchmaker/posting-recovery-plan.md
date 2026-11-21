# Den Matchmaker — posting recovery and launch gates

**Review branch only; no live Discord or Supabase changes.**

## Why an outbox?

Creating a squad listing and posting to Discord are separate operations. The database can commit successfully while Discord fails or times out. Blindly retrying a timed-out post can cause duplicate messages. The proposed outbox has one row per listing and requires a worker to claim the row transactionally.

## States

| State | Meaning | Automated action |
| --- | --- | --- |
| pending | Confirmed listing, not yet sent | Worker may claim |
| sending | One worker has claimed the post | Other workers must not claim |
| posted | Discord confirmed a message ID | Do not resend |
| failed | Proven not sent | Bounded retry up to 3 claims |
| uncertain | Request may have posted; confirmation unknown | **Never auto-retry; reconcile with Discord** |
| cancelled | Explicitly cancelled before sending | Never send |

Closing a listing while a post is sending or uncertain requires reconciliation, so the bot can delete or update only **its own** actual message and prevent stale public posts. Expired listings must never be claimed for new posts. Admin reconciliation requires a separate authenticated control and a verified Discord message ID; it is not implemented.

## Tests

- JavaScript model: `post-outbox-core.mjs`, `post-outbox-core.test.mjs`.
- Database proposal: `post-outbox.review.sql`.
- Disposable PostgreSQL checks: `tests/outbox-postgres.sql` (private service-only access, one enqueue per listing, single-worker claim, worker ownership and uncertainty quarantine).
- This is not yet an end-to-end Discord integration test.

## Production blockers

1. Signed Deno endpoint with durable request replay store and strict guild validation.
2. Persistence wired to private RPCs using only server-side credentials.
3. Explicit member confirmation before enqueuing or posting.
4. Idempotent delivery and reconciliation with Discord (especially timeout ambiguity), feature flag OFF by default.
5. Expiry cleanup, opt-out/close flow, monitoring, recovery/rollback.
6. Independent test-account verification and approval before enabling in The Lioness Den.

The existing webpage Squad Finder remains unchanged and available as the fallback.
