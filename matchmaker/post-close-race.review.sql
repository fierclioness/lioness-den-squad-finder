-- REVIEW ONLY: disposable integration design, NEVER executed on user's Supabase.
-- Requires storage-operations.review.sql, post-outbox.review.sql, cleanup-outbox.review.sql.
-- No SQL transaction can make a Discord REST call atomic. This coordinates state
-- and ensures a confirmed post AFTER a close queues cleanup in the SAME DB txn.
begin;
create table if not exists matchmaker_internal.post_receipts (
 listing_id bigint primary key references matchmaker_internal.squad_listings(id),
 discord_message_id text unique not null check(discord_message_id ~ '^[0-9]{15,22}$'),
 channel_id text not null check(channel_id ~ '^[0-9]{15,22}$'),
 bot_user_id text not null check(bot_user_id ~ '^[0-9]{15,22}$'),
 created_at timestamptz not null default now()
);
alter table matchmaker_internal.post_receipts enable row level security;
revoke all on matchmaker_internal.post_receipts from public,anon,authenticated;
grant select,insert,update,delete on matchmaker_internal.post_receipts to service_role;

-- Only a signed, authorized member request may call this with its own owner ID.
-- Refuses a deleted/expired listing, and cleans up unstarted posts.
-- If a Discord POST is in flight, closing succeeds; a late confirmed receipt
-- must be queued for safe deletion by finish_post_with_receipt.
create or replace function matchmaker_internal.close_with_post_guard(p_owner text)
returns text language plpgsql security invoker set search_path='' as $$
declare v_id bigint; v_post text;
begin
 if p_owner !~ '^[0-9]{15,22}$' then raise exception 'Invalid member'; end if;
 perform pg_advisory_xact_lock(hashtextextended('matchmaker:'||p_owner,0));
 select id into v_id from matchmaker_internal.squad_listings
  where owner_discord_id=p_owner and status='active' and expires_at>clock_timestamp()
  for update;
 if v_id is null then return 'not_active'; end if;
 update matchmaker_internal.squad_listings
  set status='closed',closed_at=clock_timestamp() where id=v_id;
 update matchmaker_internal.post_outbox
  set state='cancelled',updated_at=clock_timestamp()
  where listing_id=v_id and state in ('pending','failed');
 select state into v_post from matchmaker_internal.post_outbox where listing_id=v_id;
 if v_post='posted' then
   insert into matchmaker_internal.cleanup_outbox
    (listing_id,message_id,channel_id,bot_user_id)
   select r.listing_id,r.discord_message_id,r.channel_id,r.bot_user_id
   from matchmaker_internal.post_receipts r where r.listing_id=v_id
   on conflict(listing_id) do nothing;
   if not found then raise exception 'Posted message missing trusted receipt'; end if;
   return 'closed_cleanup_queued';
 end if;
 if v_post='sending' or v_post='uncertain' then return 'closed_delivery_unresolved'; end if;
 return 'closed_without_post';
end $$;

-- Called only by a trusted Discord transport worker using a verified REST receipt.
-- Row lock + same DB transaction makes close and receipt mutually consistent.
-- The supplied channel/bot IDs MUST be checked by the trusted worker against
-- configured destination and the authenticated bot identity.
create or replace function matchmaker_internal.finish_post_with_receipt(
 p_listing_id bigint,p_worker uuid,p_message_id text,p_channel_id text,p_bot_user_id text)
returns text language plpgsql security invoker set search_path='' as $$
declare v_post matchmaker_internal.post_outbox%rowtype;
        v_listing matchmaker_internal.squad_listings%rowtype;
begin
 if p_message_id !~ '^[0-9]{15,22}$' or p_channel_id !~ '^[0-9]{15,22}$'
    or p_bot_user_id !~ '^[0-9]{15,22}$' then raise exception 'Invalid receipt'; end if;
 select * into v_listing from matchmaker_internal.squad_listings where id=p_listing_id for update;
 if not found then raise exception 'Unknown listing'; end if;
 select * into v_post from matchmaker_internal.post_outbox
  where listing_id=p_listing_id for update;
 if not found or v_post.state<>'sending' or v_post.claimed_by is distinct from p_worker
 then raise exception 'Worker does not own pending post'; end if;
 insert into matchmaker_internal.post_receipts
   (listing_id,discord_message_id,channel_id,bot_user_id)
 values(p_listing_id,p_message_id,p_channel_id,p_bot_user_id);
 update matchmaker_internal.post_outbox
 set state='posted',posted_message_id=p_message_id,claimed_by=null,
     claimed_at=null,last_error=null,updated_at=clock_timestamp()
 where listing_id=p_listing_id;
 if v_listing.status<>'active' or v_listing.expires_at<=clock_timestamp() then
   insert into matchmaker_internal.cleanup_outbox
    (listing_id,message_id,channel_id,bot_user_id)
   values(p_listing_id,p_message_id,p_channel_id,p_bot_user_id)
   on conflict(listing_id) do nothing;
   return 'posted_cleanup_queued';
 end if;
 return 'posted_active';
end $$;
revoke all on all functions in schema matchmaker_internal from public,anon,authenticated;
grant execute on all functions in schema matchmaker_internal to service_role;
commit;

-- IMPORTANT: DB cannot stop an in-flight HTTP POST from succeeding later.
-- Worker crash or missing receipt leaves 'sending' or 'uncertain' needing manual
-- reconciliation. Do NOT treat this script as complete automated cleanup.
