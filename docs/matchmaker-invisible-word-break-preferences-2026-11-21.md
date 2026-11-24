# Invisible preference text controls — draft security review (21 November 2026 UTC)

## Finding
The opt-in `validateDraft` private consent boundary and the separately guarded public outbox previously denied Unicode bidi overrides and line separators but accepted certain other invisible characters: U+200B ZERO WIDTH SPACE, U+2060 WORD JOINER, U+00AD SOFT HYPHEN, U+034F COMBINING GRAPHEME JOINER, and U+180E MONGOLIAN VOWEL SEPARATOR. These characters can make a game or availability field look different from its stored bytes, hide extra words, or visually split an ostensibly safe preference. The issue is visual deception and content review ambiguity; it was **not** evidence of a working @everyone ping or authorization bypass. Current `allowed_mentions: {parse:[]}` remains in force.

## Draft-only change
- Reject those five code points at the earliest private `validateDraft` boundary, before creating a consent preview or recording a new listing.
- Apply the **same** fail-closed check at `listingToMessage` in the outbox, because older persisted rows or bypassed validation must never become public posts.
- Preserve common non-ASCII characters, accented names, emoji and U+200D ZERO WIDTH JOINER (needed for emoji sequences). Do not remove characters silently or rewrite a member's intended text.
- Extend existing adversarial tests to exercise all five code points for both the private opt-in path and the public mock-post path, asserting no public POST and one quarantine when a stored row is unsafe.

## Verification
At code/test commit `81febc7565d0d3c61e7fb53c0c47b5435c581868`:
- [Node core CI](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44878296388): **244/244 tests passed**, zero failures.
- [Edge TypeScript](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44878296349): passed.
- [Disposable PostgreSQL integration](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44878296414): passed.
- Source and test files were reread from the draft branch after saving.

## Scope and remaining gates
This is code/test coverage on draft PR #2, **not** deployment, a live Discord test, an external security review or release approval. Staging project `tcxktyqywsqafnyxhpgy` remains Edge v18 ACTIVE (read-only checked): 1 listing, 1 preview, 9 replays; 0 post/cleanup jobs, message receipts or reconciliation rows. No database writes, production Den Missions changes, Discord app/guild/member settings, public messages or original manual Squad Finder changes.

Real client-visible initial Discord acknowledgement timing, separately authorized bot-owned posting and GET-before-DELETE cleanup, authenticated scheduler expiry E2E, independent security review, PR merge conflicts and explicit release approval are still open. **Do not merge, deploy or launch.**
