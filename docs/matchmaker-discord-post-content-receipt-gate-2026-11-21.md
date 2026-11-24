# Den Matchmaker: exact-message Discord POST receipt gate (draft only)
**Review date:** November 21, 2026 UTC  
**Scope:** draft PR #2; no deployed worker, live public posting, or production database access.

## Risk and change
Previously, the guarded Discord REST transport accepted HTTP 200 with a valid original-bot identity, destination channel and message ID, without verifying that the returned message `content` matched the exact opt-in listing sent. A mismatched response could therefore be recorded as proof that a different message was published.

The draft `makeDiscordTransport.sendMessage` now additionally requires `data.content === content` before returning `confirmed:true`. A missing, non-string, truncated or different body fails closed as an **unconfirmed POST**. The composed outbox worker quarantines that ambiguous attempt and **never automatically retries it**, since the message might already exist. The worker's original-bot/channel/message identity and exact HTTP 200 gates remain enforced.

Discord's official [Create Message documentation](https://github.com/discord/discord-api-docs/blob/main/developers/resources/message.mdx) says the route returns a message object and may strip some characters. A legitimately altered response is also therefore **unconfirmed**, requiring operator reconciliation; a mismatch must never trigger automatic duplicate publication.

## Reproducible offline verification
- New adversarial transport test rejects a matching original-bot receipt with missing, null, empty, numeric or wrong message content; each synthetic attempt sends exactly once.
- Existing positive mocked POST test now supplies the expected exact body.
- Scheduled-worker composition and disposable PostgreSQL mocked-Discord integration now return the actual submitted body; both retain their original safety checks.
- Core Node CI: **246/246 PASS**, zero failures — [run 44885536993](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44885536993).
- Edge TypeScript/negative HTTP CI: **PASS** — [run 44885536970](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44885536970).
- Disposable PostgreSQL integration: **PASS** — [run 44885537094](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44885537094).
- Verified code/test head: `47074e600ba6b651fc53d9185cef2ffc305bba58`. These are offline/mock tests, **not proof of real Discord-client ACK latency or a live bot post**.

## Isolation and release gates
Read-only isolated Supabase staging `tcxktyqywsqafnyxhpgy` at Edge v18 ACTIVE contained 7 private RLS tables, 1 listing, 1 pending preview, 9 replay records, and **zero** publishing jobs, cleanup jobs, receipts or reconciliation rows. No staging database writes, workers deployed, Discord app/guild settings changed, messages posted, members edited, production Den Missions changes, original manual Squad Finder modifications or PR merge.

**Still blocked:** real Discord-client ACK under 3 seconds; separately authorized authenticated worker deployment; original-bot POST and GET-before-DELETE cleanup under controlled conditions; scheduler/expiry E2E; independent security review; merge conflicts; explicit launch approval. Never infer launch clearance from mocked receipt results.
