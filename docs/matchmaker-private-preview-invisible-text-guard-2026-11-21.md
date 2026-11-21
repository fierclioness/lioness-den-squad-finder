# Den Matchmaker — private-preview and public-post invisible-text guard (2026-11-21 UTC)

**Scope:** draft PR #2 only. No production deployment, Discord activity, member edits or staging database writes.

## Finding and change

The prior public publishing worker rejected several invisible Unicode direction and layout controls, but incoming opt-in `game` and `availability` strings could still reach the **private** preview and `/squad list` before public publishing. Those private Discord responses can be visually misleading if they contain Unicode bidi control marks. The draft shared input validator now rejects C1 layout controls, Arabic letter mark U+061C, LRM/RLM, U+2028/U+2029, bidirectional embeddings/overrides, isolates and BOM U+FEFF before any preview/store action. It continues to permit ordinary accented Unicode and composed emoji, including zero-width joiner sequences.

Defense in depth: the draft outbox composer separately rejects U+061C and U+FEFF in historical/persisted preference values, even if validation was bypassed. No automatic retry or publishing behavior was changed.

## Verification (GitHub Actions, synthetic values only)

- **239/239 Node tests passed**, zero failures, at code/test commit `f8a6605741b78f4d7701885148c54014f1d6a833`: [core](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44866441243). A new draft-validation regression checks both user fields across several invisible marks and preserves normal Unicode/emoji.
- [Edge TypeScript and HTTP test workflow passed](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44866441316).
- [Disposable PostgreSQL integration passed](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44866441228).
- An existing mocked outbound-message regression was extended to cover U+061C and U+FEFF, asserting **zero Discord sends** and one quarantine transition for each.
- Read-only Supabase staging inspection returned one listing, one pending preview and nine signed replays; **zero** post-outbox, cleanup-outbox, post-receipt and reconciliation rows. Staging security advisor returned seven informational RLS-enabled/no-policy findings consistent with the restricted private schema. This evidence does **not** mean the new draft code is deployed.

## Gates still open

- Real Discord-client visible acknowledgment latency under 3 seconds remains **unmeasured**, notwithstanding passing synthetic tests.
- Real bot-owned POST and original-bot GET-before-DELETE cleanup, authenticated scheduler/expiry and controlled E2E still require **separate approval** before any live Discord-facing action.
- Independent security assessment, GitHub PR #2 dirty mergeability state, and explicit production-release permission remain unresolved. Preserve original manual Squad Finder, test-app settings and production Den Missions (`cpjcjcxinhjusosaguyi`). **Do not merge or deploy.**
