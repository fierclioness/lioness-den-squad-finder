# Cross-session signed replay race — isolated CI verification (2026-11-21 UTC)

**Scope:** Draft PR #2 ONLY. The test runs in GitHub Actions against disposable `PGHOST=localhost` and `PGDATABASE=matchmaker_test` with generated Ed25519 keys and synthetic member/interaction IDs. No live Discord API, posting, member changes, Supabase staging mutation, production Den Missions changes, or original manual Squad Finder modifications.

## What changed

Extended `matchmaker/tests/signed-http-postgres-integration.mjs` with a *real database concurrency* gate. Six independently connected PostgreSQL sessions, each explicitly placed into `service_role`, submit authentic signed HTTP requests at once. Requests share **one** synthetic Discord interaction ID but alternate `/squad list` and `/squad mine` payloads. Each independent HTTP handler uses the same durable SQL `matchmaker_internal.claim_interaction` RPC through its own PostgreSQL client, not an in-memory replay Set.

The integration asserts **exactly one** HTTP 200 ephemeral acknowledgment, **five** HTTP 401 replay denials, **one** downstream dispatcher invocation, and **exactly one** persisted interaction-replay row. It closes every test database session in `finally`. The existing public-post outbox remains unused. This complements (but does not replace) earlier in-memory signed concurrent replay tests and sequential real PostgreSQL tests.

## Verified evidence

- [Core unit tests: 246/246 PASS, zero failures](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44889253709)
- [Edge TypeScript / hosted negative checks: PASS](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44889253738)
- [Disposable PostgreSQL integration: PASS](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44889253759); its `Test signed Discord HTTP to isolated PostgreSQL roundtrip` job step passed on code commit `34864318b8314526ff58f9283ee5a08312f26ed8`.
- Source and changed-file blob SHA were read back from the draft branch after writing.

## Limits and next release gates

This confirms multi-connection **database replay atomicity in offline CI**, not actual Discord-client initial-response latency, a network-visible Discord interaction, independently approved bot-owned POST/GET-before-DELETE, authenticated scheduler/expiry live E2E, or independent security review. Staging Edge runtime is a separate pre-existing deployment; **the new test code was not deployed**. Draft PR #2 must remain unmerged until explicit release approval. Production Den Missions (`cpjcjcxinhjusosaguyi`), Discord app/guild settings, member data, public posts and the existing manual Squad Finder remain off-limits.
