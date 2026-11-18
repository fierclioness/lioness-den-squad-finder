import test from "node:test";
import assert from "node:assert/strict";
import {makeOutboxWorker} from "./outbox-worker.mjs";
const listing={game:"Call of Duty",platform:"Xbox",vibe:"Casual",mic:"Optional",timezone:"ET",availability:"Saturday evening"};
const workerId="11111111-1111-4111-8111-111111111111";
const create=(query,sendMessage,enabled=true)=>makeOutboxWorker({query,sendMessage,enabled,newWorkerId:()=>workerId});
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
  if(s.includes("finish_post"))return {rows:[{ok:true}]};
  throw Error("Unexpected query");
 };
 let called=0;
 const transport=async payload=>{
  called++;assert.deepEqual(payload.allowed_mentions,{parse:[]});
  assert.match(payload.content,/Looking for a squad/);
  assert.doesNotMatch(payload.content,/@everyone/);
  return {confirmed:true,messageId:"1546529501859815438"};
 };
 const result=await create(query,transport).runOnce();
 assert.equal(result.status,"posted");assert.equal(called,1);
 assert.ok(sql.at(-1).s.includes("finish_post"));
 assert.equal(sql.at(-1).p[2],"1546529501859815438");
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
  if(s.includes("finish_post"))throw Error("database failure after send");
 };
 const worker=create(query,async()=>{sends++;return {confirmed:true,messageId:"1546529501859815438"};});
 await assert.rejects(worker.runOnce(),/manual reconciliation/);
 assert.equal(sends,1);
});
