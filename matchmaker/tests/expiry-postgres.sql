\set ON_ERROR_STOP on
-- Disposable PostgreSQL 17 only. NEVER against hosted projects.
\ir ../expiry-outbox.review.sql
-- Persist the function definition but roll back all synthetic expiry fixtures.
-- This prevents future disposable integration tests from claiming test jobs.
BEGIN;
SET ROLE service_role;
DO $$
declare
 posted_id bigint; pending_id bigint; sending_id bigint; live_id bigint;
 worker uuid:='66666666-6666-4666-8666-666666666666';
 ch text:='1546529497925296199'; bot text:='1546529501859815438';
 msg1 text:='1546529501859815481'; msg2 text:='1546529501859815482';
begin
 -- Synthetic opt-in listings only, with no real member data.
 insert into matchmaker_internal.squad_listings
 (owner_discord_id,game,platform,vibe,mic,timezone,availability,created_at,expires_at)
 values ('1418199180287148491','COD','Xbox','Casual','Optional','ET','Weekend',
  clock_timestamp()-interval '40 hours',clock_timestamp()-interval '4 hours')
 returning id into posted_id;
 insert into matchmaker_internal.post_outbox(listing_id,state,posted_message_id)
 values(posted_id,'posted',msg1);
 insert into matchmaker_internal.post_receipts
 (listing_id,discord_message_id,channel_id,bot_user_id)
 values(posted_id,msg1,ch,bot);
 insert into matchmaker_internal.squad_listings
 (owner_discord_id,game,platform,vibe,mic,timezone,availability,created_at,expires_at)
 values ('1418199180287148492','COD','Xbox','Casual','Optional','ET','Weekend',
  clock_timestamp()-interval '39 hours',clock_timestamp()-interval '3 hours')
 returning id into pending_id;
 insert into matchmaker_internal.post_outbox(listing_id,state)
 values(pending_id,'pending');
 insert into matchmaker_internal.squad_listings
 (owner_discord_id,game,platform,vibe,mic,timezone,availability,created_at,expires_at)
 values ('1418199180287148493','COD','Xbox','Casual','Optional','ET','Weekend',
  clock_timestamp()-interval '38 hours',clock_timestamp()-interval '2 hours')
 returning id into sending_id;
 insert into matchmaker_internal.post_outbox
 (listing_id,state,claimed_by,claimed_at,attempts)
 values(sending_id,'sending',worker,clock_timestamp(),1);
 insert into matchmaker_internal.squad_listings
 (owner_discord_id,game,platform,vibe,mic,timezone,availability,created_at,expires_at)
 values ('1418199180287148494','COD','Xbox','Casual','Optional','ET','Weekend',
  clock_timestamp(),clock_timestamp()+interval '36 hours')
 returning id into live_id;
 insert into matchmaker_internal.post_outbox(listing_id,state)
 values(live_id,'pending');

 if matchmaker_internal.expire_due_listings(2)<>2
 then raise exception 'Bounded expiry did not process exactly 2'; end if;
 if (select status from matchmaker_internal.squad_listings where id=posted_id)<>'expired' or
    (select status from matchmaker_internal.squad_listings where id=pending_id)<>'expired' or
    (select status from matchmaker_internal.squad_listings where id=sending_id)<>'active'
 then raise exception 'First bounded batch wrong ordering/state'; end if;
 if (select state from matchmaker_internal.post_outbox where listing_id=pending_id)<>'cancelled'
 then raise exception 'Expired pending post was not cancelled'; end if;
 if (select state from matchmaker_internal.cleanup_outbox where listing_id=posted_id)<>'pending'
 then raise exception 'Verified posted listing did not queue cleanup'; end if;
 if exists(select 1 from matchmaker_internal.cleanup_outbox where listing_id=pending_id)
 then raise exception 'Unposted listing generated unsafe cleanup'; end if;

 if matchmaker_internal.expire_due_listings(2)<>1
 then raise exception 'Second expiry batch did not process remaining listing'; end if;
 if (select status from matchmaker_internal.squad_listings where id=sending_id)<>'expired' or
    (select state from matchmaker_internal.post_outbox where listing_id=sending_id)<>'sending'
 then raise exception 'Expired in-flight send incorrectly changed'; end if;
 if exists(select 1 from matchmaker_internal.cleanup_outbox where listing_id=sending_id)
 then raise exception 'Invented cleanup for unknown send'; end if;
 if (select status from matchmaker_internal.squad_listings where id=live_id)<>'active' or
    (select state from matchmaker_internal.post_outbox where listing_id=live_id)<>'pending'
 then raise exception 'Unexpired active request was modified'; end if;
 if matchmaker_internal.expire_due_listings(2)<>0
 then raise exception 'Expiry was not idempotent'; end if;

 -- Late, verified Discord receipt for in-flight expired post must queue cleanup.
 if matchmaker_internal.finish_post_with_receipt(sending_id,worker,msg2,ch,bot)<>'posted_cleanup_queued'
 then raise exception 'Late receipt after expiry did not queue cleanup'; end if;
 if (select state from matchmaker_internal.cleanup_outbox where listing_id=sending_id)<>'pending'
 then raise exception 'Missing late-receipt cleanup'; end if;

 -- Refuse invalid scheduler batch parameters.
 begin
  perform matchmaker_internal.expire_due_listings(501);
  raise exception 'Oversized batch accepted';
 exception when others then
  if sqlerrm='Oversized batch accepted' then raise; end if;
 end;
end $$;
RESET ROLE;
ROLLBACK;
SELECT 'Bounded expiry, confirmed cleanup, unsent cancellation and late receipt PASSED (fixture rolled back)' as result;
