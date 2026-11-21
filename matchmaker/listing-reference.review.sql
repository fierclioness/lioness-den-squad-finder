-- REVIEW ONLY. Run ONLY against disposable PostgreSQL integration database.
-- UUID is random, non-identifying, unique per listing. Never use member snowflakes.
begin;
alter table matchmaker_internal.squad_listings
 add column if not exists post_reference uuid not null default gen_random_uuid();
create unique index if not exists squad_listings_post_reference_unique
 on matchmaker_internal.squad_listings(post_reference);
commit;
-- On a future approved deployment: migrate existing records cautiously, keep
-- reference immutable, verify bot-owned Discord message author and channel.
