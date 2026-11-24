// Staging-only maintenance worker. No Discord transport or public posting.
import {withSupabase} from "npm:@supabase/server@1.9.2";
import pg from "npm:pg@8.16.3";
import {resolvePrivateDatabaseUrl} from "../../../matchmaker/staging-runtime-config.mjs";
import {makeStagingMaintenanceHandler} from "../../../matchmaker/staging-maintenance-handler.mjs";
const disabled=()=>Response.json({status:"disabled"},{status:503,headers:{"cache-control":"no-store"}});
let pool: pg.Pool | undefined;
export default {
 fetch:withSupabase({auth:"secret:den_matchmaker_scheduler"},async(request)=>{
  if(Deno.env.get("DEN_MATCHMAKER_MAINTENANCE_ENABLED")!=="true")return disabled();
  // Require a dedicated, explicitly configured maintenance database identity.
  const explicit=Deno.env.get("DEN_MATCHMAKER_MAINTENANCE_DATABASE_URL");
  if(!explicit)return disabled();
  const url=resolvePrivateDatabaseUrl((name:string)=>name==="DEN_MATCHMAKER_DATABASE_URL"?explicit:Deno.env.get(name));
  if(!url)return disabled();
  try{
   const parsed=new URL(url);
   if(!/^den_matchmaker_maintenance(?:\.tcxktyqywsqafnyxhpgy)?$/.test(decodeURIComponent(parsed.username)))return disabled();
   if(!["db.tcxktyqywsqafnyxhpgy.supabase.co"].includes(parsed.hostname)&&!(/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(parsed.hostname)&&decodeURIComponent(parsed.username).endsWith(".tcxktyqywsqafnyxhpgy")))return disabled();
   pool??=new pg.Pool({connectionString:url,max:1,connectionTimeoutMillis:3000,statement_timeout:5000,ssl:{rejectUnauthorized:true}});
   return await makeStagingMaintenanceHandler({query:(sql:string,args:unknown[])=>pool!.query(sql,args),enabled:true})(request);
  }catch{return Response.json({status:"maintenance_failed"},{status:503,headers:{"cache-control":"no-store"}});}
 })
};
