# Squad listing close/expiry: release-safe message lifecycle

This is an architectural review for the existing *draft* Matchmaker. Nothing was deployed or deleted from Discord.

## Expected behavior
- Member chooses /squad close: atomically mark only that member's active listing closed. If a post was confirmed, schedule removal of the corresponding **bot-created** message from the known #squad-up channel.
- After 36 hours: mark listing expired; use the same removal flow. No user DMs or general channel notifications.
- If a listing was never posted (pending/failed/cancelled), there is nothing public to delete.
- If publishing was **sending** or **uncertain**, do not delete blindly or re-post. Resolve which Discord message (if any) belongs to that listing before cleanup.
- A 204 from Discord's delete endpoint confirms deletion; a 404 for an already verified, bot-owned original post can be considered absent. A 429, 403, timeout, or 5xx must not be treated as successful deletion.

## Critical database requirements not yet implemented
1. Persist *which* guild/channel and original bot author were used to create each posting receipt. The current review schema stores message ID only; it is insufficient to prove channel + ownership for live cleanup.
2. Add a durable cleanup outbox with a unique listing ID, pending/claimed/verified-absent/uncertain states; conditional claims and transactionally recorded results. Reconciliation must not be implemented as an in-memory loop.
3. Prevent publication if a member closes while a worker is holding a publish claim. Coordinate close/publish state in a transaction; otherwise a stale post may appear after close.
4. Never use broad Manage Messages permission merely to perform own-post cleanup. Use the bot's own message identity and least permissions.
5. Add a staged test with user-owned alternate Discord account and an approved fixed destination ID. No real deletion without explicit release approval.

## Files added
- `listing-cleanup.mjs`: pure planner and disabled-by-default mockable HTTP DELETE transport.
- `listing-cleanup.test.mjs`: expiry, closure, stale receipt, incorrect channel, disable switch, 204/404/error paths.

Discord official API source: https://github.com/discord/discord-api-docs/blob/main/developers/resources/message.mdx

**Not deployable yet:** The transport's `botOwned` precondition is a caller assertion; only an authoritative DB receipt plus Discord author verification can establish that in a real environment. Do not expose this module to members directly or treat it as launch-ready.
