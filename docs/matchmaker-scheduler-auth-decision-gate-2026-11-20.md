# Den Matchmaker scheduler authentication decision gate

Status: **BLOCKED — no scheduler deployment approved by technical preflight yet.** The user delegated technical judgment; do not confuse that with passing the technical release gates.

## Verified Supabase behavior
Supabase's current [Authorization headers documentation](https://supabase.com/docs/guides/functions/auth-headers) says `verify_jwt=true` validates a JWT in `Authorization`, **not** new `sb_secret_*` or `sb_publishable_*` API keys. Those belong in the `apikey` header. Do not put a secret API key into `Authorization: Bearer` and assume it will pass.

## Deployment-safe choices (select and verify before implementation)
1. **User JWT model:** keep `verify_jwt=true`, issue and validate a legitimate Supabase Auth user JWT for a tightly scoped scheduler principal; also enforce the separate `x-matchmaker-scheduler-key` secret. Do not repurpose a personal account login.
2. **Service-to-service model:** `verify_jwt=false` with explicit, independently verified server-side authentication/authorization of a dedicated secret API key **and** the separate scheduler key; never rely on the disabled platform JWT check. Must design and test key rotation, rejection of publishable keys, logging redaction and permissions before use.

Neither model has been implemented end to end in the currently undeployed scheduler endpoint. The existing gateway only validates its custom scheduler key and route/task gates; it does not itself validate a Supabase caller identity. A long custom secret is not a substitute for an independently reviewed service-auth layer.

## Non-negotiable gates
- Choose one auth model and implement an isolated Edge entrypoint with explicit denied-by-default behavior.
- Verify missing/invalid credentials, replay/duplicate requests, wrong paths, disabled tasks, and no secret disclosure.
- Confirm worker's private SQL connector cannot access other projects and is least privileged.
- Obtain fresh green CI for unit, PostgreSQL integration, and Edge checks on latest code.
- Keep posting, Discord cleanup and scheduler OFF until separate controlled-test authorization and verification.

Current isolated staging project `tcxktyqywsqafnyxhpgy` only has `den-matchmaker` deployed; no `den-matchmaker-worker` deployed as of the last read-only check. No secrets are stored in this document.
