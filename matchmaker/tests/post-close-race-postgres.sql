\set ON_ERROR_STOP on
\ir ../post-close-race.review.sql
SET ROLE service_role;
DO $$
declare
 p text:='1418199180287148209';
 p2 text:='1418199180287148210';
 p3 text:='1418199180287148211';
 t uuid; id bigint; id2 bigint; id3 bigint;
 w uuid:='11111111-1111-4111-8111-111111111111';
 chan text:='1546529497925296199';
 bot text:='1546529501859815438';
 status text;
begin
 -- Case 1: close before worker starts => no claim and no public message.
 t:=matchmaker_internal.prepare_preview(p,'COD','Xbox','Casual','Optional','ET','Sunday');
 id:=matchmaker_internal.confirm_preview(p,t);
 perform matchmaker_internal.enqueue_post(id);
 status:=matchmaker_internal.close_with_post_guard(p);
 if status<>'closed_without_post' then raise exception 'Pending close status incorrect: %',status; end if;
 if (select state from matchmaker_internal.post_outbox where listing_id=id)<>'cancelled'
 then raise exception 'Pending post not cancelled'; end if;
 if matchmaker_internal.claim_post(w) is not null then raise exception 'Closed post was claimable'; end if;

 -- Case 2: worker holds sending claim, owner closes; late successful Discord
 -- receipt must be preserved and cleanup queued in same DB txn.
 t:=matchmaker_internal.prepare_preview(p2,'COD','Xbox','Casual','Optional','ET','Sunday');
 id2:=matchmaker_internal.confirm_preview(p2,t);
 perform matchmaker_internal.enqueue_post(id2);
 if matchmaker_internal.claim_post(w) is distinct from id2 then raise exception 'Claim failed'; end if;
 status:=matchmaker_internal.close_with_post_guard(p2);
 if status<>'closed_delivery_unresolved' then raise exception 'In-flight close incorrect: %',status; end if;
 status:=matchmaker_internal.finish_post_with_receipt(id2,w,'1546529501859815445',chan,bot);
 if status<>'posted_cleanup_queued' then raise exception 'Late receipt not quarantined for removal: %',status; end if;
 if (select state from matchmaker_internal.cleanup_outbox where listing_id=id2)<>'pending'
 then raise exception 'Cleanup job not queued atomically'; end if;
 if (select count(*) from matchmaker_internal.post_receipts where listing_id=id2)<>1
 then raise exception 'Missing durable original post receipt'; end if;

 -- Case 3: confirmed posting first, subsequent close queues cleanup.
 t:=matchmaker_internal.prepare_preview(p3,'COD','Xbox','Casual','Optional','ET','Sunday');
 id3:=matchmaker_internal.confirm_preview(p3,t);
 perform matchmaker_internal.enqueue_post(id3);
 if matchmaker_internal.claim_post(w) is distinct from id3 then raise exception 'Second claim failed'; end if;
 status:=matchmaker_internal.finish_post_with_receipt(id3,w,'1546529501859815446',chan,bot);
 if status<>'posted_active' then raise exception 'Unexpected active receipt state'; end if;
 status:=matchmaker_internal.close_with_post_guard(p3);
 if status<>'closed_cleanup_queued' then raise exception 'Close failed to queue cleanup'; end if;
 if (select count(*) from matchmaker_internal.cleanup_outbox where listing_id=id3)<>1
 then raise exception 'Duplicate or missing cleanup'; end if;
 if matchmaker_internal.close_with_post_guard(p3)<>'not_active'
 then raise exception 'Duplicate close changed state'; end if;
end $$;
RESET ROLE;
SELECT 'Close/post receipt coordination PASSED on disposable Postgres' as result;
