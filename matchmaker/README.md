# The Den Matchmaker — Phase 1 (development only)

A private, opt-in squad-listing feature for **The Lioness Den**. This is a *prototype*, not a live Discord bot.

## Why
Existing Squad Finder is a working copy/paste utility and remains untouched. The next experience should let an adult member voluntarily create a temporary squad listing without turning the Discord server into an ad board or DM machine.

## Implemented in this branch
- `matchmaker-core.mjs`: validates game, platform, play style, microphone preference, time zone and availability.
- One active listing per owner; listings expire after **36 hours**.
- Owner-only close; active-list filtering; preview string for the existing #squad-up channel.
- Guardrails against links and Discord mentions in free-text fields.
- Pure Node test suite: positive, validation, ownership, expiration and anti-spam cases.

## Not implemented
Discord application /slash command registration, HTTP interactions endpoint, Ed25519 signature verification, persistence, atomic duplicate blocking, rate limits, message posting, database RLS, or member permissions. **Never connect this prototype directly to a public webhook.** These controls must be added and separately tested first.

## Next safe milestones
1. Build a mock-only interaction adapter for `/squad create`, `/squad mine`, `/squad close` and `/squad list` without network access.
2. Design a private Supabase table with owner-only access, server-enforced 36h TTL, one-active-listing constraint and per-member rate limits. Review schema/RLS before applying anything.
3. Build a Discord HTTP endpoint that checks raw body Ed25519 signature and request timestamp *before* parsing, rejects replay attempts and supports Discord PING. Verify guild/channel ID and requesting member, restrict mentions.
4. Show an ephemeral preview and require an explicit **Publish** action before posting only to the existing #squad-up channel; no DMs or user pings. Provide Close / Report options.
5. Test using authorized secondary account, with real users excluded from experiments; make an opt-in announcement only after owner approves release.

## Privacy
Never collect full names, personal age/date of birth, exact addresses or contact info. The 18+ server policy is enforced by existing membership rules; this prototype does not infer age. No scraping message history or measuring private conversations. Store only what is needed to support an opted-in listing.

## References
- Existing live copy/paste Squad Finder: https://fierclioness.github.io/lioness-den-squad-finder/
- Discord Interactions guide: https://docs.discord.com/developers/docs/interactions/overview
- Product request: GitHub issue #1

## Rollout rule
No default-branch merge, deployment, production database changes, new Discord commands, or public announcements as part of this branch.
