# Den Matchmaker — signed preview response truncation safety
**Date:** November 21, 2026 UTC. **Scope:** Draft PR #2 only, no deployment or public Discord action.

## Finding
The signed interaction HTTP adapter previously used `result.content.slice(0,1850)` for any dispatcher output. If a future regression produced an overlong opt-in preview, it could silently hide consent or safety information while still attaching actionable `Confirm` and `Cancel` components. A returned HTTP 200 and ephemeral flag do **not** establish that truncated consent is informed consent.

## Draft-only change
- `matchmaker/http-handler.mjs`: refuse empty or over-1,850-code-unit dispatcher content with a short, ephemeral, no-components fallback. Never copy partial text from an unsafe response into a button-bearing Discord message.
- Preserve exact normal content, with no shortening, at the inclusive 1,850-character limit.
- `matchmaker/http-handler.test.mjs`: two new signed, Ed25519-authenticated offline HTTP regressions. An overlong preview containing public-post Confirm/Cancel intents returns private no-buttons fallback; an exactly 1,850-character private message survives unchanged. No real Discord network or bot post is exercised.

## Reproducible verification
Code/test commit `68dd09f0cb808424cebc2423e71dbcbd80627468`:
- [Core Node tests](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44903764418): **252 passed, 0 failed**, job log explicitly reports `# tests 252`.
- [Edge TypeScript check](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44903764410): **success**.
- [Disposable PostgreSQL integration](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44903764406): **success**.
- Source verification: read back both changed source files and the three CI conclusions after the commit. This is **synthetic signed HTTP** coverage, not measured Discord-client acknowledgement.

## Safety boundaries and staging inventory
Read-only isolated Supabase staging `tcxktyqywsqafnyxhpgy` reported Edge v18 ACTIVE and seven RLS-enabled private tables: one active listing row in table statistics, one pending preview, nine replay rows, and zero posting/cleanup jobs, receipts or reconciliation rows. Security advisors reported seven private RLS/no-policy INFO findings; performance advisors reported two unused-index INFO findings. No schema or database writes were performed.

No production Den Missions `cpjcjcxinhjusosaguyi` access, branch merge, deployment, Discord app setting or command registration, guild bot installation, public message, member data edit, or original manual Squad Finder modification.

## Outstanding launch blockers
Still require real Discord-client observed initial ACK under three seconds with headroom, separately authorized original-bot POST and reference-bound GET-before-DELETE cleanup tests, authenticated expiry/scheduler E2E, independent security review, and explicit launch approval. PR #2 remains draft/unmerged. This change is not launch clearance.
