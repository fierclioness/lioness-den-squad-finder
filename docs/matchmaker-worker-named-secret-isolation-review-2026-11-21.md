# Den Matchmaker — isolated worker authentication boundary review

**Status: draft-only; reviewed November 21, 2026 UTC.** No worker deployed, scheduled or enabled. This is documentation and an offline/static regression test, not authorization to call Discord or alter staging data.

## Finding and correction

The review-only `matchmaker/scheduled-worker-composition.mjs` header incorrectly claimed that a future scheduler endpoint **MUST** have `verify_jwt=true`. The selected, separately scoped worker uses Supabase's named-secret service-to-service pattern instead: `verify_jwt=false` **only** for `den-matchmaker-worker`, where `withSupabase({auth:"secret:den-matchmaker-scheduler"})` independently verifies the dedicated named API key. The gateway subsequently requires its own `x-matchmaker-scheduler-key` and denies tasks by default. `verify_jwt=true` alone does not authenticate modern `sb_secret_*` API keys. No user JWT is fabricated.

The misleading comment and the worker gate note in `matchmaker/edge-runtime-release-gates.md` are corrected. The existing `supabase/config.toml` and auth-only worker scaffold already express the selected architecture. This change does **not** relax authentication or activate worker functions.

## Verified regression evidence

Added an offline test in `matchmaker/edge-worker-scaffold.test.mjs` asserting that the existing signed Discord interaction webhook cannot directly import the scheduler Edge entrypoint, named secret, privileged worker composition or Supabase worker auth wrapper. Existing tests assert that the worker scaffold is inert, uses the named-secret wrapper, responds disabled (503), and has no database or Discord work, and that only the **separate worker** has its JWT platform check disabled. These are source-level checks, **not** independent review of dynamic imports, key rotation or an actual deployed endpoint.

On code/test commit `685fa851`: [245/245 Node tests pass](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44879180234), [Edge checks pass](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44879180266), and [disposable PostgreSQL integration passes](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44879180217). No production connection or publishing credentials were used by these checks.

Read-only isolated staging inspection: `den-matchmaker` v18 ACTIVE, one listing, one preview, nine replay rows; zero publishing jobs, cleanup jobs, receipts or reconciliation entries. All seven internal tables have RLS enabled. The separate `den-matchmaker-worker` is **not** deployed.

## Release blockers remain

Before a controlled worker trial: authorize the **separate** staging worker deployment; verify dedicated named-secret provisioning, `apikey` header handling, missing/wrong/cross-project-key denial, independent second-key denial, secret rotation and leak prevention; review least-privilege SQL connector and scheduler behavior. Prior to launch also obtain actual Discord-client ACK timing, separately approved original-bot POST and GET-before-DELETE cleanup E2E, expiry/maintenance testing, independent security review, PR merge-conflict resolution and explicit release permission. Preserve production Den Missions, live Discord configuration, public posting, member data and the original manual Squad Finder.
