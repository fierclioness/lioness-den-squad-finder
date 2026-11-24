-- REVIEW ONLY. Disposable PostgreSQL CI only; NOT applied to staging or production.
-- Purges expired transient replay and preview rows in bounded batches.
-- Retain FIVE ADDITIONAL minutes beyond their existing 10-minute expiration:
-- signed Discord timestamps may be up to 5 minutes ahead of the verifier clock,
-- so removing a replay row exactly at 10 minutes may shorten replay safety
-- under clock skew. Never delete any unexpired or recently expired claim.
begin;
create or replace function matchmaker_internal.purge_expired_transient_rows(
 p_max_rows integer default 100
) returns table(replays_purged integer, previews_purged integer)
language plpgsql security invoker set search_path='' as $$
declare v_replays integer; v_previews integer;
begin
 if p_max_rows is null or p_max_rows<1 or p_max_rows>500
 then raise exception 'Invalid transient retention batch limit'; end if;
 -- Row locks prevent competing maintenance calls from counting/deleting
 -- the same records. The replay primary key remains authoritative while
 -- every possibly valid signed retry can still pass its freshness window.
 with expired as (
  select interaction_id from matchmaker_internal.discord_interaction_replays
  where expires_at < clock_timestamp()-interval '5 minutes'
  order by expires_at,interaction_id
  for update skip locked limit p_max_rows
 )
 delete from matchmaker_internal.discord_interaction_replays r
 using expired e where r.interaction_id=e.interaction_id;
 get diagnostics v_replays=row_count;
 with expired as (
  select token from matchmaker_internal.pending_previews
  where expires_at < clock_timestamp()-interval '5 minutes'
  order by expires_at,token
  for update skip locked limit p_max_rows
 )
 delete from matchmaker_internal.pending_previews p
 using expired e where p.token=e.token;
 get diagnostics v_previews=row_count;
 return query select v_replays,v_previews;
end $$;
revoke all on function matchmaker_internal.purge_expired_transient_rows(integer)
 from public,anon,authenticated;
grant execute on function matchmaker_internal.purge_expired_transient_rows(integer)
 to service_role;
-- Manual operator retention for the MVP. No Discord calls or scheduler.
-- Proposed maximum eligibility delay: 24h after close/expiry, run daily.
-- Never erase evidence of a possible live Discord post. A moderator can
-- remove the post manually; a trusted operator must verify absence first.
create or replace function matchmaker_internal.purge_resolved_listings(
 p_max_rows integer default 100
) returns integer
language plpgsql security invoker set search_path='' as $retention$
declare v_ids bigint[]; v_count integer;
begin
 if p_max_rows is null or p_max_rows<1 or p_max_rows>500
 then raise exception 'Invalid listing retention batch limit'; end if;
 with due as (
  select s.id from matchmaker_internal.squad_listings s
  left join matchmaker_internal.post_outbox o on o.listing_id=s.id
  left join matchmaker_internal.post_receipts r on r.listing_id=s.id
  left join matchmaker_internal.cleanup_outbox c on c.listing_id=s.id
  left join matchmaker_internal.reconciliation_audit a on a.listing_id=s.id
  where (case when s.status='closed' then s.closed_at else s.expires_at end)
    < clock_timestamp()-interval '24 hours'
  and (
   -- No send, or an explicitly cancelled and never-delivered job.
   ((o.listing_id is null or (o.state='cancelled' and o.posted_message_id is null))
     and s.discord_message_id is null and r.listing_id is null
     and c.listing_id is null and a.listing_id is null)
   or
   -- Verified absence, with exact persisted original-bot receipt.
   (o.state='posted' and c.state='done'
     and o.posted_message_id=r.discord_message_id
     and c.message_id=r.discord_message_id and c.channel_id=r.channel_id
     and c.bot_user_id=r.bot_user_id
     and (s.discord_message_id is null or s.discord_message_id=r.discord_message_id)
     and (a.listing_id is null or
       (a.message_id=r.discord_message_id and a.channel_id=r.channel_id and a.bot_user_id=r.bot_user_id)))
  )
  order by s.expires_at,s.id for update of s skip locked limit p_max_rows
 )
 select coalesce(array_agg(id),array[]::bigint[]) into v_ids from due;
 -- Children first; one atomic transaction, no broad cascade.
 delete from matchmaker_internal.reconciliation_audit where listing_id=any(v_ids);
 delete from matchmaker_internal.cleanup_outbox where listing_id=any(v_ids);
 delete from matchmaker_internal.post_receipts where listing_id=any(v_ids);
 delete from matchmaker_internal.post_outbox where listing_id=any(v_ids);
 delete from matchmaker_internal.squad_listings where id=any(v_ids);
 get diagnostics v_count=row_count;
 if v_count<>cardinality(v_ids) then raise exception 'Listing retention count mismatch'; end if;
 return v_count;
end $retention$;
-- Manual database administrator only; not callable by webhook/service role.
revoke all on function matchmaker_internal.purge_resolved_listings(integer)
 from public,anon,authenticated,service_role;
commit;

-- Requires a reviewed, authenticated, *separately enabled* scheduler.
-- NO deletion is scheduled or executed on the hosted staging project.
