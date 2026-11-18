// STAGING only: deployed on isolated Matchmaker project. Never activate production without review.
// No Discord bot token, public posting, real commands or member changes.
// Discord webhook needs JWT handling reviewed; raw Ed25519 validation is mandatory.
import pg from "npm:pg@8.16.3";
import {makeMatchmakerServer} from "../../../matchmaker/server-composition.mjs";
import {stagingHealthResponse} from "../../../matchmaker/staging-health.mjs";
import {resolvePrivateDatabaseUrl} from "../../../matchmaker/staging-runtime-config.mjs";
const key=Deno.env.get("DEN_MATCHMAKER_DISCORD_PUBLIC_KEY") ?? "";
const url=resolvePrivateDatabaseUrl(name=>Deno.env.get(name));
const enabled=Deno.env.get("DEN_MATCHMAKER_COMMANDS_ENABLED")==="true";
function unavailable():Response {
 return new Response(JSON.stringify({error:"Not configured"}),{status:503,
  headers:{"content-type":"application/json","cache-control":"no-store"}});
}
if(!/^[a-f0-9]{64}$/i.test(key)||!/^(postgresql|postgres):\/\//.test(url)){
 Deno.serve((request:Request)=>stagingHealthResponse(request)??unavailable());
}else{
 const pool=new pg.Pool({connectionString:url,max:1,connectionTimeoutMillis:1000,
  idleTimeoutMillis:1000,ssl:{rejectUnauthorized:true}});
 const server=makeMatchmakerServer({
  publicKeyHex:key,
  query:(sql:string,params:unknown[])=>pool.query(sql,params),
  enabled
 });
 Deno.serve((request:Request)=>!enabled?(stagingHealthResponse(request)??server(request)):server(request));
}
