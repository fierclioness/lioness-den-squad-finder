# Den Matchmaker public outbox: Unicode layout and direction-control safety

**Date:** November 20, 2026 (America/New_York; verification runs occurred November 21 UTC). **Scope:** DRAFT PR #2, review-only Node publisher and synthetic tests. **No Discord messages sent.**

## Finding and correction
The guarded outbox composer previously sanitized ASCII CR/LF and checked URL/mention patterns, but still allowed invisible bidirectional text overrides and Unicode line separators in submitted game preferences. These characters can visually reorder a line or make an apparent extra announcement inside a bot-owned Discord message even with `allowed_mentions.parse=[]`.

The composer now rejects C0/C1 control characters (except CR/LF, which are normalized), left-to-right/right-to-left marks, Unicode line/paragraph separators, bidirectional override/embedding/isolate characters, and blank-only values. Consecutive ASCII CR/LF now collapse to a single space. Ordinary accents and emoji are retained.

Untrusted public text **cannot cause a Discord send** under these guard failures; the conservative existing outbox flow quarantines the claim for operator review rather than silently retrying. This is strictly draft-only; no deployment.

## Reproducible regression coverage
- A simulated U+202E direction override, U+2028 separator, U+0085 separator, U+2066 directional isolate and blank control/whitespace-only value each prevent Discord POST, with exactly one outbox quarantine.
- An ordinary `Pokémon 🎮` listing and embedded CRLF pass after single-space normalization. The normal simulated receipt and posted state remain functional.
- Initial CI exposed a formatting expectation mismatch (CRLF normalized into two spaces), corrected by collapsing CR/LF runs into one; final suite is green.

## Independent verification
Final **code/test commit [`e1725c4`](https://github.com/fierclioness/lioness-den-squad-finder/commit/e1725c4afc0ff3f7374c96524a1e4a4c7637e345)**:
- [Node core tests: 236/236 PASS, 0 fail](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44853337614), including two new adversarial tests.
- [Edge TypeScript and hosted negative HTTP checks: PASS](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44853337563).
- [Disposable PostgreSQL integration: PASS](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44853337568).
- Both modified source/test files independently read back via GitHub after saving.
- Read-only isolated Supabase staging `tcxktyqywsqafnyxhpgy`: Edge `den-matchmaker` v18 ACTIVE; 7 private RLS tables, 1 listing, 1 preview, 9 replay rows and **zero** post/cleanup jobs, receipts and reconciliation audit rows. Security advisor: 7 informational no-policy findings expected for private RLS schema. No database writes or deployments in this review.

## Still blocked / not proved
This static, offline publisher improvement is **not** live Discord-client ACK measurement, real original-bot POST/GET-before-DELETE, an enabled worker test, scheduler expiry E2E or independent security sign-off. Draft PR #2 also reports merge conflicts. Explicit approval is still required before any live posting, deployment, member changes, guild/app changes, PR merge or production Den Missions modification. Keep the original manual Squad Finder unchanged.
