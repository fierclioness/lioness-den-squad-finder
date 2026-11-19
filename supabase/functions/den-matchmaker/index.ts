// STAGING only: deployed on isolated Matchmaker project. Never activate production without review.
// No Discord bot token, public posting or member changes. Commands require server-only feature gates.
// Discord webhook needs JWT handling reviewed; raw Ed25519 validation is mandatory.
import pg from "npm:pg@8.16.3";
import {makeMatchmakerServer} from "../../../matchmaker/server-composition.mjs";
import {stagingHealthResponse} from "../../../matchmaker/staging-health.mjs";
import {resolvePrivateDatabaseUrl} from "../../../matchmaker/staging-runtime-config.mjs";
const key=Deno.env.get("DEN_MATCHMAKER_DISCORD_PUBLIC_KEY") ?? "";
const url=resolvePrivateDatabaseUrl((name:string)=>Deno.env.get(name));
const enabled=Deno.env.get("DEN_MATCHMAKER_COMMANDS_ENABLED")==="true";
// Fail closed: an enabled staging command endpoint must explicitly name tester IDs.
const testerCsv=Deno.env.get("DEN_MATCHMAKER_TESTER_IDS") ?? "";
const testerIds=testerCsv.split(",").map(x=>x.trim()).filter(Boolean);
const testerAllowlistValid=testerIds.length>0 && testerIds.every(x=>/^\d{15,22}$/.test(x));
const allowedTesterIds=new Set(testerIds);
function unavailable():Response {
 return new Response(JSON.stringify({error:"Not configured"}),{status:503,
  headers:{"content-type":"application/json","cache-control":"no-store"}});
}
const configured=/^[a-f0-9]{64}$/i.test(key)&&/^(postgresql|postgres):\/\//.test(url)&&
  (!enabled||testerAllowlistValid);
if(!configured){
 Deno.serve((request:Request)=>stagingHealthResponse(request,{commandsEnabled:enabled,configured:false})??unavailable());
}else{
 const pool=new pg.Pool({connectionString:url,max:1,connectionTimeoutMillis:1000,
  idleTimeoutMillis:1000,ssl:{rejectUnauthorized:true}});
 const server=makeMatchmakerServer({
  publicKeyHex:key,
  query:(sql:string,params:unknown[])=>pool.query(sql,params),
  enabled,
  allowedTesterIds
 });
 // A static GET health must remain available in BOTH disabled and tester-enabled modes.
 // It never bypasses signature validation for POST interactions.
 Deno.serve((request:Request)=>stagingHealthResponse(request,{commandsEnabled:enabled})??server(request));
}
