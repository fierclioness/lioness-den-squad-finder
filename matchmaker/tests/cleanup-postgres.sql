\set ON_ERROR_STOP on
\ir ../cleanup-outbox.review.sql
SET ROLE service_role;
DO $$
declare
  owner text:='1418199180287148201';
  token uuid; id bigint;
  worker uuid:='11111111-1111-4111-8111-111111111111';
  other uuid:='22222222-2222-4222-8222-222222222222';
begin
 token:=matchmaker_internal.prepare_preview(owner,'Call of Duty','Xbox','Casual','Optional','ET','Saturday');
 id:=matchmaker_internal.confirm_preview(owner,token);
 if matchmaker_internal.queue_cleanup(id,'1546529497925296199','1546529501859815438')
 then raise exception 'Cleanup queued for active, unposted listing'; end if;
 if not matchmaker_internal.enqueue_post(id) then raise exception 'Enqueue failed'; end if;
 if matchmaker_internal.claim_post(worker) is distinct from id then raise exception 'Claim failed'; end if;
 if not matchmaker_internal.finish_post(id,worker,'1546529501859815440')
 then raise exception 'Finish failed'; end if;
 if matchmaker_internal.queue_cleanup(id,'1546529497925296199','1546529501859815438')
 then raise exception 'Cleanup queued for active listing'; end if;
 if not matchmaker_internal.close_my_listing(owner) then raise exception 'Close failed'; end if;
 if not matchmaker_internal.queue_cleanup(id,'1546529497925296199','1546529501859815438')
 then raise exception 'Cleanup enqueue failed'; end if;
 if matchmaker_internal.queue_cleanup(id,'1546529497925296199','1546529501859815438')
 then raise exception 'Duplicate cleanup enqueue accepted'; end if;
 if matchmaker_internal.claim_cleanup(worker) is distinct from id then raise exception 'Cleanup claim failed'; end if;
 if matchmaker_internal.claim_cleanup(other) is not null then raise exception 'Double claim'; end if;
 if matchmaker_internal.finish_cleanup(id,other,true) then raise exception 'Foreign worker completion'; end if;
 if not matchmaker_internal.finish_cleanup(id,worker,false) then raise exception 'Uncertain completion failed'; end if;
 if (select state from matchmaker_internal.cleanup_outbox where listing_id=id)<>'uncertain'
 then raise exception 'Uncertain cleanup not quarantined'; end if;
 if matchmaker_internal.claim_cleanup(worker) is not null then raise exception 'Uncertain cleanup retried'; end if;
end $$;
RESET ROLE;
SELECT 'Durable cleanup queue checks PASSED' AS result;
