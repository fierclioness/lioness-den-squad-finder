# Den Matchmaker — launch acceptance and rollback checklist
**Review-only checklist · November 19, 2026. Not launch authorization.**

**Current staging evidence (Nov 19):** Ed25519 gateway v16 ACTIVE only in isolated staging; 1.5-second total body-read timeout with HTTP 408 fail-closed and zero replay claims on stalled body (Node regression). Latest 144/144 Node tests [PASS](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44534791731), [Edge TypeScript PASS](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44534791664), and [disposable PostgreSQL PASS](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44534791702) on code commit `ed994343`. Hosted HTTP negative checks were previously verified against active staging Edge v16; no live command flow was tested. Authenticated Discord signed PING was previously verified, but **real `/squad` end-to-end ACK timing, worker/publishing/cleanup and release remain UNVERIFIED**; do not infer approval from green CI.

## Scope and non-negotiable separation
- **Isolated staging only:** Supabase project `tcxktyqywsqafnyxhpgy`; independent Discord *Den Matchmaker Test* app.
- **Production is out of scope:** do not change Den Missions project `cpjcjcxinhjusosaguyi`, the live Discord application/bot, member records, or the original manual Squad Finder without separate explicit approval.
- Draft PR #2 remains unmerged; commands, public posting and scheduler default **OFF**. Passing tests is not permission to enable them.
- No secret keys, tokens, passwords or personal member records may be pasted into repository, Canva, test artifacts or progress notes.

## Required evidence — not just a green health check
| Gate | Evidence and pass criteria | Status |
| --- | --- | --- |
| Isolated schema and replay | Private RLS schema; deny ordinary roles; authentic signed PING plus one durable replay claim; concurrent same-ID replay denied | **Offline + staging PING verified**; recheck before launch |
| Real command | Test app installed/command accessible to **approved test user only**; `/squad create`, confirm, mine, list, close and cancel tested end-to-end with posting disabled | **Blocked on separate guild/test-app authorization and real client run** |
| Response deadline | Record client-observed end-to-end receipt/ACK for actual signed command, not merely Edge execution or PING. Every sampled ACK must arrive within Discord's **3-second deadline**; aim for p95 under 2 seconds with network headroom. Document sample count, cold starts and failures. If the local telemetry clock is unavailable, the handler must still acknowledge and the missing sample must NOT be counted as a pass | **Unverified** |
| Negative authorization | Signed non-tester, cross-guild, malformed command and reused interaction ID must not mutate listings; forged/unsigned payload HTTP 401. Do not use live non-consenting members as actors | **Offline verified; real signed test pending** |
| Private-list consent | With posting OFF, confirm persists only opt-in in-command discovery; later feature toggle cannot publish historical private listings | **Offline/DB reviewed; real client pending** |
| Outbox uncertainty | A timed-out or unconfirmed POST must be quarantined, never automatically retried. A confirmed delivery but failed DB receipt must require manual reconciliation | **Offline covered; controlled REST test pending** |
| Cleanup ownership | Only original fixed-channel, originally recorded **bot-owned** messages can be deleted; GET original message and verify channel, ID, author ID and bot flag before any DELETE; uncertain DELETE quarantined | **Offline covered, including failed ledger acknowledgement/no speculative retry; controlled REST test pending** |
| Expiration | Bounded `expire_due_listings`; late receipt for closed/expired listing queues verified cleanup; scheduler authentication prevents unapproved tasks | **Staging rolled-back SQL verified; scheduler OFF** |
| Staging worker | **Separate** private worker endpoint with Supabase `verify_jwt=true` **and** long scheduler key. Explicit fixed destination/channel/bot review, independent flags OFF by default, no body, exact routes, bounded one-item runs | **Review-only composition; not deployed** |
| Publication readiness | Owner explicitly approves staging posting test, approved destination, credentials, bot permissions, rollback and monitoring; manual reconciliation for uncertainty documented | **Approval required** |
| Production release | Independent security review, signed commands under real load, documented cleanup test, launch monitoring, **explicit production authorization** | **Not approved** |

## Safe order of operations
1. Keep all current live commands, publishing and scheduling OFF. Read staging status, negative hosted HTTP smoke, isolated database state and CI evidence.
2. Run offline Node, Edge TypeScript and disposable PostgreSQL suites. Require passing branch CI including scheduler composition replay/uncertain-delivery/foreign-bot tests.
3. **Only after express authorization**, install/configure test app for a private guild command and run tester-only real `/squad` command actions with public posting still OFF. Measure actual Discord end-to-end ACK deadlines and replay behavior; confirm records and cleanup in isolated staging.
4. Review fixed test channel, actual bot identity, permissions and specific REST scopes. Require separate authorization for even a test public POST or DELETE. First run the publisher once with a consenting test listing, inspect its trusted receipt, close the test listing, verify GET-before-DELETE on that exact bot post.
5. Only after independent approval, deploy a separate JWT-protected scheduler endpoint and enable one task at a time. Never enable POST and DELETE merely because they passed mocked tests.
6. Re-run all CI and staging checks, audit credentials and access, prepare rollback; solicit separate explicit production approval. Keep manual Squad Finder as an available fallback.

## Rollback and incident response
- **Stop new operations first**: turn command, publishing, cleanup and scheduler flags OFF; do not remove the signed-PING endpoint or disable manual Squad Finder as a substitute.
- On ambiguous POST/DELETE or missing receipt, **quarantine and inspect**, never resend/delete guessed Discord messages. Identify the original bot message by durable receipt and read-only GET before any approved reconciliation.
- Verify zero unintended new public messages and preserve audit/replay entries; do not bulk-delete member data to clean up tests.
- Confirm Den Missions production project and live Discord settings remain unchanged. Record the exact last good staging function version and CI commit before considering a rollback.

## Evidence hygiene
- **Hosted Edge 200 health** proves routing/configuration, **not** Discord client command function or a 3-second ACK.
- **Signed PING** proves a signature and replay DB path, **not** command dispatcher authorization or a user-visible `/squad` result.
- **Mocked Discord POST/GET/DELETE** proves code paths, **not** that a real bot has permissions or that public messages were safely cleaned up.
- **Timing instrumentation** is diagnostic, not a request gate. Clock exceptions, non-finite or backwards timestamps must not affect the signed interaction ACK or hide its original failure; record unavailable samples as missing, never as successful 0-ms ACKs. Reject invalid local budget thresholds (must be positive and strictly below 3 seconds).
- Synthetic SQL tests must run in explicit `BEGIN`/`ROLLBACK` and be followed by table-row counts. Never label them as real member data tests.

**Current decision:** Continue branch-only safety and offline/staging-negative tests. **Not launch-ready; no production or Discord-live authorization granted.**
