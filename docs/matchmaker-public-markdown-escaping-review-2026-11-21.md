# Den Matchmaker — public-post Markdown boundary (review-only)

**Reviewed:** November 21, 2026 UTC. **Scope:** draft PR #2; offline guard and GitHub CI only. No hosted worker rollout or Discord message created.

## Issue and safeguard

The outbox previously rejected explicit mentions, URLs, invisible Unicode layout controls and blank fields, but accepted Discord Markdown metacharacters inside voluntary game/preferences. Fields such as `**Official**`, `# Important`, `||Hidden||`, backticks or `[Click](fake)` could alter rendered emphasis, spoilers, links or headings even though the bot's layout was intended to remain authoritative. This was presentation spoofing, not proof of a Discord permission bypass.

The draft outbox now first normalizes CR/LF inside each validated preference to a space, then backslash-escapes Markdown metacharacters (backslash, backtick, asterisk, underscore, tilde, pipe, greater-than, hash, brackets, parentheses and exclamation). It leaves the bot-owned header, directions and opaque listing reference unchanged. Existing mention/URL/invisible-control validation and zero-mention transport policy remain in place. Normal accented characters and emoji remain supported.

**Reproducer:** `matchmaker/outbox-worker.test.mjs` includes a new adversarial composer test covering fake bold/heading, quote, code span, spoiler, pseudo-link and embedded newline heading. The test verifies a single mocked Discord post with escaped user preferences and an unchanged trusted bot header. These are mocked REST interactions only.

**Verified code/test SHA:** `fb07198790a4ee3a61e2745e3a55773b2f3bd2b3`. All **237/237 Node tests passed**, with zero failures ([Node CI](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44856773327)); [Edge TypeScript / hosted staging negative HTTP checks passed](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44856773334); [disposable PostgreSQL integration passed](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44856773350). Source and new test read back from GitHub.

## Isolation and remaining acceptance gates

Read-only isolated Supabase staging `tcxktyqywsqafnyxhpgy`: `den-matchmaker` Edge function **v18 ACTIVE**; seven private tables; one listing, one pending preview, nine replay records; **zero** posting jobs, cleanup jobs, receipts or reconciliation records. Seven informational RLS-without-policy advisories remain consistent with the privately restricted schema; informational findings are not a substitute for an independent security audit. No Supabase deployment/database write, Discord app configuration or guild installation, public message or member edit, production Den Missions change, or manual Squad Finder modification occurred during this review.

The improvement is **not deployed**. PR #2 remains **draft / unmerged** and has unresolved merge conflicts. **Launch remains blocked** pending independent security review, actual Discord-client acknowledgement timing below three seconds, separately authorized original-bot posting and verified GET-before-DELETE cleanup, scheduler/expiry controlled E2E and explicit launch approval. No private test or CI check authorizes live public posting.
