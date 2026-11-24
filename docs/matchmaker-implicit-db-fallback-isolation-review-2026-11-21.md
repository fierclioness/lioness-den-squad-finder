# Den Matchmaker — implicit staging database fallback isolation review (2026-11-21 UTC)

**Scope:** draft PR #2 only. This report documents source/testing, not a staging deployment or launch authorization.

## Risk and correction

The staging-only Edge runtime already refused URLs whose hostname/role explicitly named another Supabase project, including Den Missions production. However, the automatically supplied `SUPABASE_DB_URL` fallback could still point to an opaque host such as `production.internal`, `localhost` or a generic proxy. A hostname without the staging project reference cannot prove that staging database credentials will reach the approved isolated project.

The draft `resolvePrivateDatabaseUrl` fallback now requires BOTH existing wrong-project/TLS-override validation and an attributable staging database endpoint: `db.tcxktyqywsqafnyxhpgy.supabase.co`, or an official `*.pooler.supabase.com` hostname with a project-scoped database username ending in `.tcxktyqywsqafnyxhpgy`. Opaque implicit fallback URLs fail closed, without silently changing to another connection.

An **explicit** `DEN_MATCHMAKER_DATABASE_URL` retains existing private-proxy compatibility. An opaque proxy is **not** independently attested by its URL; the existing preflight refuses to give it a green controlled-test readiness flag until reviewed. This change does not authorize any private proxy, worker, database migration or public Discord action.

## Reproducible automated evidence

- Code: `matchmaker/staging-runtime-config.mjs`; adversarial regression: `matchmaker/staging-runtime-config.test.mjs`.
- Final reviewed code/test commit: `c0fcb9c6634ef94906fba6a7f97dca7f0215a37c`.
- [Node core workflow](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44860068890): **238 tests, 238 pass, 0 fail**; test log confirms the new fallback isolation regression ran.
- [Edge TypeScript and hosted negative HTTP workflow](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44860068921): PASS. The hosted staging smoke is read-only and does not activate posting.
- [Disposable PostgreSQL integration workflow](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44860068954): PASS on isolated ephemeral PostgreSQL; this is not production or live Discord delivery evidence.

Read-only Supabase staging inspection on the same run: Edge `den-matchmaker` version **18 ACTIVE**, 1 listing, 1 pending preview, 9 signed interaction replay records; **zero** publish jobs, cleanup jobs, bot-message receipts or reconciliation records; **zero** overdue active listings and claimed cleanup jobs. No staging database writes or Edge deployment occurred.

## Remaining launch gates

The source change is **draft-only** and does not establish real Discord client-visible initial response latency under three seconds, independently approved original-bot POST/GET-before-DELETE cleanup E2E, scheduler/expiry completion, external security sign-off or release approval. PR #2 remains draft/unmerged with merge conflicts. No production Den Missions project, live Discord application or guild, public messages, member data or original manual Squad Finder changed.

**Release decision:** NOT READY. Keep all posting and scheduler gates OFF; require separate explicit approval for any live bot-owned publishing, deletion, production deployment, PR merge or launch.
