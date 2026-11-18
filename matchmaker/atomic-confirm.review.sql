-- REVIEW ONLY. Disposable PostgreSQL CI; NOT applied to production Supabase.
-- Requires storage-operations.review.sql and post-outbox.review.sql.
-- A successful preview confirmation and outbox insertion commit atomically.
-- A failed enqueue raises and rolls back the listing and consumed preview.
begin;
create or replace function matchmaker_internal.confirm_and_enqueue(
 p_owner text,p_token uuid
) returns bigint
language plpgsql security invoker set search_path='' as $$
declare v_id bigint; v_inserted bigint;
begin
 -- This existing function implements owner binding, replay prevention,
 -- expiry, one-active-listing and 60-second member cooldown checks.
 v_id:=matchmaker_internal.confirm_preview(p_owner,p_token);
 -- STRICT: never return a successful confirmation unless it is queued.
 insert into matchmaker_internal.post_outbox (listing_id)
 values (v_id) returning listing_id into v_inserted;
 if v_inserted is distinct from v_id then
   raise exception 'Failed to queue confirmed listing';
 end if;
 return v_id;
end $$;
revoke all on function matchmaker_internal.confirm_and_enqueue(text,uuid)
 from public,anon,authenticated;
grant execute on function matchmaker_internal.confirm_and_enqueue(text,uuid) to service_role;
commit;

-- There is still NO real Discord post here. The separate publishing worker
-- remains disabled by default, and uncertain deliveries never auto-retry.
