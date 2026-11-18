\set ON_ERROR_STOP on
\ir ../stale-claims.review.sql
SET ROLE service_role;
DO $$
declare
 owner1 text:='1418199180287148510';
 owner2 text:='1418199180287148511';
 token uuid; post_id bigint; active_id bigint;
 worker1 uuid:='11111111-1111-4111-8111-111111111111';
 worker2 uuid:='22222222-2222-4222-8222-222222222222';
 changed integer; cleanup_id bigint;
begin
 -- An abandoned in-flight post cannot be proven unsent: quarantine.
 token:=matchmaker_internal.prepare_preview(owner1,'COD','PC','Casual','Optional','ET','Sunday');
 post_id:=matchmaker_internal.confirm_and_enqueue(owner1,token);
 if matchmaker_internal.claim_post(worker1) is distinct from post_id
 then raise exception 'Failed to claim fixture post'; end if;
 update matchmaker_internal.post_outbox
 set claimed_at=clock_timestamp()-interval '12 minutes'
 where listing_id=post_id;
 select matchmaker_internal.quarantine_stale_post_claims() into changed;
 if changed<>1 then raise exception 'Stale post was not quarantined'; end if;
 if (select state from matchmaker_internal.post_outbox where listing_id=post_id)<>'uncertain'
 then raise exception 'Abandoned post not uncertain'; end if;
 if matchmaker_internal.claim_post(worker2) is not null
 then raise exception 'Quarantined post automatically retried'; end if;
 if matchmaker_internal.finish_post(post_id,worker1,'1546529501859815438')
 then raise exception 'Expired worker claim could finish'; end if;
 if matchmaker_internal.quarantine_stale_post_claims()<>0
 then raise exception 'Quarantine operation not idempotent'; end if;

 -- Fresh claims stay claimed.
 token:=matchmaker_internal.prepare_preview(owner2,'COD','Xbox','Casual','Optional','ET','Sunday');
 active_id:=matchmaker_internal.confirm_and_enqueue(owner2,token);
 if matchmaker_internal.claim_post(worker2) is distinct from active_id
 then raise exception 'Cannot claim fresh job'; end if;
 if matchmaker_internal.quarantine_stale_post_claims()<>0
 then raise exception 'Fresh post wrongly quarantined'; end if;
 if (select state from matchmaker_internal.post_outbox where listing_id=active_id)<>'sending'
 then raise exception 'Fresh worker lost claim'; end if;
 -- Quarantine the fresh claim intentionally before leaving disposable tests.
 update matchmaker_internal.post_outbox
 set claimed_at=clock_timestamp()-interval '12 minutes' where listing_id=active_id;
 perform matchmaker_internal.quarantine_stale_post_claims();

 -- A deleted-but-unacknowledged cleanup must not auto-delete twice.
 -- Existing earlier test created a posted, closed listing with a cleanup job.
 select listing_id into cleanup_id from matchmaker_internal.cleanup_outbox
 where state='pending' order by listing_id limit 1;
 if cleanup_id is null then raise exception 'Missing prior cleanup fixture'; end if;
 if matchmaker_internal.claim_cleanup(worker1) is distinct from cleanup_id
 then raise exception 'Cleanup claim failed'; end if;
 update matchmaker_internal.cleanup_outbox
 set updated_at=clock_timestamp()-interval '12 minutes'
 where listing_id=cleanup_id;
 if matchmaker_internal.quarantine_stale_cleanup_claims()<>1
 then raise exception 'Stale cleanup not quarantined'; end if;
 if (select state from matchmaker_internal.cleanup_outbox where listing_id=cleanup_id)<>'uncertain'
 then raise exception 'Cleanup uncertainty missing'; end if;
 if matchmaker_internal.finish_cleanup(cleanup_id,worker1,true)
 then raise exception 'Expired cleanup owner could mark success'; end if;
 if matchmaker_internal.claim_cleanup(worker2) is not null
 then raise exception 'Quarantined cleanup automatically retried'; end if;
 if matchmaker_internal.quarantine_stale_cleanup_claims()<>0
 then raise exception 'Cleanup quarantine not idempotent'; end if;

 -- Invalid intervals and excessive batches must reject.
 begin
   perform matchmaker_internal.quarantine_stale_post_claims(interval '1 second',100);
   raise exception 'Unsafe too-short threshold accepted';
 exception when others then
   if sqlerrm='Unsafe too-short threshold accepted' then raise; end if;
 end;
 begin
   perform matchmaker_internal.quarantine_stale_cleanup_claims(interval '10 minutes',9999);
   raise exception 'Unbounded cleanup batch accepted';
 exception when others then
   if sqlerrm='Unbounded cleanup batch accepted' then raise; end if;
 end;
end $$;
RESET ROLE;
SELECT 'Stale claim quarantine and no-duplicate-retry PASSED' AS result;
