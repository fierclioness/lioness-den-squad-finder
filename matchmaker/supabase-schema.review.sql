-- REVIEW-ONLY; NOT EXECUTED IN SUPABASE. Deployment requires separate review.
begin;
create schema if not exists matchmaker_internal;
revoke all on schema matchmaker_internal from public, anon, authenticated;

create table if not exists matchmaker_internal.squad_listings (
 id bigint generated always as identity primary key,
 owner_discord_id text not null check (owner_discord_id ~ '^[0-9]{15,22}$'),
 game text not null check (char_length(btrim(game)) between 1 and 55),
 platform text not null check (platform in ('Xbox','PlayStation','PC','Switch','Cross-play','Other')),
 vibe text not null check (vibe in ('Casual','Competitive','Either')),
 mic text not null check (mic in ('Optional','Required','No mic')),
 timezone text not null check (timezone in ('ET','CT','MT','PT','AT','UK','CET/CEST','UTC','Other')),
 availability text not null check (char_length(btrim(availability)) between 1 and 70),
 status text not null default 'active' check (status in ('active','closed','expired')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '36 hours'),
 closed_at timestamptz,
 discord_message_id text unique check(discord_message_id is null or discord_message_id ~ '^[0-9]{15,22}$'),
 check (expires_at > created_at),
 check (status <> 'closed' or closed_at is not null)
);
-- Expired active rows must be marked expired by the backend before a new insert.
create unique index if not exists squad_listings_one_active_per_member
 on matchmaker_internal.squad_listings(owner_discord_id) where status='active';
create index if not exists squad_listings_active_expiry
 on matchmaker_internal.squad_listings(expires_at) where status='active';
create table if not exists matchmaker_internal.discord_interaction_replays (
 interaction_id text primary key check (interaction_id ~ '^[0-9]{15,22}$'),
 received_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '10 minutes'),
 check(expires_at>received_at)
);
create index if not exists discord_interaction_replays_expiry
 on matchmaker_internal.discord_interaction_replays(expires_at);
alter table matchmaker_internal.squad_listings enable row level security;
alter table matchmaker_internal.discord_interaction_replays enable row level security;
revoke all on all tables in schema matchmaker_internal from public, anon, authenticated;
revoke all on all sequences in schema matchmaker_internal from public, anon, authenticated;
commit;

-- INCOMPLETE BY DESIGN. DO NOT APPLY without trusted transactional creation RPC,
-- per-member advisory locks, durable preview confirmation state, write cooldowns,
-- idempotency across Discord post calls, expiry and cleanup and testing.
