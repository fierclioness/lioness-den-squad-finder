import test from "node:test";
import assert from "node:assert/strict";
import {makeScheduledWorkerComposition} from "./scheduled-worker-composition.mjs";

const secret="offline-example-key-not-a-real-secret-123456789";
const token="test-only-not-a-real-discord-bot-token";
const channelId="1546529501859815438",botUserId="1546529501859815439";
const messageId="1546529501859815440";
const request=(task,key=secret)=>new Request(
 "https://staging.invalid/functions/v1/den-matchmaker-worker/"+task,{
  method:"POST",headers:{"x-matchmaker-scheduler-key":key}
 });
test("composition defaults completely OFF, no network or private SQL calls",async()=>{
 let dbCalls=0,networkCalls=0;
 const handle=makeScheduledWorkerComposition({
  query:async()=>{dbCalls++;throw Error("No database requests allowed");},
  fetchFn:async()=>{networkCalls++;throw Error("No network requests allowed");}
 });
 const response=await handle(request("publish"));
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{status:"disabled"});
 assert.equal(dbCalls,0);
 assert.equal(networkCalls,0);
});
test("independent review, credentials and scheduler secret are all required",()=>{
 const query=async()=>({rows:[]});
 const fetchFn=async()=>{throw Error("Never reach Discord");};
 assert.throws(()=>makeScheduledWorkerComposition({
  query,fetchFn,postingEnabled:true,schedulerEnabled:true,schedulerSecret:secret
 }),/reviewed Discord/);
 assert.throws(()=>makeScheduledWorkerComposition({
  query,fetchFn,postingEnabled:true,schedulerEnabled:true,schedulerSecret:secret,
  destinationReviewed:true,channelId:"1546529497925296199",botUserId,botToken:token
 }),/reviewed Discord/);
 assert.throws(()=>makeScheduledWorkerComposition({
  query,fetchFn,cleanupEnabled:true,schedulerEnabled:true,schedulerSecret:secret,
  destinationReviewed:true,channelId,botUserId,botToken:""
 }),/credentials/);
 assert.throws(()=>makeScheduledWorkerComposition({
  query,fetchFn,maintenanceEnabled:true,schedulerEnabled:true
 }),/scheduler secret/);
 assert.throws(()=>makeScheduledWorkerComposition({
  query,fetchFn,maintenanceEnabled:true,schedulerEnabled:false
 }),/scheduler is disabled/);
 assert.throws(()=>makeScheduledWorkerComposition({
  query,fetchFn,maintenanceEnabled:"true"
 }),/booleans/);
});
test("private maintenance-only gateway calls bounded database RPCs, no Discord",async()=>{
 let sqlCalls=0,discordCalls=0;
 const handle=makeScheduledWorkerComposition({
  query:async(sql,params)=>{
   sqlCalls++;assert.match(sql,/matchmaker_internal/);
   assert.ok(params.length>0);
   return {rows:[{affected:0}]};
  },
  fetchFn:async()=>{discordCalls++;throw Error("No Discord allowed");},
  schedulerEnabled:true,maintenanceEnabled:true,schedulerSecret:secret
 });
 assert.equal((await handle(request("maintenance","wrong"))).status,401);
 assert.equal((await handle(request("publish"))).status,403);
 assert.equal(sqlCalls,0);
 const res=await handle(request("maintenance"));
 assert.equal(res.status,200);
 assert.deepEqual(await res.json(),{task:"maintenance",status:"complete"});
 assert.equal(sqlCalls,3);
 assert.equal(discordCalls,0);
});
test("mock posting path sends once to fixed text channel and records trusted receipt",async()=>{
 const sent=[];
 const query=async(sql,params)=>{
  if(sql.includes("claim_post"))return {rows:[{id:"27"}]};
  if(sql.includes("from matchmaker_internal.squad_listings"))
   return {rows:[{
    game:"Call of Duty",platform:"Xbox",vibe:"Casual",mic:"Optional",
    timezone:"ET",availability:"Saturday evening",
    post_reference:"11111111-1111-4111-8111-111111111111"
   }]};
  if(sql.includes("finish_post_with_receipt")){
   assert.deepEqual(params.slice(2),[messageId,channelId,botUserId]);
   return {rows:[{result:"posted_active"}]};
  }
  throw Error("Unexpected query "+sql);
 };
 const fetchFn=async(url,init)=>{
  sent.push({url,init});
  return {ok:true,json:async()=>({
   id:messageId,channel_id:channelId,author:{id:botUserId,bot:true}
  })};
 };
 const handle=makeScheduledWorkerComposition({
  query,fetchFn,schedulerSecret:secret,schedulerEnabled:true,
  postingEnabled:true,destinationReviewed:true,botToken:token,botUserId,channelId
 });
 const result=await handle(request("publish"));
 assert.equal(result.status,200);
 assert.deepEqual(await result.json(),{task:"publish",status:"posted"});
 assert.equal(sent.length,1);
 assert.equal(sent[0].url,"https://discord.com/api/v10/channels/"+channelId+"/messages");
 const body=JSON.parse(sent[0].init.body);
 assert.deepEqual(body.allowed_mentions,{parse:[]});
 assert.match(body.content,/Den ref/);
 assert.doesNotMatch(body.content,/1418199180287148073/);
 assert.equal((await handle(request("cleanup"))).status,403);
});
test("mock cleanup path GET-verifies original bot post before DELETE",async()=>{
 const calls=[],queries=[];
 const query=async(sql)=>{
  queries.push(sql);
  if(sql.includes("claim_cleanup"))return {rows:[{listing_id:"27"}]};
  if(sql.includes("from matchmaker_internal.cleanup_outbox"))
   return {rows:[{
    listing_id:"27",message_id:messageId,channel_id:channelId,bot_user_id:botUserId,
    receipt_message_id:messageId,receipt_channel_id:channelId,
    receipt_bot_user_id:botUserId,listing_status:"closed",
    expires_at:"2026-11-19T00:00:00.000Z"
   }]};
  if(sql.includes("finish_cleanup"))return {rows:[{ok:true}]};
  throw Error("Unexpected SQL "+sql);
 };
 const fetchFn=async(url,init)=>{
  calls.push({url,method:init.method});
  if(init.method==="GET")return {status:200,json:async()=>({
   id:messageId,channel_id:channelId,author:{id:botUserId,bot:true}
  })};
  if(init.method==="DELETE")return {status:204};
  throw Error("Unexpected Discord request");
 };
 const handle=makeScheduledWorkerComposition({
  query,fetchFn,schedulerSecret:secret,schedulerEnabled:true,
  cleanupEnabled:true,destinationReviewed:true,botToken:token,botUserId,channelId
 });
 const result=await handle(request("cleanup"));
 assert.equal(result.status,200);
 assert.deepEqual(await result.json(),{task:"cleanup",status:"deleted"});
 assert.deepEqual(calls.map(x=>x.method),["GET","DELETE"]);
 assert.ok(queries.some(x=>x.includes("finish_cleanup")));
 assert.equal((await handle(request("publish"))).status,403);
});
