// Staging-only maintenance and separately gated, one-item controlled publication.
// No scheduler registration, automatic Discord deletion, or member-facing endpoint.
import {withSupabase} from "npm:@supabase/server@1.9.2";
import pg from "npm:pg@8.16.3";
import {resolvePrivateDatabaseUrl} from "../../../matchmaker/staging-runtime-config.mjs";
import {makeStagingMaintenanceHandler} from "../../../matchmaker/staging-maintenance-handler.mjs";
import {makeOutboxWorker} from "../../../matchmaker/outbox-worker.mjs";
import {makeDiscordTransport} from "../../../matchmaker/discord-transport.mjs";
import {makeScheduledWorkerGateway} from "../../../matchmaker/scheduled-worker-gateway.mjs";
const disabled=()=>Response.json({status:"disabled"},{status:503,headers:{"cache-control":"no-store"}});
let pool: pg.Pool | undefined;
let publishPool: pg.Pool | undefined;
const readEnv=(name:string)=>Deno.env.get(name);
const snow=/^\\d{15,22}$/;
// Only the dedicated named-secret caller AND independent operator key can run this route.
// It claims at most one confirmed job. Both enqueue and publication default OFF.
async function publishOnce(request:Request):Promise<Response>{
 if(Deno.env.get("DEN_MATCHMAKER_TEST_PUBLISH_ENABLED")!=="true")return disabled();
 const url=resolvePrivateDatabaseUrl(readEnv);
 const channelId=Deno.env.get("DEN_MATCHMAKER_TEST_CHANNEL_ID")??"";
 const botUserId=Deno.env.get("DEN_MATCHMAKER_TEST_BOT_USER_ID")??"";
 const botToken=Deno.env.get("DEN_MATCHMAKER_TEST_BOT_TOKEN")??"";
 const schedulerSecret=Deno.env.get("DEN_MATCHMAKER_OPERATOR_KEY")??"";
 const testerIds=(Deno.env.get("DEN_MATCHMAKER_TESTER_IDS")??"").split(",").map(x=>x.trim()).filter(Boolean);
 if(!url||testerIds.length!==1||!snow.test(testerIds[0])||!snow.test(channelId)||!snow.test(botUserId)||channelId===botUserId||channelId==="1546529497925296199"||botToken.length<20||!/^[\\x21-\\x7e]{32,256}$/.test(schedulerSecret))return disabled();
 // The staging-only resolver rejects any other recognizable Supabase project.
 // For the controlled test, do not accept opaque explicit database hosts.
 const parsed=new URL(url);
 if(parsed.hostname!=="db.tcxktyqywsqafnyxhpgy.supabase.co"&&!( /^[a-z0-9-]+\\.pooler\\.supabase\\.com$/.test(parsed.hostname)&&decodeURIComponent(parsed.username).endsWith(".tcxktyqywsqafnyxhpgy")))return disabled();
 publishPool??=new pg.Pool({connectionString:url,max:1,connectionTimeoutMillis:3000,statement_timeout:5000,ssl:{rejectUnauthorized:true}});
 const transport=makeDiscordTransport({botToken,channelId,botUserId,enabled:true});
 const publisher=makeOutboxWorker({query:(sql:string,args:unknown[])=>publishPool!.query(sql,args),sendMessage:transport.sendMessage,channelId,botUserId,enabled:true});
 return await makeScheduledWorkerGateway({schedulerSecret,enabled:true,postingEnabled:true,cleanupEnabled:false,maintenanceEnabled:false,publisher})(request);
}
export default {
 fetch:withSupabase({auth:"secret:den_matchmaker_scheduler"},async(request)=>{
  try{
   const path=new URL(request.url).pathname;
   if(/^(?:\\/run|\\/den-matchmaker-worker|\\/functions\\/v1\\/den-matchmaker-worker)\\/publish$/.test(path))return await publishOnce(request);
  }catch{return disabled();}
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
