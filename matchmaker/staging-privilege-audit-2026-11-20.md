# Isolated staging — read-only privilege and launch-safety audit (2026-11-20)

**Scope:** `tcxktyqywsqafnyxhpgy` (isolated Den Matchmaker Supabase staging) only. **Not** production Den Missions `cpjcjcxinhjusosaguyi`. Evidence was collected through read-only Supabase SQL, function metadata, and the security advisor on November 20, 2026. No production or staging writes, deployments, Discord app/guild changes, or public messages were involved.

## Verified database boundary

- All **7** `matchmaker_internal` base tables have PostgreSQL RLS enabled. Direct `anon` table SELECT and INSERT privileges are **false**; direct `authenticated` table SELECT and UPDATE privileges are **false**; `service_role` has SELECT access. The `anon` and `authenticated` roles do **not** have USAGE on the private schema.
- All **21** private-schema PostgreSQL functions inspected have `security_definer = false` and explicit ACLs granting EXECUTE to `postgres` and `service_role`, not `anon` or `authenticated`. Check by signature as well as function name because PostgreSQL permits overloads.
- Supabase security advisor reported **7 INFO** `rls_enabled_no_policy` notices, one per private table, not an automatically public exposure: there are intentionally no browser/client RLS policies. These notices should remain documented and reviewed if the access model ever changes. Advisor reference: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- Deployed Edge `den-matchmaker` remained **v18 ACTIVE** at observation. Database contained **1 listing, 1 pending preview, 9 replay rows, and 0 post jobs, cleanup jobs, posting receipts, or reconciliation audit rows**. These are staging artifacts: do **not** delete them merely to make launch checks green.

## Reproducible read-only SQL checks

```sql
-- Table privilege boundary: zero browser-role privileges is expected.
SELECT c.relname, c.relrowsecurity AS rls,
  has_table_privilege('anon',c.oid,'SELECT') AS anon_select,
  has_table_privilege('anon',c.oid,'INSERT') AS anon_insert,
  has_table_privilege('authenticated',c.oid,'SELECT') AS auth_select,
  has_table_privilege('authenticated',c.oid,'UPDATE') AS auth_update,
  has_table_privilege('service_role',c.oid,'SELECT') AS service_select
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='matchmaker_internal' AND c.relkind='r'
ORDER BY c.relname;

-- All private functions should be invoker functions, with no anon/auth EXECUTE.
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
  p.prosecdef AS security_definer,
  has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') AS auth_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') AS service_execute,
  p.proacl::text AS explicit_acl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='matchmaker_internal'
ORDER BY p.proname, args;

-- Schema itself is not available to browser roles.
SELECT rolname, has_schema_privilege(rolname,'matchmaker_internal','USAGE') AS schema_usage
FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','postgres');
```

## What this audit does *not* establish

- This validates **database grants, RLS configuration and RPC metadata**, not the correctness of every RPC's body, all Edge environment secrets, every possible HTTP route or independent outside penetration testing.
- Current GitHub CI passing on the branch is not evidence of client-visible Discord acknowledgment under **3 seconds**. Supabase server-side function durations cannot substitute for a real Discord client measurement.
- Controlled original-bot posting, receipt recovery, verified GET-before-DELETE, scheduler/expiry, and a separate independent security review remain open. They require the user's explicit permission before any live Discord posting/deletion, app changes or production release.
- Draft PR #2 remains review-only and unmerged; preserve the original manual Squad Finder and keep public posting/scheduling disabled.

**Disposition:** Database exposure checks PASS for the inspected current isolated-staging snapshot; **overall launch remains BLOCKED by the separate gates above**.
