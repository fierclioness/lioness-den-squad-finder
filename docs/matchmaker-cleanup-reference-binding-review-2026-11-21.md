# Den Matchmaker — reference-bound same-bot cleanup review (2026-11-21 UTC)

**Scope:** isolated DRAFT PR #2 source and disposable CI only. No staging deployment, scheduler enablement, Discord request, member edit, or production Den Missions change.

## Finding and fix

GET-before-DELETE previously checked that a message ID and channel matched the stored cleanup receipt and that Discord identified the author as the configured bot. This was necessary but insufficient: the same bot can author unrelated messages in the same channel, and a stale/misassociated stored receipt must not authorize deletion of one of those posts.

The reviewed cleanup transport now requires the **original listing's persisted random UUID reference** and a fresh Discord GET whose content contains **exactly one matching** `🔎 Den ref: ...` marker. It verifies the message ID, fixed channel, author ID, `author.bot === true`, and marker together *before* DELETE. Missing/wrong/duplicate markers quarantine rather than delete. Malformed or absent references fail before any network request. The durable cleanup worker selects `s.post_reference::text` from the same listing row and passes it to the transport; the legacy planner/transport now requires that reference too.

The same-bot marker check is **additional** to, not a substitute for, the existing durable receipt, lifecycle, expired-or-closed listing, fixed destination, 404 Unknown Message-only absence handling, uncertain delivery quarantine, or original-bot identity gates. The reference is an opaque random identifier rather than member identity. No auto-retry of uncertain deletion was introduced.

## Offline verification

- Code/tests commit `b77fd752283b14195683e257d2dcd8bdd17e0f15`.
- Node: **250/250 PASS**, [workflow](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44896692866).
- Edge TypeScript: **PASS**, [workflow](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44896692789).
- Disposable PostgreSQL + mocked Discord: **PASS**, [workflow](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44896692849).
- Regression coverage includes same bot/channel/message IDs with missing, foreign or duplicated markers (zero DELETE); missing/invalid persisted markers (zero GET); durable worker reference propagation and quarantine; legacy transport refusal; and the disposable PG→mock REST original-bot cleanup.
- Initial CI exposed three legacy cleanup tests that lacked the new required reference; the older planner and its fixtures were updated, and **final** workflows passed. This was an isolated draft test-only finding and is not a deployment incident.

## Staging isolation readback

Read-only staging `tcxktyqywsqafnyxhpgy`: 1 listing, 1 preview, 9 replay rows; zero publishing jobs, cleanup jobs, receipts or reconciliation audits; zero overdue active listings. No staging table write, Edge deployment or Discord settings changes. The separate production Den Missions project `cpjcjcxinhjusosaguyi` and original manual Squad Finder were not modified.

## Still blocked

No claim of independently reviewed security or of live deletion safety. A future separately approved bot-owned controlled POST/GET-before-DELETE E2E must still verify the live Discord receipt, timestamp, transport, permissions and unexpected REST responses. Real Discord-client 3-second acknowledgment, authenticated scheduler/expiry E2E, independent security review and explicit release permission remain open. PR stays DRAFT, unmerged; public posting and commands are not activated by this change.
