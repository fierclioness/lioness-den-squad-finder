# Den Matchmaker hosted staging decision — November 18, 2026

## Supabase branch attempt and result
- Existing main project: `cpjcjcxinhjusosaguyi` — Den Missions 2.0. It is healthy and contains **no** `matchmaker_internal` tables.
- User explicitly approved a development branch costing **$0.01344/hour**.
- Supabase's cost confirmation step succeeded, but `create_branch` was rejected by the provider: **"Branching is supported only on the Pro plan or above."**
- Result: **NO development branch created**, no upgrade, no production migration, no Discord command registration, no real posts or member changes.
- A second Supabase quote for a **new independent project** in the same organization returned **$0/month** at the time of query. This is a quoted base price, **not a guarantee of availability or zero metered costs**.

## Safe forward path
1. **Preferred if user authorizes**: create a brand-new separate Supabase project named Den Matchmaker Staging (not a branch of Den Missions). Verify quota, actual billing, that its project_ref differs from production, and that it has **no existing data** before changing schema. Do not copy real member data or credentials into it.
2. Apply the existing proposed private Matchmaker SQL **only after** reviewing dependencies and permission models, to that separate project. Use the staging project's actual ID in all subsequent tools.
3. Deploy the disabled-by-default Matchmaker Edge Function **only on staging**; never use the production Discord bot token, guild or posting destination for tests. Begin with signed synthetic requests and non-posting commands.
4. Verify response latency, private role grants, RLS, replay claims, one-use confirmation, post/cleanup outboxes and recovery. Keep actual Discord publishing flag OFF.
5. After tests, request separate explicit approval for any production schema or Discord configuration changes. Keep the original manual web Squad Finder live.

## If a separate project is unavailable
Continue using GitHub Actions' disposable PostgreSQL 17 integration and Deno typecheck, which already pass. These **do not** establish hosted runtime readiness. No plan upgrade or billable resource should be created without express authorization.

## Non-negotiable controls
- Before every Supabase write, compare target project ID against production `cpjcjcxinhjusosaguyi`; abort if equal.
- Never copy or publish server secrets in GitHub, Canva, Discord, or test fixtures.
- Never deploy an active public-post worker while the feature gate and member authorization are unverified.
- Mark PR #2 as DRAFT until staging and controlled real-guild testing pass.
