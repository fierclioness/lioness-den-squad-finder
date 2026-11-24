-- Ephemeral Postgres only, run AFTER matchmaker/tests/postgres-smoke.sql.
\set ON_ERROR_STOP on
\ir ../post-outbox.review.sql
SET ROLE service_role;
DO $$
declare
 member_id text:='1418199180287148073';
 token uuid; id bigint; got bigint; worker1 uuid:='11111111-1111-4111-8111-111111111111';
 worker2 uuid:='22222222-2222-4222-8222-222222222222';
begin
 -- Earlier smoke script leaves a closed listing, so create fresh preview and
 -- move its creation timestamp back 61s (only in disposable test database).
 update matchmaker_internal.squad_listings set created_at=clock_timestamp()-interval '70 seconds'
 where owner_discord_id=member_id;
 token:=matchmaker_internal.prepare_preview(member_id,'Call of Duty','Xbox','Casual','Optional','ET','Sunday');
 id:=matchmaker_internal.confirm_preview(member_id,token);
 if not matchmaker_internal.enqueue_post(id) then raise exception 'Initial enqueue failed'; end if;
 if matchmaker_internal.enqueue_post(id) then raise exception 'Duplicate enqueue succeeded'; end if;
 got:=matchmaker_internal.claim_post(worker1);
 if got is distinct from id then raise exception 'Claim failed'; end if;
 if matchmaker_internal.claim_post(worker2) is not null then raise exception 'Double claim succeeded'; end if;
 if matchmaker_internal.finish_post(id,worker2,'1546529501859815438')
 then raise exception 'Foreign worker completed post'; end if;
 if matchmaker_internal.cancel_unposted(id) then raise exception 'Cancelled sending post'; end if;
 if not matchmaker_internal.fail_post(id,worker1,false,'timeout')
 then raise exception 'Timeout quarantine failed'; end if;
 if (select state from matchmaker_internal.post_outbox where listing_id=id)<>'uncertain'
 then raise exception 'Timeout did not enter uncertain state'; end if;
 if matchmaker_internal.claim_post(worker2) is not null
 then raise exception 'Uncertain post was retried'; end if;
end $$;
RESET ROLE;
SELECT 'Post outbox SQL integration passed in disposable database' AS result;
