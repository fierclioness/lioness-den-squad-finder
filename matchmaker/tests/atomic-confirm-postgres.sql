\set ON_ERROR_STOP on
\ir ../atomic-confirm.review.sql
SET ROLE service_role;
DO $$
declare
 owner1 text:='1418199180287148460';
 owner2 text:='1418199180287148461';
 token1 uuid; token2 uuid; id1 bigint; outbox_count integer;
begin
 token1:=matchmaker_internal.prepare_preview(owner1,'COD','Xbox','Casual','Optional','ET','Saturday');
 id1:=matchmaker_internal.confirm_and_enqueue(owner1,token1);
 if id1 is null then raise exception 'Confirmation returned no listing'; end if;
 if (select count(*) from matchmaker_internal.post_outbox where listing_id=id1 and state='pending')<>1
 then raise exception 'Confirmation was not atomically enqueued'; end if;
 begin
   perform matchmaker_internal.confirm_and_enqueue(owner1,token1);
   raise exception 'Duplicate confirmation should have failed';
 exception when others then
   if sqlerrm='Duplicate confirmation should have failed' then raise; end if;
 end;
 if (select count(*) from matchmaker_internal.post_outbox where listing_id=id1)<>1
 then raise exception 'Duplicate outbox row appeared'; end if;

 -- Force a *test-only* insert failure. Since the RPC is a single DB
 -- transaction, the listing and preview consumption must BOTH roll back.
 token2:=matchmaker_internal.prepare_preview(owner2,'COD','PC','Casual','Optional','ET','Saturday');
 create temporary table ephemeral_failure_probe(note text) on commit drop;
 -- No permanent triggers / schema objects are used for failure injection.
 -- Create a temporary function in pg_temp to intercept insert and fail.
 execute $ddl$
   create function pg_temp.reject_enqueue()
   returns trigger language plpgsql as $fn$
   begin
     if exists(select 1 from matchmaker_internal.squad_listings
       where id=new.listing_id and owner_discord_id='1418199180287148461')
     then raise exception 'Test-only enqueue failure'; end if;
     return new;
   end $fn$ $ddl$;
 execute 'create trigger test_reject_confirm_enqueue before insert on matchmaker_internal.post_outbox for each row execute function pg_temp.reject_enqueue()';
 begin
   perform matchmaker_internal.confirm_and_enqueue(owner2,token2);
   raise exception 'Expected injected outbox insert failure';
 exception when others then
   if sqlerrm<>'Test-only enqueue failure' then raise; end if;
 end;
 execute 'drop trigger test_reject_confirm_enqueue on matchmaker_internal.post_outbox';
 if exists(select 1 from matchmaker_internal.squad_listings where owner_discord_id=owner2)
 then raise exception 'Orphaned confirmed listing after enqueue failed'; end if;
 if not exists(select 1 from matchmaker_internal.pending_previews
    where token=token2 and consumed_at is null)
 then raise exception 'Preview was consumed despite failed enqueue'; end if;
 -- Retry after the test-only failure is cleared: exactly one listing + queue.
 perform matchmaker_internal.confirm_and_enqueue(owner2,token2);
 select count(*) into outbox_count from matchmaker_internal.post_outbox o
 join matchmaker_internal.squad_listings s on s.id=o.listing_id
 where s.owner_discord_id=owner2;
 if outbox_count<>1 then raise exception 'Retry did not atomically enqueue'; end if;
end $$;
RESET ROLE;
SELECT 'Atomic confirmation, rollback, retry, and no-orphan checks PASSED' as result;
