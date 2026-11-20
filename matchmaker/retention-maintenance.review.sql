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
commit;

-- Requires a reviewed, authenticated, *separately enabled* scheduler.
-- NO deletion is scheduled or executed on the hosted staging project.
