import test from "node:test";
import assert from "node:assert/strict";
import {makeOutboxWorker} from "./outbox-worker.mjs";
const listing={post_reference:"5d6e21e8-2637-4f6d-91b6-a51549a087e5",game:"Call of Duty",platform:"Xbox",vibe:"Casual",mic:"Optional",timezone:"ET",availability:"Saturday evening"};
const workerId="11111111-1111-4111-8111-111111111111";
const channelId="1546529497925296199",botUserId="1546529501859815439";
const create=(query,sendMessage,enabled=true)=>makeOutboxWorker({query,sendMessage,enabled,channelId,botUserId,newWorkerId:()=>workerId});
test("disabled worker neither claims nor sends",async()=>{
 let calls=0;const worker=create(async()=>{calls++;throw Error("query blocked");},async()=>{calls++;throw Error("send blocked");},false);
 assert.deepEqual(await worker.runOnce(),{status:"disabled"});assert.equal(calls,0);
});
test("posting requires verified Discord message ID and an atomic finish",async()=>{
 const sql=[];
 const query=async(s,p)=>{
  sql.push({s,p});
  if(s.includes("claim_post"))return {rows:[{id:"12"}]};
  if(s.includes("squad_listings"))return {rows:[listing]};
  if(s.includes("finish_post_with_receipt"))return {rows:[{result:"posted_active"}]};
  throw Error("Unexpected query");
 };
 let called=0;
 const transport=async payload=>{
  called++;assert.deepEqual(payload.allowed_mentions,{parse:[]});
  assert.match(payload.content,/Looking for a squad/);
  assert.match(payload.content,/🔎 Den ref: 5d6e21e8-2637-4f6d-91b6-a51549a087e5/);
  assert.doesNotMatch(payload.content,/@everyone/);
  return {confirmed:true,messageId:"1546529501859815438",channelId,botUserId};
 };
 const result=await create(query,transport).runOnce();
 assert.equal(result.status,"posted");assert.equal(called,1);
 assert.ok(sql.at(-1).s.includes("finish_post"));
 assert.equal(sql.at(-1).p[2],"1546529501859815438");
 assert.deepEqual(sql.at(-1).p.slice(3),[channelId,botUserId]);
});
test("timeout or unknown result is quarantined, never treated as definitely unsent",async()=>{
 const seen=[];
 const query=async(s,p)=>{
  seen.push({s,p});
  if(s.includes("claim_post"))return {rows:[{id:"12"}]};
  if(s.includes("squad_listings"))return {rows:[listing]};
  if(s.includes("fail_post"))return {rows:[{ok:true}]};
  throw Error("Unrecognized SQL");
 };
 const result=await create(query,async()=>{throw Error("network timeout");}).runOnce();
 assert.equal(result.status,"uncertain");
 assert.equal(seen.at(-1).p[2],false);
});
test("unsafe content is not sent and is quarantined",async()=>{
 let sends=0;
 const query=async(s)=>{
  if(s.includes("claim_post"))return {rows:[{id:"12"}]};
  if(s.includes("squad_listings"))return {rows:[{...listing,game:"@everyone"}]};
  if(s.includes("fail_post"))return {rows:[{ok:true}]};
 };
 const result=await create(query,async()=>{sends++;}).runOnce();
 assert.equal(result.status,"uncertain");assert.equal(sends,0);
});
test("confirmed delivery with failed database write raises without resending",async()=>{
 let sends=0;
 const query=async s=>{
  if(s.includes("claim_post"))return {rows:[{id:"12"}]};
  if(s.includes("squad_listings"))return {rows:[listing]};
  if(s.includes("finish_post_with_receipt"))throw Error("database failure after send");
 };
 const worker=create(query,async()=>{sends++;return {confirmed:true,messageId:"1546529501859815438",channelId,botUserId};});
 await assert.rejects(worker.runOnce(),/manual reconciliation/);
 assert.equal(sends,1);
});

test("false quarantine acknowledgement must fail closed instead of reporting an uncertain state",async()=>{
 let sends=0,failCalls=0;
 const query=async s=>{
  if(s.includes("claim_post"))return {rows:[{id:"12"}]};
  if(s.includes("squad_listings"))return {rows:[listing]};
  if(s.includes("fail_post")){failCalls++;return {rows:[{ok:false}]};}
  throw Error("Unexpected SQL");
 };
 await assert.rejects(create(query,async()=>{
  sends++;throw Error("ambiguous Discord timeout");
 }).runOnce(),/Post quarantine not committed; manual reconciliation required/);
 assert.equal(sends,1,"never resend an ambiguous Discord delivery");
 assert.equal(failCalls,1,"never retry the safety-state transition speculatively");
});
test("missing listing only reports unsent after the private outbox confirms its state change",async()=>{
 let sends=0;
 const query=async(s,p)=>{
  if(s.includes("claim_post"))return {rows:[{id:"12"}]};
  if(s.includes("squad_listings"))return {rows:[]};
  if(s.includes("fail_post")){
   assert.equal(p[2],true,"only definitively unsent when no listing was sent");
   return {rows:[{ok:true}]};
  }
  throw Error("Unexpected SQL");
 };
 const result=await create(query,async()=>{sends++;}).runOnce();
 assert.equal(result.status,"unsent");
 assert.equal(sends,0);
});
test("missing listing with false safety write never returns unsent or uncertain success",async()=>{
 let sends=0,failCalls=0;
 const query=async s=>{
  if(s.includes("claim_post"))return {rows:[{id:"12"}]};
  if(s.includes("squad_listings"))return {rows:[]};
  if(s.includes("fail_post")){failCalls++;return {rows:[{ok:false}]};}
  throw Error("Unexpected SQL");
 };
 await assert.rejects(create(query,async()=>{sends++;}).runOnce(),
  /Unsent state not committed; manual reconciliation required/);
 assert.equal(sends,0);
 assert.equal(failCalls,1);
});
