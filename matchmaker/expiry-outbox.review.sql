-- REVIEW ONLY: disposable PostgreSQL CI, NOT production/staging migration.
-- Called only by an authenticated server-only scheduler after approval.
-- Expires due opt-in listings in bounded batches, cancels unsent post jobs,
-- and atomically queues cleanup only for verified original bot receipts.
-- In-flight/uncertain delivery remains untouched: the posting receipt path
-- or manual reconciliation must handle that ambiguity. NO Discord calls.
begin;
create or replace function matchmaker_internal.expire_due_listings(p_max_rows integer default 100)
returns integer language plpgsql security invoker set search_path='' as $$
declare v_ids bigint[]; v_count integer;
begin
 if p_max_rows is null or p_max_rows < 1 or p_max_rows > 500
 then raise exception 'Invalid expiry batch limit'; end if;

 -- Lock listing rows in stable order, skipping in-flight transactions.
 -- finish_post_with_receipt takes the SAME listing lock first, ensuring
 -- an expiry-vs-post race always queues a cleanup once a receipt exists.
 with due as (
  select id from matchmaker_internal.squad_listings
   where status='active' and expires_at<=clock_timestamp()
   order by expires_at,id for update skip locked limit p_max_rows
 ), expired as (
  update matchmaker_internal.squad_listings s set status='expired'
    from due where s.id=due.id returning s.id
 )
 select coalesce(array_agg(id),array[]::bigint[]) into v_ids from expired;
 v_count:=cardinality(v_ids);
 if v_count=0 then return 0; end if;

 -- Once expired, pending/definitively failed posts cannot be published.
 update matchmaker_internal.post_outbox
 set state='cancelled',updated_at=clock_timestamp()
 where listing_id=any(v_ids) and state in ('pending','failed');

 -- Only trusted original bot-owned receipts justify a cleanup job.
 insert into matchmaker_internal.cleanup_outbox
  (listing_id,message_id,channel_id,bot_user_id)
 select r.listing_id,r.discord_message_id,r.channel_id,r.bot_user_id
 from matchmaker_internal.post_receipts r
 join matchmaker_internal.post_outbox o on o.listing_id=r.listing_id
 where r.listing_id=any(v_ids) and o.state='posted'
 on conflict(listing_id) do nothing;

 return v_count;
end $$;
revoke all on function matchmaker_internal.expire_due_listings(integer)
 from public,anon,authenticated;
grant execute on function matchmaker_internal.expire_due_listings(integer) to service_role;
commit;

-- The scheduler is NOT installed; expiry is never automatically executed.
-- Missing post receipts and uncertain sends still require operator review.
