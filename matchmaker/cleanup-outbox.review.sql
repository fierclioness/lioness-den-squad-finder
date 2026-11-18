-- REVIEW ONLY; isolated PostgreSQL CI, NOT production Supabase.
-- Requires squad_listings + post_outbox schema. No Discord network calls.
begin;
create table if not exists matchmaker_internal.cleanup_outbox (
 listing_id bigint primary key references matchmaker_internal.squad_listings(id),
 message_id text not null check(message_id ~ '^[0-9]{15,22}$'),
 channel_id text not null check(channel_id ~ '^[0-9]{15,22}$'),
 bot_user_id text not null check(bot_user_id ~ '^[0-9]{15,22}$'),
 state text not null default 'pending'
  check(state in ('pending','claimed','uncertain','done')),
 claimed_by uuid,
 attempts integer not null default 0 check(attempts between 0 and 3),
 updated_at timestamptz not null default now(),
 check((state='claimed')=(claimed_by is not null))
);
alter table matchmaker_internal.cleanup_outbox enable row level security;
revoke all on matchmaker_internal.cleanup_outbox from public,anon,authenticated;
grant select,insert,update,delete on matchmaker_internal.cleanup_outbox to service_role;

-- Enqueue ONLY a previously confirmed bot post for an inactive/expired listing.
-- Channel and bot author must come from a separately verified trusted receipt;
-- do not accept these arguments from a Discord slash-command user.
create or replace function matchmaker_internal.queue_cleanup(
 p_listing_id bigint,p_channel text,p_bot text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_count integer;
begin
 if p_channel !~ '^[0-9]{15,22}$' or p_bot !~ '^[0-9]{15,22}$'
 then raise exception 'Invalid bot provenance'; end if;
 insert into matchmaker_internal.cleanup_outbox(listing_id,message_id,channel_id,bot_user_id)
 select s.id,o.posted_message_id,p_channel,p_bot
 from matchmaker_internal.squad_listings s
 join matchmaker_internal.post_outbox o on o.listing_id=s.id
 where s.id=p_listing_id
   and (s.status in ('closed','expired') or s.expires_at<=clock_timestamp())
   and o.state='posted' and o.posted_message_id is not null
 on conflict(listing_id) do nothing;
 get diagnostics v_count=row_count;
 return v_count=1;
end $$;

create or replace function matchmaker_internal.claim_cleanup(p_worker uuid)
returns bigint language plpgsql security invoker set search_path='' as $$
declare v_id bigint;
begin
 if p_worker is null then raise exception 'Worker required'; end if;
 with next as (
  select listing_id from matchmaker_internal.cleanup_outbox
  where state='pending' and attempts<3
  order by updated_at,listing_id for update skip locked limit 1
 )
 update matchmaker_internal.cleanup_outbox o
 set state='claimed',claimed_by=p_worker,attempts=o.attempts+1,updated_at=clock_timestamp()
 from next where o.listing_id=next.listing_id returning o.listing_id into v_id;
 return v_id;
end $$;

create or replace function matchmaker_internal.finish_cleanup(
 p_id bigint,p_worker uuid,p_verified_absent boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_count integer;
begin
 update matchmaker_internal.cleanup_outbox
 set state=case when p_verified_absent is true then 'done' else 'uncertain' end,
     claimed_by=null,updated_at=clock_timestamp()
 where listing_id=p_id and state='claimed' and claimed_by=p_worker;
 get diagnostics v_count=row_count;
 return v_count=1;
end $$;
revoke all on all functions in schema matchmaker_internal from public,anon,authenticated;
grant execute on all functions in schema matchmaker_internal to service_role;
commit;
-- NOT COMPLETE: trusted provenance persistence, actual verified Discord author,
-- atomic close/publish ordering, retries/reconciliation and scheduler remain required.
