# Den Matchmaker — exact case for consent-button actions (November 21, 2026 UTC)

**Scope:** Draft PR #2 only, `fierclioness/lioness-den-squad-finder`. No production deployment, live Discord command registration, bot installation, member edit, public POST or DELETE, or migration. The manual Squad Finder and Den Missions production project `cpjcjcxinhjusosaguyi` remain out of scope.

## Finding and impact

The private command dispatcher's custom-ID matcher recognized `confirm|cancel` with a case-insensitive regular expression, but its subsequent cancellation branch compared the captured action with the case-sensitive literal `"cancel"`. A signed interaction carrying an alternate-case `mm:CANCEL:<uuid>:private` ID therefore matched the parser but **fell through to the confirm operation** instead of cancellation. The same mismatch could arise for `Cancel` or mixed-case spellings.

Discord normally sends application-authored component custom IDs, so this is a **defense-in-depth/legacy-component robustness** finding, not proof of an externally exploitable forged interaction. Signatures and durable replay checks are still required. Nevertheless, the safest consent boundary must never interpret anything resembling Cancel as Confirm.

## Draft-only change

- The `command-dispatcher.mjs` matcher now requires exact lowercase action, lowercase UUID and lowercase consent mode, matching the IDs constructed by `http-handler.mjs`. No case-insensitive fallback is permitted.
- Unrecognized variants return the existing private `Button no longer available` response without invoking storage's `confirm` or `cancel` methods.
- Normal `mm:cancel:<uuid>:private` still cancels, and the ordinary lower-case confirm path remains unchanged.

## Regression verification

- Direct dispatcher regression rejects `CANCEL`, `Cancel`, `CaNcEl`, `CONFIRM`, `Confirm` without any storage mutation; exact lowercase cancel still works.
- Signed offline HTTP regression creates a private preview, passes a correctly signed alternate-case CANCEL interaction, verifies **no listing was created**, and then uses the original legitimate Cancel button to cancel the still-pending preview.
- Code/tests commit [`8a29d237`](https://github.com/fierclioness/lioness-den-squad-finder/commit/8a29d237b017ab8354cb822f91004dc8534a3c7f). All final code-head workflows passed:
  - [Node core tests](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44909481715)
  - [Edge TypeScript / hosted checks](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44909481716)
  - [Disposable PostgreSQL integration](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44909481725)

Tests are offline/synthetic. They do **not** establish real Discord-client ACK timing or authorize new Discord app settings, public posting or deletion.

## Independent staging read-only check

On November 21, isolated staging Supabase `tcxktyqywsqafnyxhpgy` still has Edge function `den-matchmaker` v18 ACTIVE, 1 listing, 1 preview, 9 replay rows, and **zero** posting jobs, cleanup jobs, receipts or reconciliation-audit rows. No worker was deployed or invoked.

## Outstanding launch gates

PR #2 must remain draft and unmerged. Commands/public publishing remain OFF. Require separately approved client-observed sub-3s ACK testing; original-bot-owned controlled POST and reference-bound GET-before-DELETE; authenticated scheduler/expiry E2E; independent security review; and explicit launch approval. Do not modify production Den Missions or replace the original manual Squad Finder.
