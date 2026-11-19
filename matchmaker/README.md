# The Den Matchmaker — isolated staging, not live

**Status November 19, 2026:** Implementation is under review in **draft PR #2**. The existing manual Squad Finder at https://fierclioness.github.io/lioness-den-squad-finder/ remains live and unchanged. Neither the production Den Missions bot nor the Lioness Den's member-facing Discord commands have been altered.

## What is built and verified

- Private, opt-in squad listings with one active listing per member, 36-hour expiry, owner-only close, validation against mentions/links and no automatic DMs.
- Signed Discord HTTP webhook: raw-body Ed25519 check, bounded timestamp, durable Postgres replay claim, verified guild/member context, ephemeral responses and Confirm/Cancel preview buttons.
- Isolated Supabase staging project with private PostgreSQL schema, service-only functions, one-use previews, rate limiting, atomic posting outbox and immutable bot message receipts. Ordinary anon/authenticated roles cannot access these tables.
- Development-only Discord POST and bot-authorship-verified GET-before-DELETE cleanup transport, durable workers and conservative quarantine for uncertain deliveries. No blind retries of ambiguous HTTP operations.
- Node, Deno and disposable PostgreSQL integration tests covering signed requests, private confirmation, posting with **mock** Discord, owner close, races, expiry and cleanup.
- A **separate Den Matchmaker Test** Discord app successfully verified its staging interaction endpoint using a real signed PING (Edge v7), recording a durable replay. Hosted Edge **v8** has been deployed with commands and public posting still disabled, and its read-only/negative HTTPS smoke checks pass.

## Critical explicit-consent rule

A member's **Save privately** confirmation calls `confirm_preview` and **does not enqueue a public message**. Enabling a posting worker later cannot retroactively publish that private listing. A distinct reviewed `publishingEnabled:true` command flow is required to call `confirm_and_enqueue`, and the preview must say **Post to #squad-up** before the member confirms. Public sending requires a **separate** bot worker gate, fixed approved channel and operator authorization. All publishing gates are **OFF** in staging.

## Still required before launch

1. The owner must explicitly authorize installing the separate test app and guild-scoped `/squad` registration, initially with posting OFF.
2. Verify a real secondary-account slash-command flow and the initial interaction response deadline, including cold start/DB failure cases.
3. Review and test bot permissions, approved destination, authenticated scheduler, 36-hour expiry, late or uncertain post reconciliation, verified original-message cleanup and rollback on a controlled test channel.
4. Review a least-privilege production credential/migration plan and get explicit permission for **each** production configuration change, public-post enablement, PR merge and launch.

**Never treat a passing offline test or Discord signed PING as authorization to post publicly.**

More detail: [hosted staging verification](hosted-staging-status.md), [Edge release gates](edge-runtime-release-gates.md), [cleanup lifecycle](cleanup-release-gates.md), and [posting recovery](posting-recovery-plan.md).
