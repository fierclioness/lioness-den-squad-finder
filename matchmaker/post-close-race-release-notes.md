# Close-versus-post race: safe development notes (2026-11-18)

Review-only SQL `matchmaker/post-close-race.review.sql` and disposable PostgreSQL test `matchmaker/tests/post-close-race-postgres.sql`.

## Cases guarded by one PostgreSQL transaction
- Close **before** any worker claims an outbox row: mark pending/definitively unsent row cancelled.
- Close **while** a worker has already claimed and may be posting: mark listing closed, leave send in flight as unresolved. When a *verified* successful Discord response arrives, `finish_post_with_receipt` stores bot/channel/message IDs and enqueues cleanup transactionally.
- Close **after** a successful send: the trusted stored receipt is queued for cleanup once, not deleted directly inside the slash command.

## Still unsafe until remaining gates
A database transaction cannot undo a Discord HTTP request after it leaves the server. A crashed worker, timed-out response, or lost successful receipt may leave a post that is not automatically identified. Such rows remain unresolved and **MUST NOT be retried or marked removed without reconciliation**.

The SQL accepts bot/channel receipt parameters from a trusted server-side worker. They are **not self-authenticating**: production code must verify actual configured bot user ID, channel ID and Discord response first. The service should persist a canonical receipt, and cleanup must use a disabled-by-default verified-author transport.

Additional operational gates: worker scheduling/authentication, bounded retries and rate-limit behavior, reconciliation tools, timeouts, expiry processing, least-privilege production schema review, and a controlled guild test. Never apply this review SQL to production or merge it into main without separate authorization.

The original manual Squad Finder remains live and unchanged.
