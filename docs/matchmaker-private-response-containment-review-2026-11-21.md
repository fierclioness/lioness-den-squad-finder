# Den Matchmaker private response containment review — November 21, 2026 (UTC)

**Scope: draft PR #2 only. No deployment, Discord messages or member-data edits.**

## Risk identified

The private `/squad create` consent preview, `/squad mine` and `/squad list` composed Discord text using voluntary game/availability fields without escaping Markdown syntax. Fields like `**official**`, `||spoiler||`, or `[join](spoof)` could alter rendered formatting even though @mention and URL guards already existed. In addition, a list of ten maximally sized fields—especially after escaping—could exceed the private HTTP response's 1,850-code-unit display cap and be **silently truncated mid-listing**, without saying how many listings were omitted. Historically stored rows were not revalidated immediately before display.

## Draft-only remediation

- Shared `escapeDiscordDisplay` escapes Markdown control characters after `validateDraft` normalizes and bounds voluntary text. Consent preview retains the trusted heading and notices, while opt-in values remain literal. No external links or IDs are added.
- `mine` and `list` revalidate persisted rows at the output boundary; invalid historical values fail closed, and the signed HTTP wrapper returns its existing generic ephemeral error.
- `list` assembles **whole rows** within a conservative 1,800-code-unit budget, reserves room for an explicit omitted-listings notice, and never calls `slice()` on a partially rendered row. Maximum 10 candidates; no new database queries or stored-member changes.
- All responses remain ephemeral with `allowed_mentions.parse=[]`; no public publishing or automatic DMs.

## Verification

Regression checks include: private consent preview Markdown containment and emoji preservation; `mine`/`list` literal rendering; oversized escaped listings with an explicit omission notice; legacy invisible-text fail-closed; and a **signed offline HTTP** list test confirming ephemeral flags, no mentions, bounded output and the omission notice. These checks use an in-memory injected store and synthetic signatures; they **do not measure a real Discord client's acknowledgement latency**.

Node test command: `node --test matchmaker/*.test.mjs`. Independent checks: Edge TypeScript/negative hosted HTTP and disposable PostgreSQL workflows on the draft branch. See current [PR #2](https://github.com/fierclioness/lioness-den-squad-finder/pull/2) checks for the latest outcome.

Read-only isolated Supabase `tcxktyqywsqafnyxhpgy`: Edge `den-matchmaker` v18 ACTIVE; 1 listing, 1 pending preview, 9 replay records, and 0 publish jobs, cleanup jobs, posting receipts or reconciliation audit entries. Private-table RLS/no-policy notices remain informational in the deliberately restricted schema. No SQL writes were executed.

## Release boundaries still open

Actual Discord-client initial ACK under three seconds; separately approved bot-owned POST plus GET-before-DELETE cleanup; scheduler/36-hour expiry end-to-end evidence; independent security review; resolution of draft PR merge conflicts; explicit launch authorization. Worker/posting/scheduler gates remain OFF. **Never merge or deploy without approval.** Preserve production Den Missions `cpjcjcxinhjusosaguyi`, live Discord application/guild settings, member data and the original manual Squad Finder.
