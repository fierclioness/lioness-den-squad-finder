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
