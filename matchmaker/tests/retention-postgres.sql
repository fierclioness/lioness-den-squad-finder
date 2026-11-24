\set ON_ERROR_STOP on
-- Run ONLY after postgres-smoke.sql has created a disposable matchmaker schema.
-- All fixture writes are rolled back; NO hosted projects or Discord touched.
\ir ../retention-maintenance.review.sql
begin;
do $$
begin
 if has_function_privilege('anon',
   'matchmaker_internal.purge_expired_transient_rows(integer)','EXECUTE')
   or has_function_privilege('authenticated',
   'matchmaker_internal.purge_expired_transient_rows(integer)','EXECUTE')
 then raise exception 'Public retention maintenance grant detected'; end if;
 if not has_function_privilege('service_role',
   'matchmaker_internal.purge_expired_transient_rows(integer)','EXECUTE')
 then raise exception 'Private retention executor not authorized'; end if;
end $$;
set role service_role;
insert into matchmaker_internal.discord_interaction_replays
 (interaction_id,received_at,expires_at) values
 ('1572091972217212001',clock_timestamp()-interval '30 minutes',clock_timestamp()-interval '20 minutes'),
 ('1572091972217212002',clock_timestamp()-interval '28 minutes',clock_timestamp()-interval '18 minutes'),
 ('1572091972217212003',clock_timestamp()-interval '12 minutes',clock_timestamp()-interval '2 minutes'),
 ('1572091972217212004',clock_timestamp(),clock_timestamp()+interval '10 minutes');
insert into matchmaker_internal.pending_previews
 (token,owner_discord_id,game,platform,vibe,mic,timezone,availability,created_at,expires_at) values
 ('10000000-0000-4000-8000-000000000001','1418199180287148073','Call of Duty','Xbox','Casual','Optional','ET','Weekend',clock_timestamp()-interval '30 minutes',clock_timestamp()-interval '20 minutes'),
 ('10000000-0000-4000-8000-000000000002','1418199180287148073','Call of Duty','Xbox','Casual','Optional','ET','Weekend',clock_timestamp()-interval '28 minutes',clock_timestamp()-interval '18 minutes'),
 ('10000000-0000-4000-8000-000000000003','1418199180287148073','Call of Duty','Xbox','Casual','Optional','ET','Weekend',clock_timestamp()-interval '12 minutes',clock_timestamp()-interval '2 minutes'),
 ('10000000-0000-4000-8000-000000000004','1418199180287148073','Call of Duty','Xbox','Casual','Optional','ET','Weekend',clock_timestamp(),clock_timestamp()+interval '10 minutes');
do $$
declare result record; v_count integer; v_retained integer;
begin
 for v_count in 1..2 loop
   select * into result from matchmaker_internal.purge_expired_transient_rows(1);
   if result.replays_purged<>1 or result.previews_purged<>1
   then raise exception 'Retention batch exceeded limit or missed eligible row'; end if;
 end loop;
 select * into result from matchmaker_internal.purge_expired_transient_rows(1);
 if result.replays_purged<>0 or result.previews_purged<>0
 then raise exception 'Retention deleted an unexpired/guarded row'; end if;
 select count(*) into v_retained from matchmaker_internal.discord_interaction_replays
 where interaction_id in ('1572091972217212003','1572091972217212004');
 if v_retained<>2 then raise exception 'Fresh or safety-window replay was deleted'; end if;
 select count(*) into v_retained from matchmaker_internal.pending_previews
 where token in ('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000004');
 if v_retained<>2 then raise exception 'Fresh or safety-window preview was deleted'; end if;
 -- A replay still inside the guard interval remains unusable as a fresh ID.
 if matchmaker_internal.claim_interaction('1572091972217212003')
 then raise exception 'Safety-window duplicate interaction accepted'; end if;
 for v_count in 1..3 loop
  begin
   perform * from matchmaker_internal.purge_expired_transient_rows(
      case v_count when 1 then 0 when 2 then 501 else null end);
   raise exception 'Unsafe retention batch accepted';
  exception when raise_exception then
   if SQLERRM='Unsafe retention batch accepted' then raise; end if;
   if SQLERRM<>'Invalid transient retention batch limit' then raise; end if;
  end;
 end loop;
end $$;
reset role;
rollback;
select 'Disposable transient retention, replay guard and privilege tests PASSED' as result;

-- Manual-only listing retention: all synthetic fixtures are rolled back.
begin;
do $$
declare ids bigint[]; item bigint; i integer;
begin
 if has_function_privilege('anon','matchmaker_internal.purge_resolved_listings(integer)','EXECUTE')
 or has_function_privilege('authenticated','matchmaker_internal.purge_resolved_listings(integer)','EXECUTE')
 or has_function_privilege('service_role','matchmaker_internal.purge_resolved_listings(integer)','EXECUTE')
 then raise exception 'Unexpected listing-retention grant'; end if;
 for i in 1..6 loop
  insert into matchmaker_internal.squad_listings
   (owner_discord_id,game,platform,vibe,mic,timezone,availability,status,created_at,expires_at,closed_at)
  values ('15720919722172130'||i::text,'Synthetic','Xbox','Casual','Optional','ET','Weekend',
   case when i=6 then 'active' else 'closed' end,
   clock_timestamp()-interval '100 hours',
   case when i=6 then clock_timestamp()+interval '1 hour' else clock_timestamp()-interval '50 hours' end,
   case when i=6 then null else clock_timestamp()-interval '49 hours' end)
   returning id into item;
  ids:=array_append(ids,item);
 end loop;
 -- 1 private/no job; 2 cancelled/no receipt; 3 posted + verified absent;
 -- 4 uncertain; 5 posted but still awaiting manual removal; 6 live.
 insert into matchmaker_internal.post_outbox(listing_id,state,posted_message_id)
 values(ids[2],'cancelled',null),(ids[3],'posted','1572091972217214003'),
 (ids[4],'uncertain',null),(ids[5],'posted','1572091972217214005');
 insert into matchmaker_internal.post_receipts(listing_id,discord_message_id,channel_id,bot_user_id)
 values(ids[3],'1572091972217214003','1572091972217215001','1572091972217215002'),
 (ids[5],'1572091972217214005','1572091972217215001','1572091972217215002');
 insert into matchmaker_internal.cleanup_outbox(listing_id,message_id,channel_id,bot_user_id,state)
 values(ids[3],'1572091972217214003','1572091972217215001','1572091972217215002','done'),
 (ids[5],'1572091972217214005','1572091972217215001','1572091972217215002','pending');
 if matchmaker_internal.purge_resolved_listings(2)<>2 then raise exception 'Bounded listing purge failed'; end if;
 if matchmaker_internal.purge_resolved_listings(2)<>1 then raise exception 'Resolved listing purge incomplete'; end if;
 if exists(select 1 from matchmaker_internal.squad_listings where id=any(ids[1:3]))
 or (select count(*) from matchmaker_internal.squad_listings where id=any(ids[4:6]))<>3
 then raise exception 'Listing retention removed protected rows or retained resolved rows'; end if;
 if matchmaker_internal.purge_resolved_listings(2)<>0 then raise exception 'Unsafe or non-idempotent listing retention'; end if;
end $$;
rollback;
select 'Manual resolved listing retention and delivery evidence protection PASSED' as result;
