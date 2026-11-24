# Matchmaker storage security plan — proposed only

This is a development-only schema proposal, NOT a migration applied to Supabase. Preserve Den Missions production tables.

## Private storage
Separate matchmaker_internal schema with RLS enabled, no public policies, and no direct grants to anon/authenticated. Store only voluntary short-lived gameplay preferences. Do not collect emails, location, legal names, private chat content, or age.

## Atomicity
One-active-listing partial unique index blocks duplicate active listings, but it also blocks replacement when an expired row is not marked expired. A trusted transaction must lock the member, expire stale rows, check the 60-second cooldown, and insert atomically. Do not rely on application memory.

## Signed interactions
Verify Discord Ed25519 signature over raw request bytes and strict timestamps before parsing. For multi-instance deployments, store each signed interaction ID in the replay table with an atomic insert; reject duplicates. Implement durable, member-bound, one-use preview confirmation tokens before publishing. Ensure published Discord posts are idempotent and use allowed_mentions.parse empty.

## Release gates
Build trusted production handler, transactional RPC, privacy-safe cleanup, one-use confirmation, strict guild and member authorization, rate limits, rollback, test against a permitted secondary test account, check RLS/security advisors, and get approval for deployment. Feature flag defaults OFF. Never use the offline Node/mock actor objects in production.
