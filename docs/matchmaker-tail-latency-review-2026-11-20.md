# Den Matchmaker — tail-latency release-gate review (November 20, 2026)

**Scope:** Draft PR #2 only, with synthetic requests and read-only staging inspection. No Discord-client performance test, worker deployment, public posting, deletion, scheduling or production change is implied.

## Defect and fix

The offline `evaluateTimingSamples` helper previously treated a sample batch as `withinLocalBudget: true` when its *p95* fell below the local 2,000 ms response headroom and its maximum remained below Discord's 3,000 ms interaction deadline. That permitted a misleading green headroom verdict: nineteen 120 ms samples and a single 2,450 ms response have p95 120 ms and maximum 2,450 ms. One response has crossed the local budget even though the old aggregate returned true.

The review-only helper now reports independent facts:
- `p95WithinLocalBudget`: p95 is strictly below the configured local budget;
- `allWithinDiscordDeadline`: every sample is strictly below 3,000 ms;
- `withinLocalBudget`: **both** p95 and maximum are strictly below the local budget. Thus an outlier between 2,000 ms and 3,000 ms fails the local-headroom gate even if the p95 stays low.

The existing per-request timing probe is unchanged. It is non-invasive, never cancels an in-flight database transaction and never fakes an interaction acknowledgment. Two adversarial tests cover hidden p95 outliers, exact 2,000 ms budget boundary, and a 3,100 ms deadline breach.

## Independently checked evidence

Code/test commit: `71e9dd1c7cbd125fa9b5d470c14e035a702aba58`.
- [Node core tests](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44840038916): **232/232 passed, 0 failed** (verified job log).
- [Edge TypeScript and hosted HTTP checks](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44840038752): **success**.
- [Disposable PostgreSQL integration](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44840038815): **success**.
- Prior [read-only staging HTTP smoke](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44840025125) also passed against the intermediate source commit; no new deployment is implied.

Fresh read-only isolated staging `tcxktyqywsqafnyxhpgy` query: 1 listing, 1 pending preview, 9 signed-interaction replay records; **0** posting jobs, cleanup jobs, posting receipts and reconciliation-audit records. Staging Edge `den-matchmaker` remains **v18 ACTIVE**. Supabase security advisor reports seven **INFO** RLS-without-policy findings on private tables, not newly introduced by this source-only change.

## What this does *not* prove

The test samples are synthetic and run in CI. Neither this aggregate nor previously collected Supabase function execution timings measure the real Discord application's client-observed initial acknowledgment under its three-second limit. Do **not** mark the real ACK gate passed from a unit test, server p95, successful signed PING or HTTP 200 alone.

**Outstanding explicit release gates:** authorized real Discord-client command ACK evidence; separately approved bot-owned controlled posting, GET-before-DELETE and uncertain-outcome reconciliation; scheduler/expiry E2E; independent security review; explicit launch authorization. Keep draft PR unmerged and original manual Squad Finder intact. Never touch production Den Missions `cpjcjcxinhjusosaguyi` or live Discord app/guild/member settings without separate approval.
