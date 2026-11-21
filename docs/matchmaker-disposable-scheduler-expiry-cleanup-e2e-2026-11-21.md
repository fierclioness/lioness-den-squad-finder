# Disposable scheduler expiry -> bot-owned cleanup E2E (November 21, 2026 UTC)

**Classification:** draft-only test evidence. No staging deployment, no Discord API calls or public posts/deletions, no guild/command configuration, no production Den Missions writes, and no change to the manual Squad Finder.

## What was exercised

Extended `matchmaker/tests/postgres-discord-publisher-integration.mjs` within the existing PostgreSQL 17 disposable GitHub Actions job. A synthetic third member confirms a public-opt-in listing; an injected mock Discord HTTP 200 response containing the exact original message text creates one trusted original-bot receipt. **Only in disposable PostgreSQL**, the listing timestamps are moved past their 36-hour expiry.

An offline application-level scheduler chain then runs:

1. `makeAuthenticatedSchedulerAdapter` rejects a request without a simulated trusted `{authMode:"secret"}` context.
2. With that simulated context, `makeScheduledWorkerGateway` independently rejects the wrong `x-matchmaker-scheduler-key`. Neither denied call expires the listing.
3. Both checks supplied, the private maintenance worker executes actual PostgreSQL expiry RPCs, changes the posted listing to `expired`, and queues a single cleanup job tied to its original trusted message receipt.
4. The cleanup worker calls mock Discord **GET before DELETE**, verifying the original bot, fixed channel, exact message and persisted listing reference, then records the durable cleanup job `done` with one attempt.
5. A repeated maintenance call produces no duplicate cleanup record, public post or second send.

No real Discord message was posted or deleted; mock fetch had no external network. The explicit `PGHOST=localhost` and `PGDATABASE=matchmaker_test` guard prevents running this script against a hosted database.

## Verified results

- Code/test commit: `3367a910ce102565b5291cee1985fae582663863`
- [Node CI, 254/254 passed](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44914164999)
- [Deno / Edge TypeScript checks passed](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44914165044)
- [Disposable PostgreSQL integration passed](https://github.com/fierclioness/lioness-den-squad-finder/actions/runs/44914165016)
- Verified the PostgreSQL CI job log includes `Disposable PostgreSQL, mocked scheduler auth, posted expiry and GET-before-DELETE cleanup PASSED`.

Isolated staging read-only inventory at review: Edge `den-matchmaker` v18 ACTIVE; seven private RLS-enabled tables; **one listing, one pending preview, nine replay records, zero post jobs, cleanup jobs, receipts, or reconciliation rows**.

## What this does NOT prove

This is a real PostgreSQL / mocked-Discord integration test, **not** a hosted Supabase scheduler deployment or real Supabase named-secret validation: the upstream `verifiedContext` is injected as a test double. No real Discord-client interaction deadline, original-bot public POST, real-message GET-before-DELETE, or hosted scheduler transport was tested. It does not authorize posting or cleanup in the real guild.

**Still blocked:** measured client-observed initial ACK under three seconds with headroom, independently authorized real-bot post and verified cleanup test, actual Supabase named-secret scheduler/expiry E2E, independent security review and explicit release permission. Keep PR #2 DRAFT, worker/scheduler/public posting OFF, and production Den Missions untouched.
