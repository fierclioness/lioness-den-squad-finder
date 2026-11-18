# Atomic squad confirmation + posting queue (review only)

## Problem addressed
The previous development flow committed a member's Confirm action using `confirm_preview` and needed a second database call to enqueue the post. If the worker or network failed between these two calls, a valid confirmed listing could remain without a posting job.

## What changed
- `matchmaker/atomic-confirm.review.sql` defines private `confirm_and_enqueue(owner,preview_token)`.
- In the **same PostgreSQL transaction**, the function calls the existing verified-preview confirmation logic and inserts one pending outbox row. A failed insertion aborts the entire transaction: neither the new listing nor the consumed preview is committed.
- `postgres-store-adapter.mjs` now calls `confirm_and_enqueue`, not the earlier non-atomic `confirm_preview`.
- `tests/atomic-confirm-postgres.sql` checks one-time confirmation, exactly one queue row, rollback under an injected outbox failure, intact preview after rollback, retry after failure, and cleanup of test fixtures.
- The existing signed HTTP/DB and PostgreSQL-to-mocked-Discord tests run after the new integration test.

## Still not a live posting system
Queued does **not** mean publicly posted. The publishing worker and Supabase Edge Function are still disabled, and this SQL has **not** been applied to any live database. A queued item can be cancelled safely before a worker claims it; ambiguous sending and delivery must be handled by the existing quarantine/reconciliation logic.

## Security and release gates
Production requires an approved migration, least-privilege DB role, authoritative Discord guild/channel and bot identity, hosted latency and fail-closed replay checks, durable worker scheduling, crash recovery, lifecycle cleanup, authorized test account validation and explicit release approval. The existing manual Squad Finder must remain accessible.

Verified on disposable CI after commit `5e166f7f17a013f1756310b2b2a9dde5f0c463e9`: JavaScript and Deno checks, plus PostgreSQL integration and rollback tests, all passed.
