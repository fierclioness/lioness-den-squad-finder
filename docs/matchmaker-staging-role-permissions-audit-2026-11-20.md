# Den Matchmaker — staging private-schema permissions verification

Date: 2026-11-20. Source: **read-only SQL against isolated staging project** `tcxktyqywsqafnyxhpgy`.

## Verified
- `matchmaker_internal` schema USAGE: `anon=false`, `authenticated=false`, `service_role=true`.
- Across seven ordinary private tables: `anon` and `authenticated` each have **0 SELECT, 0 INSERT, 0 DELETE** table privileges.
- `service_role` has **7 SELECT, 7 INSERT, 6 DELETE** table privileges. This is broad privileged access, **not least-privilege worker authorization**.
- Across 20 private SQL functions: `anon` and `authenticated` can execute **0**, while `service_role` can execute **20**.\n- This read-only audit did not change any grants, roles, records or Edge Functions.

## Security implications
- The lack of public schema/table privileges is positive defense in depth.
- A named Supabase secret API key authenticated with `withSupabase({auth:'secret:den-matchmaker-scheduler'})` can expose a `supabaseAdmin` client that bypasses RLS. Do **not** wire that admin client into maintenance by default.
- The future maintenance SQL connector must have independently reviewed, narrowly scoped privileges. Consider a dedicated restricted PostgreSQL role or narrowly scoped private RPC access; evaluate deployment/runtime support and test privilege boundaries before activation.
- The initial **authentication-only** Edge Function has no SQL connector, and therefore does not need database privileges to operate.

## Next verification
- Recheck all private function EXECUTE grants and role inheritance.
- Confirm dedicated named API key exists without exposing its value.
- Verify Deno and Node CI for the latest branch.
- Only after authentication-only deployment is verified should a separate maintenance-worker design be reviewed.

This evidence is not permission to deploy, enable scheduler, post, delete, or migrate.
