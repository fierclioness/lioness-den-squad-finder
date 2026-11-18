\set ON_ERROR_STOP on
\ir ../listing-reference.review.sql
SET ROLE service_role;
DO $$
declare a text:='1418199180287148340'; b text:='1418199180287148341';
 token uuid; x bigint; y bigint; ref1 uuid; ref2 uuid;
begin
 token:=matchmaker_internal.prepare_preview(a,'COD','Xbox','Casual','Optional','ET','Weekend');
 x:=matchmaker_internal.confirm_preview(a,token);
 token:=matchmaker_internal.prepare_preview(b,'COD','PC','Casual','Optional','ET','Weekend');
 y:=matchmaker_internal.confirm_preview(b,token);
 select post_reference into ref1 from matchmaker_internal.squad_listings where id=x;
 select post_reference into ref2 from matchmaker_internal.squad_listings where id=y;
 if ref1 is null or ref2 is null or ref1=ref2 then raise exception 'Opaque references not distinct'; end if;
 if ref1::text=a or ref2::text=b then raise exception 'Member ID exposed'; end if;
 begin
  update matchmaker_internal.squad_listings set post_reference=ref1 where id=y;
  raise exception 'Duplicate opaque reference unexpectedly accepted';
 exception when unique_violation then null;
 end;
end $$;
RESET ROLE;
SELECT 'Opaque reference uniqueness PASSED' AS result;
