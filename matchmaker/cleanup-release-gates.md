# Squad listing close/expiry: release-safe message lifecycle

**Current review status (November 20, 2026):** Draft PR #2 remains unmerged; no original-bot publishing, cleanup or scheduler has been enabled. Isolated staging Edge `den-matchmaker` is v18 ACTIVE; this is not a live-worker deployment. Verified offline/disposable-PostgreSQL tests exercise GET-before-DELETE, immutable bot-owned receipts and uncertain-delivery quarantine, but **no authorized real Discord bot-owned post or deletion E2E has occurred**. Only a Discord HTTP **404 with exact numeric JSON error code 10008 (Unknown Message)** can prove already-absent; a generic 404, **10003 (Unknown Channel)**, malformed body or inaccessible channel is ambiguous and must remain in reconciliation. Client-observed ACK below three seconds, scheduler/expiry E2E, independent security review and explicit release approval remain open. Production Den Missions and original manual Squad Finder remain untouched.


This is an architectural review for the existing *draft* Matchmaker. Nothing was deployed or deleted from Discord.

## Expected behavior
- Member chooses /squad close: atomically mark only that member's active listing closed. If a post was confirmed, schedule removal of the corresponding **bot-created** message from the known #squad-up channel.
- After 36 hours: mark listing expired; use the same removal flow. No user DMs or general channel notifications.
- If a listing was never posted (pending/failed/cancelled), there is nothing public to delete.
- If publishing was **sending** or **uncertain**, do not delete blindly or re-post. Resolve which Discord message (if any) belongs to that listing before cleanup.
- A verified HTTP 204 from Discord's delete endpoint confirms deletion. HTTP 404 means already-absent **only** with exact numeric Discord JSON error code 10008 (Unknown Message); 10003 (Unknown Channel), empty/malformed error bodies, 403/429, timeout or 5xx do **not** establish removal and require reconciliation.

## Critical database requirements (now implemented in isolated staging; production still blocked)
1. Persist *which* guild/channel and original bot author were used to create each posting receipt. **Historical gap resolved in the isolated review schema:** posting receipts now retain the message, channel and bot IDs, and cleanup compares these with the original private receipt. Independent validation and authorized live testing remain necessary before deployment.
2. Add a durable cleanup outbox with a unique listing ID, pending/claimed/verified-absent/uncertain states; conditional claims and transactionally recorded results. Reconciliation must not be implemented as an in-memory loop.
3. Prevent publication if a member closes while a worker is holding a publish claim. Coordinate close/publish state in a transaction; otherwise a stale post may appear after close.
4. Never use broad Manage Messages permission merely to perform own-post cleanup. Use the bot's own message identity and least permissions.
5. Add a staged test with user-owned alternate Discord account and an approved fixed destination ID. No real deletion without explicit release approval.

## Files added
- `listing-cleanup.mjs`: pure planner and disabled-by-default mockable HTTP DELETE transport.
- `listing-cleanup.test.mjs`: expiry, closure, stale receipt, incorrect channel, disable switch, 204/404/error paths.

Discord official API source: https://github.com/discord/discord-api-docs/blob/main/developers/resources/message.mdx

**Not deployable yet:** The transport's `botOwned` precondition is a caller assertion; only an authoritative DB receipt plus Discord author verification can establish that in a real environment. Do not expose this module to members directly or treat it as launch-ready.


## Verification hardening added

- `verified-bot-cleanup.mjs` now retrieves the exact original message from the fixed channel, validates channel + message ID, and checks that Discord identifies the author as the expected bot before a delete request is permitted.
- Its transport is DISABLED by default. A 204 deletion confirms removal; **only** a 404 with numeric Discord `code: 10008` confirms already-absent. Unknown Channel (`10003`), malformed/empty 404, or any other ambiguous status remains unresolved. Tests prove ordinary members' and other bots' messages are never deleted in the simulated transport.
- **Historical note:** the verified transport was initially unwired. The later `cleanup-outbox-worker.mjs` review implementation now uses a durable private cleanup claim and original receipt, with disposable PostgreSQL race tests; the real authenticated worker is **not deployed or authorized**, so scheduled cleanup remains a **release blocker**.

## November 19: reviewed durable cleanup orchestrator (NOT deployed)

- `cleanup-outbox-worker.mjs` now claims **one** pending cleanup job atomically by worker UUID from the private Postgres outbox. It compares the claimed job with the immutable **original posting receipt**, trusted channel and bot identity, and inactive/expired listing state **before attempting a delete**. Mismatches are quarantined as uncertain; there is no blind delete.
- The trusted `verified-bot-cleanup.mjs` adapter GETs the exact message and requires matching Discord ID, fixed channel and original bot author before DELETE. The older cleanup transport now delegates to this verification rather than trusting a caller-provided `botOwned` assertion alone.
- Both Discord POST and GET/DELETE transports use bounded request aborts. A timeout, ambiguous DELETE, 403/429/5xx, or missing trusted record is **never** treated as a successful removal; manual reconciliation is required. No automatic retry of uncertain messages.
- New offline worker tests cover disabled behavior, original-bot provenance, wrong owner/bot/channel, GET-before-DELETE, expiry/closure, quarantine, and persistence failure. Disposable PostgreSQL + mocked Discord integration verified the actual sequence: confirmed post → owner close → durable cleanup claim → exact bot GET → DELETE 204 → marked done. It also verified uncertain POST close does not manufacture a receipt or cleanup job.
- GitHub Actions **#44434450754 SUCCESS** on the draft branch (`82f3dab4`), with JavaScript and Deno companion checks also passing. **No real Discord messages were sent or deleted; no production migrations or launch occurred.**

### Still release-blocking

This worker is **review-only, not scheduled or deployed**. Before enabling it, require authenticated scheduler identity, strict worker access, real fixed-channel/bot credentials, rate-limit policy, crash quarantine and manual reconciliation runbook, authorized secondary-account end-to-end verification, and owner approval for any member-facing action. The manual Squad Finder remains available.

## November 19: 36-hour expiry lifecycle proposal validated (NOT deployed)

- Added `expiry-outbox.review.sql` with a bounded `expire_due_listings(max_rows)` RPC intended only for a later authenticated scheduler. It atomically marks overdue active listings expired, cancels unsent pending/failed public posts, and queues cleanup **only** when an immutable, trusted original Discord posting receipt exists. `sending` and `uncertain` deliveries are not guessed, cancelled blindly or retried.
- Validated with real **disposable PostgreSQL 17** cases: two-item bounded batches, idempotent re-run, live listing remains untouched, posted-and-receipted cleanup, unposted pending cancellation, in-flight late-success receipt queuing cleanup after expiry, and invalid batch bounds rejected. **All synthetic fixture changes rolled back** at end, preventing interference with the existing publishing integration suite.
- GitHub Actions commit `324d8980`: JavaScript, Deno and PostgreSQL **all PASS** (including the new expiry tests).
- This is a *review-only SQL proposal*; there is **no installed expiry scheduler**, no live Discord traffic and no staging/production migration from this new script. Authenticated scheduling and release approvals remain necessary.
