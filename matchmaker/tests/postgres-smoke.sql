\set ON_ERROR_STOP on
-- Ephemeral Postgres 17 only. This script MUST NOT run against hosted Supabase.
-- Test role fixtures mirror Supabase RLS bypass properties, not production credentials.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
\ir ../supabase-schema.review.sql
\ir ../storage-operations.review.sql

DO $$
BEGIN
  IF has_schema_privilege('anon','matchmaker_internal','USAGE') THEN
    RAISE EXCEPTION 'anon may enter private schema';
  END IF;
  IF has_schema_privilege('authenticated','matchmaker_internal','USAGE') THEN
    RAISE EXCEPTION 'authenticated may enter private schema';
  END IF;
  IF NOT (SELECT bool_and(relrowsecurity)
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='matchmaker_internal' AND c.relkind='r') THEN
    RAISE EXCEPTION 'Missing table RLS';
  END IF;
END $$;

SET ROLE service_role;
DO $$
DECLARE
  owner_id text:='1418199180287148073';
  stranger text:='1546529501859815438';
  token uuid;
  next_token uuid;
  listing_id bigint;
  denied boolean;
BEGIN
  token:=matchmaker_internal.prepare_preview(
    owner_id,'Call of Duty','Xbox','Casual','Optional','ET','Saturday evening');
  IF token IS NULL THEN RAISE EXCEPTION 'No token'; END IF;
  denied:=matchmaker_internal.cancel_preview(stranger,token);
  IF denied THEN RAISE EXCEPTION 'Stranger cancelled preview'; END IF;
  BEGIN
    PERFORM matchmaker_internal.confirm_preview(stranger,token);
    RAISE EXCEPTION 'Stolen preview accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Stolen preview accepted' THEN RAISE; END IF;
  END;
  listing_id:=matchmaker_internal.confirm_preview(owner_id,token);
  IF listing_id IS NULL THEN RAISE EXCEPTION 'Listing missing'; END IF;
  BEGIN
    PERFORM matchmaker_internal.confirm_preview(owner_id,token);
    RAISE EXCEPTION 'Reused token accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Reused token accepted' THEN RAISE; END IF;
  END;
  next_token:=matchmaker_internal.prepare_preview(
    owner_id,'Call of Duty','PC','Competitive','No mic','UTC','Tomorrow');
  BEGIN
    PERFORM matchmaker_internal.confirm_preview(owner_id,next_token);
    RAISE EXCEPTION 'Duplicate active listing accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM='Duplicate active listing accepted' THEN RAISE; END IF;
  END;
  IF NOT matchmaker_internal.close_my_listing(owner_id) THEN
    RAISE EXCEPTION 'Owner close failed';
  END IF;
  IF matchmaker_internal.close_my_listing(owner_id) THEN
    RAISE EXCEPTION 'Duplicate owner close accepted';
  END IF;
  IF NOT matchmaker_internal.claim_interaction('1572091972217212969') THEN
    RAISE EXCEPTION 'First interaction not claimed';
  END IF;
  IF matchmaker_internal.claim_interaction('1572091972217212969') THEN
    RAISE EXCEPTION 'Replay accepted';
  END IF;
  denied:=matchmaker_internal.cancel_preview(owner_id,next_token);
  IF NOT denied THEN RAISE EXCEPTION 'Owner cancel failed'; END IF;
  IF matchmaker_internal.cancel_preview(owner_id,next_token) THEN
    RAISE EXCEPTION 'Cancel accepted twice';
  END IF;
END $$;
RESET ROLE;
SELECT 'Postgres private Matchmaker SQL integration checks PASSED' as result;
