import test from "node:test";
import assert from "node:assert/strict";
import {makePostgresMatchmakerStore} from "./postgres-store-adapter.mjs";
import {makeMatchmakerDispatcher} from "./command-dispatcher.mjs";
const actor={guildId:"1546529497925296199",memberId:"1418199180287148073"};
const token="11111111-1111-4111-8111-111111111111";
const draft={game:"Call of Duty",platform:"Xbox",vibe:"Casual",mic:"Optional",timezone:"ET",availability:"Saturday evening"};
test("server-side adapter calls private parameterized RPCs without posting",async()=>{
 const queries=[];
 const query=async(sql,params)=>{
  queries.push({sql,params});
  if(sql.includes("prepare_preview"))return {rows:[{token}]};
  if(sql.includes("confirm_preview"))return {rows:[{id:"27"}]};
  if(sql.includes("cancel_preview"))return {rows:[{cancelled:true}]};
  if(sql.includes("close_with_post_guard"))return {rows:[{outcome:"closed_cleanup_queued"}]};
  if(sql.includes("claim_interaction"))return {rows:[{accepted:true}]};
  return {rows:[]};
 };
 const store=makePostgresMatchmakerStore({query});
 assert.deepEqual(await store.prepare(actor,draft),{token});
 assert.deepEqual(await store.confirm(actor,token),{listingId:"27",publicPostCreated:false,queuedForPublishing:false});
 assert.equal(await store.cancel(actor,token),true);
 assert.equal(await store.close(actor),true);
 assert.equal(await store.claimReplay("1546529501859815438"),true);
 assert.equal(await store.mine(actor),null);
 assert.deepEqual(await store.list(actor),[]);
 assert.equal(queries.length,7);
 for(const {sql,params} of queries){
  assert.match(sql,/matchmaker_internal/);
  assert.ok(Array.isArray(params));
  assert.doesNotMatch(sql,/1418199180287148073|Call of Duty/);
  assert.doesNotMatch(sql,/SUPABASE_SERVICE_ROLE_KEY|discord\.com\/api/);
 }
 assert.deepEqual(queries[0].params,[actor.memberId,draft.game,draft.platform,draft.vibe,draft.mic,draft.timezone,draft.availability]);
 assert.deepEqual(queries[1].params,[actor.memberId,token]);
 assert.match(queries[1].sql,/confirm_preview/);
 assert.ok(queries.every(x=>!x.sql.includes("confirm_and_enqueue")));
});
test("owner identity, input and token are validated before database access",async()=>{
 let count=0;
 const store=makePostgresMatchmakerStore({query:async()=>{count++;return {rows:[]};}});
 await assert.rejects(store.prepare({...actor,guildId:"999999999999999999"},draft),/verified Discord actor/);
 await assert.rejects(store.prepare(actor,{...draft,game:"@everyone"}),/Mentions/);
 await assert.rejects(store.confirm(actor,"not-a-token"),/Invalid preview token/);
 await assert.rejects(store.claimReplay("not-a-snowflake"),/Invalid verified interaction ID/);
 assert.equal(count,0);
 assert.throws(()=>makePostgresMatchmakerStore({}),/query function/);
});
test("private SQL adapter refuses coerced or imprecise member identities before every operation",async()=>{
 let queries=0;
 const store=makePostgresMatchmakerStore({query:async()=>{queries++;return {rows:[]};}});
 assert.notEqual(String(Number(actor.memberId)),actor.memberId,
  "Fixture must demonstrate a lossy Discord snowflake conversion");
 for(const memberId of [
  Number(actor.memberId),BigInt(actor.memberId),new String(actor.memberId),
  {toString:()=>actor.memberId},null,undefined
 ]){
  const untrusted={...actor,memberId};
  for(const operation of [
   ()=>store.prepare(untrusted,draft),
   ()=>store.confirm(untrusted,token),
   ()=>store.cancel(untrusted,token),
   ()=>store.close(untrusted),
   ()=>store.mine(untrusted),
   ()=>store.list(untrusted)
  ]){
   await assert.rejects(operation(),/Invalid verified Discord actor/);
  }
 }
 assert.equal(queries,0,"Untrusted actor IDs must never reach private SQL");
});

test("unavailable database fails closed and no fallback is used",async()=>{
 const store=makePostgresMatchmakerStore({query:async()=>{throw Error("database unavailable");}});
 await assert.rejects(store.claimReplay("1546529501859815438"),/database unavailable/);
 await assert.rejects(store.prepare(actor,draft),/database unavailable/);
});
test("dispatcher interoperates with SQL adapter without publishing",async()=>{
 const query=async(sql)=>{
  if(sql.includes("prepare_preview"))return {rows:[{token}]};
  if(sql.includes("confirm_preview"))return {rows:[{id:"28"}]};
  return {rows:[]};
 };
 const dispatch=makeMatchmakerDispatcher({store:makePostgresMatchmakerStore({query})});
 const fields=Object.entries(draft).map(([name,value])=>({name,value}));
 const create=await dispatch({...actor,type:2,data:{name:"squad",options:[{name:"create",options:fields}]}});
 assert.equal(create.buttons[0].token,token);
 const response=await dispatch({...actor,type:3,data:{custom_id:"mm:confirm:"+token+":private"}});
 assert.match(response.content,/Nothing was posted/);
});

test("private confirmation cannot be retroactively posted when worker starts",async()=>{
 const seen=[],query=async sql=>{seen.push(sql);return {rows:[{id:"29"}]};};
 const privately=makePostgresMatchmakerStore({query});
 assert.deepEqual(await privately.confirm(actor,token),{
  listingId:"29",publicPostCreated:false,queuedForPublishing:false
 });
 assert.match(seen.at(-1),/confirm_preview/);
 const publish=makePostgresMatchmakerStore({query,publishingEnabled:true});
 assert.deepEqual(await publish.confirm(actor,token),{
  listingId:"29",publicPostCreated:false,queuedForPublishing:true
 });
 assert.match(seen.at(-1),/confirm_and_enqueue/);
 assert.throws(()=>makePostgresMatchmakerStore({query,publishingEnabled:"true"}),/flag/);
});

test("private preview RPC refuses coerced tokens before they reach Discord consent buttons",async()=>{
 let sqlCalls=0;
 let databaseToken=token;
 const store=makePostgresMatchmakerStore({
  query:async sql=>{
   sqlCalls++;
   assert.match(sql,/prepare_preview/);
   return {rows:[{token:databaseToken}]};
  }
 });
 // The dispatcher must never be given a string-converted token by storage.
 for(const untrusted of [
  new String(token),{toString:()=>token},[token],null,undefined,
  11111111,11111111n,"not-a-uuid"
 ]){
  databaseToken=untrusted;
  await assert.rejects(store.prepare(actor,draft),/valid preview token/);
 }
 assert.equal(sqlCalls,8,"Each failed preview may query once, but cannot issue a trusted token");
 databaseToken=token;
 assert.deepEqual(await store.prepare(actor,draft),{token});
 assert.equal(sqlCalls,9);
});

test("private confirmation RPC rejects rounded or coerced PostgreSQL listing IDs",async()=>{
 let resultId="9007199254740993";
 let sqlCalls=0;
 const store=makePostgresMatchmakerStore({
  query:async sql=>{
   sqlCalls++;
   assert.match(sql,/confirm_preview/);
   return {rows:[{id:resultId}]};
  }
 });
 // The long valid ID has a different value if cast to Number.
 assert.notEqual(String(Number(resultId)),resultId);
 for(const untrusted of [
  Number(resultId),BigInt(resultId),new String(resultId),
  {toString:()=>resultId},[resultId],null,undefined,
  "09007199254740993","0","-5","9223372036854775808"
 ]){
  resultId=untrusted;
  await assert.rejects(store.confirm(actor,token),/valid listing ID/);
 }
 assert.equal(sqlCalls,11);
 resultId="9007199254740993";
 assert.deepEqual(await store.confirm(actor,token),
  {listingId:resultId,publicPostCreated:false,queuedForPublishing:false});
 assert.equal(sqlCalls,12);
});
