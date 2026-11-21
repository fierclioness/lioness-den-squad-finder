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

test("untrusted numeric/boxed Discord delivery IDs cannot write a receipt",async()=>{
 const exact="1546529501859815438";
 for(const messageId of [Number(exact),BigInt(exact),new String(exact)]){
  const sql=[];
  let sends=0;
  const query=async statement=>{
   sql.push(statement);
   if(statement.includes("claim_post"))return {rows:[{id:"12"}]};
   if(statement.includes("squad_listings"))return {rows:[listing]};
   if(statement.includes("fail_post"))return {rows:[{ok:true}]};
   throw Error("Invalid numeric delivery was persisted");
  };
  const result=await create(query,async()=>({
    confirmed:true,messageId,channelId,botUserId
  })).runOnce();
  assert.equal(result.status,"uncertain");
  assert.equal(sql.filter(s=>s.includes("finish_post_with_receipt")).length,0);
  assert.equal(sql.filter(s=>s.includes("fail_post")).length,1);
 }
 const query=async()=>{throw Error("Should not reach database");};
 const sendMessage=async()=>{throw Error("Should not send");};
 for(const id of [Number(channelId),BigInt(channelId),new String(channelId)]){
  assert.throws(()=>makeOutboxWorker({query,sendMessage,enabled:true,channelId:id,botUserId}),/Trusted configured/);
 }
 for(const id of [Number(botUserId),BigInt(botUserId),new String(botUserId)]){
  assert.throws(()=>makeOutboxWorker({query,sendMessage,enabled:true,channelId,botUserId:id}),/Trusted configured/);
 }
});

test("rounded, boxed or out-of-range private listing claims never reach Discord",async()=>{
 const badIds=[12,Number("9007199254740993"),12n,new String("12"),
  "0","012","1e1","9223372036854775808",{}];
 for(const id of badIds){
  let dbCalls=0,sends=0;
  const query=async(sql)=>{
   dbCalls++;
   if(sql.includes("claim_post"))return {rows:[{id}]};
   throw Error("Untrusted claim reached another private query");
  };
  const worker=create(query,async()=>{sends++;throw Error("Unsafe public send");});
  await assert.rejects(worker.runOnce(),/Untrusted claimed post listing ID/);
  assert.equal(dbCalls,1,"invalid claim cannot fetch or mutate a listing");
  assert.equal(sends,0,"invalid claim cannot create a Discord post");
 }
});

test("public outbox rejects forged channel mentions even if unsafe data bypasses draft validation",async()=>{
 let sends=0,quarantines=0;
 const query=async sql=>{
  if(sql.includes("claim_post"))return {rows:[{id:"12"}]};
  if(sql.includes("squad_listings"))return {rows:[{...listing,availability:"Meet in <#1546529501859815438>"}]};
  if(sql.includes("fail_post")){quarantines++;return {rows:[{ok:true}]};}
  throw Error("Unexpected persistence after unsafe mention");
 };
 const result=await create(query,async()=>{sends++;}).runOnce();
 assert.equal(result.status,"uncertain");
 assert.equal(sends,0);
 assert.equal(quarantines,1);
});


test("public outbox quarantines invisible layout and direction-control spoofing before Discord POST",async()=>{
 // U+202E reverses visual reading order. U+2028 and U+0085 can create
 // fake message lines without an ASCII newline. Neither is a safe listing.
 for(const unsafe of [
   "Casual"+String.fromCharCode(0x202E)+"noitacifirev",
   "Casual"+String.fromCharCode(0x2028)+"Fake moderator announcement",
   "Casual"+String.fromCharCode(0x0085)+"Fake announcement",
   "Casual"+String.fromCharCode(0x2066)+"isolate",
   " \r\n\t "
 ]){
   let sends=0,quarantines=0;
   const query=async statement=>{
     if(statement.includes("claim_post"))return {rows:[{id:"12"}]};
     if(statement.includes("squad_listings"))return {rows:[{...listing,vibe:unsafe}]};
     if(statement.includes("fail_post")){quarantines++;return {rows:[{ok:true}]};}
     throw Error("An unsafe listing was persisted");
   };
   const outcome=await create(query,async()=>{sends++;throw Error("Unsafe Discord send");}).runOnce();
   assert.equal(outcome.status,"uncertain");
   assert.equal(sends,0,"No Discord POST for unsafe text");
   assert.equal(quarantines,1,"State is quarantined once");
 }
});

test("public outbox preserves ordinary Unicode and normalizes CR/LF without extra Discord lines",async()=>{
 let sentContent="",sends=0;
 const query=async statement=>{
   if(statement.includes("claim_post"))return {rows:[{id:"12"}]};
   if(statement.includes("squad_listings"))
     return {rows:[{...listing,game:"Pokémon 🎮",vibe:"Relaxed\r\nteam"}]};
   if(statement.includes("finish_post_with_receipt"))return {rows:[{result:"posted_active"}]};
   throw Error("Unexpected SQL");
 };
 const outcome=await create(query,async payload=>{
   sends++;
   sentContent=payload.content;
   return {confirmed:true,messageId:"1546529501859815438",channelId,botUserId};
 }).runOnce();
 assert.equal(outcome.status,"posted");
 assert.equal(sends,1);
 assert.match(sentContent,/Pokémon 🎮/);
 assert.match(sentContent,/Relaxed team/);
 assert.doesNotMatch(sentContent,/Relaxed\r|Relaxed\n/);
});
