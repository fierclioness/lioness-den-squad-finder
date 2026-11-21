# Den Matchmaker — isolated worker deployment runbook (DRAFT; no deployment)

## Scope
Target project: `tcxktyqywsqafnyxhpgy` (isolated staging only).
Target function: **`den-matchmaker-worker` only**. Existing `den-matchmaker` Discord webhook must remain untouched. Never run a blanket `supabase functions deploy` for this trial.

## Gate 1: CI and code identity
- Verify latest branch SHA and **both** `unit-tests` and `edge-worker-check` success on that SHA; review actual job logs.
- Inspect the deployed artifact: self-contained auth-only scaffold; no DB query, Discord token, network calls or task scheduling.
- Pin and verify compatible `@supabase/server` version; resolve Deno import check before proceeding.

## Gate 2: named-secret isolation
- Create/verify a **dedicated named secret key** `den-matchmaker-scheduler` in staging, not a generic default key. Do not paste its value into chat, GitHub, or logs.
- For this **separate** function only, `verify_jwt=false` is paired with `withSupabase({auth:'secret:den-matchmaker-scheduler'})`. New `sb_secret_*` keys belong in `apikey`, not `Authorization: Bearer`.
- Test no key, wrong key, publishable key, unrelated project secret, and named secret. Expect no key / wrong key rejected before handler. With correct key, handler must still return 503 disabled.

## Gate 3: explicit no-op first deployment
- Deploy **only** the auth-only `den-matchmaker-worker` Edge Function to staging, after prior gates pass.
- Confirm existing `den-matchmaker` function ID/version/verify_jwt configuration unchanged before/after.
- Confirm zero active listings, post jobs, cleanup jobs, and receipts before/after (read-only SQL).
- Do **not** create pg_cron, scheduled invocations, Discord messages, DB migrations or worker credentials at this stage.
- On any mismatch, stop; leave scheduler OFF and inspect logs. The disabled endpoint is a safe rollback state.

## Gate 4: future maintenance-only activation (separate change)
- Only after auth-only verification, wire private SQL and both authentication layers; no posting/cleanup credentials.
- Run bounded disposable data tests, verify expiry/claim behavior, and independently confirm least-privilege database access.
- Explicitly gate scheduler and maintenance; posting and Discord cleanup remain OFF.

This runbook is not evidence of a successful deployment and does not authorize public launch.
