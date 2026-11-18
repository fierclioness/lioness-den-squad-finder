\set ON_ERROR_STOP on
\ir ../manual-reconciliation.review.sql
SET ROLE service_role;
DO $$
declare
 member text:='1418199180287148330';
 member2 text:='1418199180287148331';
 token uuid; id bigint; other bigint; worker uuid:='11111111-1111-4111-8111-111111111111';
 outcome text;
begin
 token:=matchmaker_internal.prepare_preview(member,'COD','Xbox','Casual','Optional','ET','Friday');
 id:=matchmaker_internal.confirm_preview(member,token);
 perform matchmaker_internal.enqueue_post(id);
 if matchmaker_internal.claim_post(worker) is distinct from id then raise exception 'Claim failed'; end if;
 perform matchmaker_internal.fail_post(id,worker,false,'Network timeout: result unknown');
 if not matchmaker_internal.close_with_post_guard(member)='not_active'
 then -- close still returns closed_delivery_unresolved or closed_without_post
   null;
 end if;
 outcome:=matchmaker_internal.record_manual_receipt(id,'1546529501859815501',
   '1546529497925296199','1546529501859815438','ops-ticket-117',
   'Operator verified exact original Discord bot-owned message');
 if outcome<>'receipt_recorded_cleanup_queued' then raise exception 'Expected cleanup queue, got %',outcome; end if;
 if (select count(*) from matchmaker_internal.cleanup_outbox where listing_id=id)<>1
 then raise exception 'Expected exactly one cleanup request'; end if;
 if (select count(*) from matchmaker_internal.reconciliation_audit where listing_id=id)<>1
 then raise exception 'Expected one audit record'; end if;
 begin
   perform matchmaker_internal.record_manual_receipt(id,'1546529501859815501',
     '1546529497925296199','1546529501859815438','ops-ticket-117',
     'Repeated operator action should not succeed');
   raise exception 'Duplicate reconciliation should have failed';
 exception when others then
   if sqlerrm='Duplicate reconciliation should have failed' then raise; end if;
 end;
 token:=matchmaker_internal.prepare_preview(member2,'COD','Xbox','Casual','Optional','ET','Friday');
 other:=matchmaker_internal.confirm_preview(member2,token);
 perform matchmaker_internal.enqueue_post(other);
 if matchmaker_internal.claim_post(worker) is distinct from other then raise exception 'Second claim failed'; end if;
 perform matchmaker_internal.fail_post(other,worker,false,'Response lost');
 if (select state from matchmaker_internal.post_outbox where listing_id=other)<>'uncertain'
 then raise exception 'Unknown delivery was automatically resolved'; end if;
end $$;
RESET ROLE;
SELECT 'Manual receipt audit and no-blind-retry passed' AS result;
