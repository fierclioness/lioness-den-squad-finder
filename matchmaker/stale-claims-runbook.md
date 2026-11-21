# Den Matchmaker — abandoned worker and lease recovery

**Development proposal only; not enabled on the user's Discord or Supabase project.**

## What goes wrong
If a posting worker crashes after claiming an outbox row, the record can remain in `sending` forever. Because Discord is an external API, even a timed-out HTTP request might have succeeded. Re-running the POST would risk duplicate squad requests. Cleanup workers can likewise crash after deleting a message but before acknowledging success.

## Review-only SQL
`matchmaker/stale-claims.review.sql` provides two bounded service-only functions:
- `quarantine_stale_post_claims(min_age, max_rows)` moves stale `sending` rows to `uncertain` and clears expired ownership. **Never retries the POST.**
- `quarantine_stale_cleanup_claims(min_age, max_rows)` moves stale `claimed` cleanup rows to `uncertain`, never blindly repeating DELETE.
- Default age is 10 minutes, minimum 5 minutes, maximum 7 days; max batch 500. `FOR UPDATE SKIP LOCKED` prevents workers from claiming the same stale row concurrently.
- Only an appropriately authorized, dedicated backend/service role may call these functions. No public/anon/authenticated grants.

## What operators must do
Review quarantined rows using the unique random listing reference, verified bot author/channel and durable receipts. A missing Discord search result **does not** establish that an HTTP POST never succeeded. Follow `uncertain-delivery-runbook.md`; do not manually mutate member IDs or reuse a message ID from another bot.

## Still needed for an actual rollout
1. A securely authenticated scheduler with a dedicated minimal-privilege role, no public endpoint. Run only after explicitly approved deployment.
2. Observe real hosted request processing times, crash frequency, clock consistency and worker lifetime before choosing the actual quarantine threshold.
3. Authoritative reconciliation for genuinely uncertain deletions/posts and tamper-resistant audit evidence.
4. Controlled Discord secondary-account end-to-end testing and rollback approval.

**No scheduler, live worker, Discord delete, Supabase migration or public post was created here.** Original manual Squad Finder remains available.
