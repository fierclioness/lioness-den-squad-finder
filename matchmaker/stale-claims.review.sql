-- REVIEW ONLY. This is NOT installed in live Supabase.
-- Safe quarantine of abandoned claims. A timed-out Discord HTTP request may
-- have succeeded: no "sending" or "claimed" job is automatically re-queued.
begin;
create or replace function matchmaker_internal.quarantine_stale_post_claims(
 p_min_age interval default interval '10 minutes', p_max_rows integer default 100
) returns integer language plpgsql security invoker set search_path='' as $$
declare v_count integer;
begin
 if p_min_age is null or p_min_age < interval '5 minutes'
    or p_min_age > interval '7 days'
    or p_max_rows is null or p_max_rows < 1 or p_max_rows > 500
 then raise exception 'Invalid quarantine limits'; end if;
 with stale as (
  select listing_id from matchmaker_internal.post_outbox
  where state='sending' and claimed_at < clock_timestamp()-p_min_age
  order by claimed_at,listing_id for update skip locked limit p_max_rows
 )
 update matchmaker_internal.post_outbox o
 set state='uncertain',claimed_by=null,claimed_at=null,
     last_error='Worker lease expired; Discord delivery unknown. Manual reconciliation required',
     updated_at=clock_timestamp()
 from stale where o.listing_id=stale.listing_id;
 get diagnostics v_count=row_count;
 return v_count;
end $$;

create or replace function matchmaker_internal.quarantine_stale_cleanup_claims(
 p_min_age interval default interval '10 minutes', p_max_rows integer default 100
) returns integer language plpgsql security invoker set search_path='' as $$
declare v_count integer;
begin
 if p_min_age is null or p_min_age < interval '5 minutes'
    or p_min_age > interval '7 days'
    or p_max_rows is null or p_max_rows < 1 or p_max_rows > 500
 then raise exception 'Invalid quarantine limits'; end if;
 -- cleanup_outbox has updated_at rather than claimed_at. On claim it is set.
 -- A crash might have deleted the Discord message: never blindly delete again.
 with stale as (
  select listing_id from matchmaker_internal.cleanup_outbox
  where state='claimed' and updated_at < clock_timestamp()-p_min_age
  order by updated_at,listing_id for update skip locked limit p_max_rows
 )
 update matchmaker_internal.cleanup_outbox o
 set state='uncertain',claimed_by=null,updated_at=clock_timestamp()
 from stale where o.listing_id=stale.listing_id;
 get diagnostics v_count=row_count;
 return v_count;
end $$;
revoke all on function matchmaker_internal.quarantine_stale_post_claims(interval,integer)
 from public,anon,authenticated;
revoke all on function matchmaker_internal.quarantine_stale_cleanup_claims(interval,integer)
 from public,anon,authenticated;
grant execute on function matchmaker_internal.quarantine_stale_post_claims(interval,integer) to service_role;
grant execute on function matchmaker_internal.quarantine_stale_cleanup_claims(interval,integer) to service_role;
commit;
-- Do not schedule or execute on the user's project without separate approval.
-- These functions do NOT perform Discord network calls or retry uncertain rows.
