# Discord Create Message HTTP confirmation safety review — November 20, 2026

**Scope:** Draft PR #2 only. No live Discord, deployment, bot-token exposure, production Den Missions change, original manual Squad Finder modification, public messages, or member data changes.

## Finding

The review-only `makeDiscordTransport.sendMessage` previously accepted any HTTP `response.ok` (any 2xx) before validating a plausible Discord message receipt. A status such as `202 Accepted` or `206 Partial Content` is **not** the documented completed Create Message confirmation. Treating a plausible-looking body on such a response as a durable post could incorrectly transition the outbox to `posted` and authorize eventual cleanup.

## Fix and expected behavior

The transport now requires **HTTP 200 AND `response.ok===true`** before accepting the otherwise strictly validated Discord message receipt (exact primitive ID, fixed channel, original bot author and `bot:true`). Other statuses, including 201, 202, 204 and 206, fail closed. The existing outbox worker marks unconfirmed delivery **uncertain** and does not automatically retry: an intermediary may have delivered the message anyway. Never report definitely unsent or claim that Discord has been queried.

## Reproducible offline checks

- `matchmaker/discord-transport.test.mjs`: a valid-looking JSON receipt on each unexpected 2xx code fails without a second HTTP attempt; normal 200 + verified receipt remains accepted.
- `matchmaker/scheduled-worker-composition.test.mjs`: a simulated HTTP 202 with matching bot author and message IDs is quarantined in the one-item publisher, does not write a trusted receipt, and is not sent again.
- `matchmaker/tests/postgres-discord-publisher-integration.mjs`: disposable PostgreSQL uses an explicit HTTP 200 mock for its successful bot-owned publication path; no actual Discord REST calls.
- CI must pass the **final draft branch head** across Node core, Edge/hosted checks and disposable PostgreSQL, not merely intermediate code commits.

## Release gates still open

This is simulated transport and CI proof **only**. Real Discord-client acknowledgment under three seconds, separately approved original-bot publication and GET-before-DELETE cleanup, scheduler/expiry E2E, independent security review and explicit launch approval are still required. No staging-worker enablement, deployment, live app or guild changes were authorized by this fix.
