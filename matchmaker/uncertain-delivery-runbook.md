# Ambiguous Discord delivery: manual reconciliation protocol (review only)

When a Discord POST times out or a worker crashes, a message may exist even if the worker received no response. **Do not retry automatically.** The developer branch contains two isolated review components:

- `uncertain-reconciliation.mjs`: pure decision logic. Missing search results do not prove no post occurred. Exact original Discord message, bot author, channel and a trusted listing binding are required, followed by explicit operator approval.
- `manual-reconciliation.review.sql`: private, service-only PostgreSQL audit proposal. Records one approved recovery receipt and queues cleanup transactionally if the listing was already closed/expired.

## Operator checklist before a receipt can be restored
1. Keep the outbox item `uncertain` or `sending` and block re-posting.
2. Inspect the expected channel in the authorized guild. Discord history search can be incomplete: **absence alone cannot prove no delivery**.
3. Match the authenticated bot-owned message's `🔎 Den ref: <UUID>` against the **unique random `post_reference` stored in the private listing row**. Verify that exactly one marker appears; game content, message timing, or a member ID are not evidence. This marker is non-identifying but publicly visible and should not be treated as a secret.
4. Verify the message ID, actual channel and bot author through authenticated Discord API responses.
5. Have an authorized reviewer record a case/ticket, exact evidence and decision without putting bot credentials or member private data in the ticket.
6. Only then call the private reconciliation operation from a trusted server with audit metadata. If the listing was closed or expired, queue a verified bot-owned cleanup request. Never use a member-controlled approval field.

## Hard boundaries
The proposed SQL does not independently validate the supplied evidence or operator approval; that validation must be implemented in a trusted server before production use. No public comments, member data edits, channel posts, or live Supabase changes are part of these tests.

No automatic 'safe to resend' path exists. A human-approved investigation may later conclude a specific post was not sent, but another auditable procedure and policy would be required to clear that state safely.

Existing manual Squad Finder stays live.
