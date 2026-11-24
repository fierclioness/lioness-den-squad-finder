-- REVIEW ONLY; disposable PostgreSQL CI. No production execution.
-- Requires the post-close-race.review.sql receipt schema and cleanup outbox.
-- IMPORTANT: This function does NOT verify Discord: only the trusted server may
-- call it AFTER independently checking a genuine, bot-owned, channel-bound
-- receipt and obtaining explicit operator authorization. Do not expose to a
-- browser or accept a client-supplied approval flag.
begin;
create table if not exists matchmaker_internal.reconciliation_audit (
 id bigint generated always as identity primary key,
 listing_id bigint not null references matchmaker_internal.squad_listings(id),
 original_outbox_state text not null check(original_outbox_state in ('uncertain','sending')),
 message_id text not null check(message_id ~ '^[0-9]{15,22}$'),
 channel_id text not null check(channel_id ~ '^[0-9]{15,22}$'),
 bot_user_id text not null check(bot_user_id ~ '^[0-9]{15,22}$'),
 operator_reference text not null check(length(btrim(operator_reference)) between 8 and 100),
 reason text not null check(length(btrim(reason)) between 10 and 300),
 created_at timestamptz not null default now(),
 unique(listing_id)
);
alter table matchmaker_internal.reconciliation_audit enable row level security;
revoke all on matchmaker_internal.reconciliation_audit from public,anon,authenticated;
grant select,insert on matchmaker_internal.reconciliation_audit to service_role;
grant usage,select on all sequences in schema matchmaker_internal to service_role;

create or replace function matchmaker_internal.record_manual_receipt(
 p_listing_id bigint,p_message_id text,p_channel_id text,p_bot_user_id text,
 p_operator_reference text,p_reason text)
returns text language plpgsql security invoker set search_path='' as $$
declare v_listing matchmaker_internal.squad_listings%rowtype;
        v_post matchmaker_internal.post_outbox%rowtype;
begin
 if p_message_id !~ '^[0-9]{15,22}$' or p_channel_id !~ '^[0-9]{15,22}$'
  or p_bot_user_id !~ '^[0-9]{15,22}$' or
  char_length(btrim(coalesce(p_operator_reference,''))) not between 8 and 100 or
  char_length(btrim(coalesce(p_reason,''))) not between 10 and 300
 then raise exception 'Insufficient reconciliation evidence'; end if;
 select * into v_listing from matchmaker_internal.squad_listings
 where id=p_listing_id for update;
 if not found then raise exception 'Unknown listing'; end if;
 select * into v_post from matchmaker_internal.post_outbox
 where listing_id=p_listing_id for update;
 if not found or v_post.state not in ('uncertain','sending')
 then raise exception 'Not an unresolved posting'; end if;
 if exists(select 1 from matchmaker_internal.post_receipts where listing_id=p_listing_id)
 then raise exception 'Receipt already present'; end if;
 insert into matchmaker_internal.post_receipts
 (listing_id,discord_message_id,channel_id,bot_user_id)
 values(p_listing_id,p_message_id,p_channel_id,p_bot_user_id);
 insert into matchmaker_internal.reconciliation_audit
 (listing_id,original_outbox_state,message_id,channel_id,bot_user_id,operator_reference,reason)
 values(p_listing_id,v_post.state,p_message_id,p_channel_id,p_bot_user_id,p_operator_reference,p_reason);
 update matchmaker_internal.post_outbox
 set state='posted',posted_message_id=p_message_id,claimed_by=null,claimed_at=null,
 last_error=null,updated_at=clock_timestamp() where listing_id=p_listing_id;
 if v_listing.status<>'active' or v_listing.expires_at<=clock_timestamp() then
  insert into matchmaker_internal.cleanup_outbox(listing_id,message_id,channel_id,bot_user_id)
  values(p_listing_id,p_message_id,p_channel_id,p_bot_user_id)
  on conflict(listing_id) do nothing;
  return 'receipt_recorded_cleanup_queued';
 end if;
 return 'receipt_recorded_active';
end $$;
revoke all on all functions in schema matchmaker_internal from public,anon,authenticated;
grant execute on all functions in schema matchmaker_internal to service_role;
commit;
-- If no independently verified receipt exists, row stays uncertain forever
-- until a human-reviewed resolution protocol is separately implemented.
-- Never convert "not found" into automatic permission to resend.
