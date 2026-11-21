-- REVIEW ONLY: not applied to production Supabase. Requires preexisting supabase-schema.review.sql.
-- Trusted, signature-verifying gateway ONLY; never call with client-supplied owner IDs.
-- Functions intentionally live in non-exposed private schema and are SECURITY INVOKER.
begin;
create table if not exists matchmaker_internal.pending_previews (
 token uuid primary key default gen_random_uuid(),
 owner_discord_id text not null check(owner_discord_id ~ '^[0-9]{15,22}$'),
 game text not null check(char_length(btrim(game)) between 1 and 55),
 platform text not null check(platform in ('Xbox','PlayStation','PC','Switch','Cross-play','Other')),
 vibe text not null check(vibe in ('Casual','Competitive','Either')),
 mic text not null check(mic in ('Optional','Required','No mic')),
 timezone text not null check(timezone in ('ET','CT','MT','PT','AT','UK','CET/CEST','UTC','Other')),
 availability text not null check(char_length(btrim(availability)) between 1 and 70),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '10 minutes'),
 consumed_at timestamptz,
 check(expires_at > created_at)
);
create index if not exists pending_previews_expires_at_idx on matchmaker_internal.pending_previews(expires_at);
alter table matchmaker_internal.pending_previews enable row level security;
revoke all on matchmaker_internal.pending_previews from public, anon, authenticated;

create or replace function matchmaker_internal.prepare_preview(
 p_owner text,p_game text,p_platform text,p_vibe text,p_mic text,p_timezone text,p_availability text
) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_token uuid;
begin
 if p_owner !~ '^[0-9]{15,22}$' then raise exception 'Invalid member'; end if;
 insert into matchmaker_internal.pending_previews
 (owner_discord_id,game,platform,vibe,mic,timezone,availability)
 values (p_owner,p_game,p_platform,p_vibe,p_mic,p_timezone,p_availability)
 returning token into v_token;
 return v_token;
end $$;

-- Must be called ONLY after separate signed-interaction replay ID is committed.
-- Each member's confirm/close transition serializes with an advisory lock.
create or replace function matchmaker_internal.confirm_preview(p_owner text,p_token uuid)
returns bigint language plpgsql security invoker set search_path='' as $$
declare v_preview matchmaker_internal.pending_previews%rowtype;
        v_listing_id bigint;
        v_now timestamptz := clock_timestamp();
begin
 if p_owner !~ '^[0-9]{15,22}$' then raise exception 'Invalid member'; end if;
 perform pg_advisory_xact_lock(hashtextextended('matchmaker:'||p_owner,0));
 select * into v_preview from matchmaker_internal.pending_previews
  where token=p_token and owner_discord_id=p_owner and consumed_at is null
  for update;
 if not found then raise exception 'Preview unavailable'; end if;
 if v_preview.expires_at<=v_now then raise exception 'Preview expired'; end if;
 update matchmaker_internal.squad_listings
  set status='expired' where owner_discord_id=p_owner and status='active' and expires_at<=v_now;
 if exists(select 1 from matchmaker_internal.squad_listings
  where owner_discord_id=p_owner and status='active') then
  raise exception 'Active listing already exists';
 end if;
 if exists(select 1 from matchmaker_internal.squad_listings
  where owner_discord_id=p_owner and created_at>v_now-interval '60 seconds') then
  raise exception 'Please wait before creating another listing';
 end if;
 insert into matchmaker_internal.squad_listings
  (owner_discord_id,game,platform,vibe,mic,timezone,availability,created_at,expires_at)
 values(p_owner,v_preview.game,v_preview.platform,v_preview.vibe,v_preview.mic,
        v_preview.timezone,v_preview.availability,v_now,v_now+interval '36 hours')
 returning id into v_listing_id;
 update matchmaker_internal.pending_previews set consumed_at=v_now where token=p_token;
 return v_listing_id;
end $$;

create or replace function matchmaker_internal.cancel_preview(p_owner text,p_token uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_deleted integer;
begin
 if p_owner !~ '^[0-9]{15,22}$' then raise exception 'Invalid member'; end if;
 delete from matchmaker_internal.pending_previews
 where token=p_token and owner_discord_id=p_owner and consumed_at is null;
 get diagnostics v_deleted=row_count;
 return v_deleted=1;
end $$;

create or replace function matchmaker_internal.close_my_listing(p_owner text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_count integer;
begin
 if p_owner !~ '^[0-9]{15,22}$' then raise exception 'Invalid member'; end if;
 perform pg_advisory_xact_lock(hashtextextended('matchmaker:'||p_owner,0));
 update matchmaker_internal.squad_listings set status='closed',closed_at=clock_timestamp()
 where owner_discord_id=p_owner and status='active' and expires_at>clock_timestamp();
 get diagnostics v_count=row_count;
 return v_count=1;
end $$;

-- Signed gateway must call this FIRST and commit before command execution.
-- Unique interaction ID ensures one accepted request across workers.
create or replace function matchmaker_internal.claim_interaction(p_interaction_id text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_count integer;
begin
 if p_interaction_id !~ '^[0-9]{15,22}$' then raise exception 'Invalid interaction'; end if;
 insert into matchmaker_internal.discord_interaction_replays(interaction_id)
 values(p_interaction_id) on conflict do nothing;
 get diagnostics v_count=row_count;
 return v_count=1;
end $$;

revoke all on all functions in schema matchmaker_internal from public, anon, authenticated;
grant usage on schema matchmaker_internal to service_role;
grant select,insert,update,delete on all tables in schema matchmaker_internal to service_role;
grant usage,select on all sequences in schema matchmaker_internal to service_role;
grant execute on all functions in schema matchmaker_internal to service_role;
commit;

-- Further work before deployment: signed gateway integration; async Discord response,
-- one-post-only recovery/outbox; test owner race and function privilege boundaries,
-- staged RLS tests, cleanup jobs, feature flag and rollback. No production work performed.
