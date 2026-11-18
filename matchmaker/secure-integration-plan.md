# Den Matchmaker — Secure Discord and Supabase Integration Plan (review only)

**Status:** Technical design, NOT deployed. Current working Squad Finder remains unchanged.

## 1. Discord command surface

Register one guild-scoped `/squad` application command with `create`, `mine`, `list`, `close` subcommands only after the backend is verified. Commands are not installed by this pull request.

- `create`: open interactive form; return an **ephemeral** preview with Confirm/Cancel. Confirm must explicitly publish; default is cancel/no post.
- `mine`: ephemeral summary of only the requester's listing.
- `list`: ephemeral summary of currently available, unexpired opt-in listings; no public member directory.
- `close`: owner only, immediately remove from active list; avoid deleting others' posts.
- No unsolicited DMs, role pinging, broad mention permissions, or auto-joining voice calls.

## 2. Authenticating interactions

Discord Interactions endpoint must validate Discord's `X-Signature-Ed25519` and `X-Signature-Timestamp` headers against the **raw request bytes** before parsing JSON. Reject malformed, stale, replayed or invalid signed payloads; respond to Discord PING only after valid signature. Verify the exact guild, command name, expected interaction type, and member user ID from signed interaction data. Never accept an actor ID from a public form field. Restrict to the existing 18+ server, not user DMs.

An in-memory mock actor is for development **only**; it provides no authentication and must never be exposed as a public endpoint.

## 3. Supabase data (do not create yet)

Keep this feature separate from Den Missions. Suggested **private** schema `matchmaker_internal`, with an active listing record, expiring at creation + 36 hours. Store only: Discord member snowflake, game (55 chars), platform, vibe, mic preference, time zone, approximate availability (70 chars), creation timestamp, expiration timestamp, status and a generated internal listing ID. Do not store display names, emails, exact address, chat history, or sensitive profile traits.

Database should enforce **one active listing per member** transactionally; an application-only check can race and is insufficient. On create, within a database transaction lock per member, expire prior expired listings, enforce a 60-second cooldown and one active listing, then insert. Use a unique partial index on active member listings as defense in depth and a short-lived replay/idempotency store for Discord interaction IDs.

Use explicit service-only permissions and deny direct `anon` / `authenticated` access to private tables. An interaction-verifying Edge Function or other trusted backend authorizes each action, not client-provided owner IDs. Prefer least-privilege database RPCs with safe `search_path` and explicit role grants if service role is too broad.

Avoid a public `SECURITY DEFINER` function. Check actual Supabase Data API schema exposure, grants and RLS policies and run security advisors before any migration.

## 4. Posting and clean-up

Post only after the member presses Confirm. Verify the destination is the known #squad-up channel and use `allowed_mentions: {parse: []}`. Post contents must remain sanitized and rate-limited. Store the posted Discord message ID solely to support closing, editing or removing the bot's own posting. Closing a listing should avoid touching unrelated member messages. TTL cleanup must also clear/expire listings across instances, not only in browser memory.

Member-facing messages should be short, welcoming and avoid promising real-time matches.

## 5. Mandatory tests prior to rollout

- Invalid Ed25519 signature, malformed timestamp, replays, wrong guild, wrong user and forged owner ID rejected.
- All responses, previews and errors ephemeral unless explicit Confirm publishes one squad post.
- Concurrent confirms create no more than one active listing.
- Expired records excluded and cleaned; list and mine display no non-opted-in data.
- Only owner can close; create/close cooldown cannot be circumvented.
- Input injection, Discord mentions, bad URLs, oversized text, wrong channels and permissions.
- Discord interaction response meets Discord timeout and token limits.
- Authorized secondary test account only; do not involve organic members in test activity.
- Safe rollback, feature flag disabled by default, and production-data backup before launch.

## Release gates

No Supabase schema changes, deployed Edge Functions, Discord app installation, roles, member data, announcements or merge to `main` until authorized and tested. Discord app credentials and scheduler passwords (secret keys) must never be included in source control.

Related: issue #1, draft PR #2. See official Discord interactions documentation for current response and signature rules.
