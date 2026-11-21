import test from "node:test";
import assert from "node:assert/strict";
import {planCleanup,makeMessageCleanupTransport} from "./listing-cleanup.mjs";
const id="1546529501859815438",channel="1546529497925296199";
const botUserId="1546529501859815439";
const reference="9ff00490-3730-4390-8c87-80f0aaffc231";
const row={postReference:reference,status:"active",expiresAtMs:1000,postState:"posted",botOwned:true,messageId:id,channelId:channel};
const token="local-fake-not-a-real-token-12345";
const endpoint="https://discord.com/api/v10/channels/"+channel+"/messages/"+id;
const receipt=()=>({id,channel_id:channel,author:{id:botUserId,bot:true},
 content:"🔎 Den ref: "+reference});
test("active requests do not get deleted; closed or expired can",()=>{
 assert.equal(planCleanup(row,{now:999}).action,"none");
 assert.equal(planCleanup({...row,status:"closed"},{now:999}).action,"delete");
 assert.equal(planCleanup({...row,status:"expired"},{now:999}).action,"delete");
 assert.equal(planCleanup(row,{now:1000}).action,"delete");
});
test("never delete posts with ambiguous receipt, wrong owner or missing channel",()=>{
 assert.equal(planCleanup({...row,postState:"uncertain"},{now:2000}).action,"manual");
 assert.equal(planCleanup({...row,postState:"sending"},{now:2000}).action,"manual");
 assert.equal(planCleanup({...row,botOwned:false},{now:2000}).action,"manual");
 assert.equal(planCleanup({...row,messageId:null},{now:2000}).action,"manual");
 assert.equal(planCleanup({...row,postReference:null},{now:2000}).action,"manual");
 assert.equal(planCleanup({...row,postReference:"untrusted"},{now:2000}).action,"manual");
 assert.equal(planCleanup({...row,postState:"pending"},{now:2000}).action,"none");
});
test("transport is disabled by default; enabled requires independent bot identity",async()=>{
 let calls=0;
 const disabled=makeMessageCleanupTransport({fetchFn:async()=>{calls++;throw Error("Unexpected");}});
 await assert.rejects(disabled.removeConfirmedBotPost({action:"delete",channelId:channel,messageId:id}),/disabled/);
 assert.equal(calls,0);
 assert.throws(()=>makeMessageCleanupTransport({enabled:true,botToken:token,channelId:channel}),/identity/);
});
test("fixed-channel cleanup verifies exact bot-owned message with GET before DELETE",async()=>{
 const methods=[];
 const enabled=makeMessageCleanupTransport({enabled:true,botToken:token,botUserId,channelId:channel,
  fetchFn:async(url,opt)=>{
   assert.equal(url,endpoint);
   assert.equal(opt.headers.authorization,"Bot "+token);
   methods.push(opt.method);
   return opt.method==="GET"?{status:200,json:async()=>receipt()}:{status:204};
  }});
 assert.equal((await enabled.removeConfirmedBotPost(planCleanup(row,{now:2000}))).status,"deleted");
 assert.deepEqual(methods,["GET","DELETE"]);
 await assert.rejects(enabled.removeConfirmedBotPost({action:"delete",channelId:"999999999999999999",messageId:id}),/Unverified/);
 assert.deepEqual(methods,["GET","DELETE"]);
});
test("wrong author or bot identity blocks DELETE even with a trusted DB plan",async()=>{
 for(const author of [{id:"1418199180287148073",bot:false},{id:"1546529501859815411",bot:true}]){
  let deletions=0;
  const t=makeMessageCleanupTransport({enabled:true,botToken:token,botUserId,channelId:channel,
   fetchFn:async(_url,opts)=>{
    if(opts.method==="DELETE")deletions++;
    return {status:200,json:async()=>({...receipt(),author})};
   }});
  await assert.rejects(t.removeConfirmedBotPost(planCleanup(row,{now:2000})),/not verified/);
  assert.equal(deletions,0);
 }
});
test("only verified absence is terminal; Discord API errors remain unresolved",async()=>{
 const base={enabled:true,botToken:token,botUserId,channelId:channel};
 const missing=makeMessageCleanupTransport({...base,fetchFn:async()=>({status:404,json:async()=>({code:10008,message:"Unknown Message"})})});
 assert.equal((await missing.removeConfirmedBotPost(planCleanup(row,{now:2000}))).status,"already_absent");
 const unauthorized=makeMessageCleanupTransport({...base,fetchFn:async()=>({status:429})});
 await assert.rejects(unauthorized.removeConfirmedBotPost(planCleanup(row,{now:2000})),/Could not verify/);
 const failedDeletion=makeMessageCleanupTransport({...base,fetchFn:async(_url,opts)=>opts.method==="GET"?
   {status:200,json:async()=>receipt()}:{status:429}});
 await assert.rejects(failedDeletion.removeConfirmedBotPost(planCleanup(row,{now:2000})),/reconciliation/);
});

// A JavaScript Number cannot safely represent a 19-digit Discord snowflake.
// A legacy cleanup plan must not promote an imprecise/coerced identity to a
// DELETE candidate, even if the eventual message happens to be bot-owned.
test("legacy cleanup refuses coerced Discord IDs before any HTTP deletion",async()=>{
 const invalid=(value)=>[Number(value),BigInt(value),new String(value),
   {toString:()=>value},[value]];
 const tCalls=[];
 const transport=makeMessageCleanupTransport({enabled:true,botToken:token,
  botUserId,channelId:channel,fetchFn:async(...args)=>{
   tCalls.push(args);throw Error("Must never contact Discord");
  }});
 for(const bad of invalid(id)){
  const planned=planCleanup({...row,messageId:bad},{now:2000});
  assert.equal(planned.action,"manual","Ambiguous message ID must not be deletable");
  await assert.rejects(transport.removeConfirmedBotPost({action:"delete",
   channelId:channel,messageId:bad}),/Unverified/);
 }
 for(const bad of invalid(channel)){
  assert.equal(planCleanup({...row,channelId:bad},{now:2000}).action,"manual");
  await assert.rejects(transport.removeConfirmedBotPost({action:"delete",
   channelId:bad,messageId:id}),/Unverified/);
 }
 assert.equal(tCalls.length,0,"No GET or DELETE may occur for invalid IDs");
 assert.equal(planCleanup(row,{now:2000}).action,"delete","Valid primitive IDs still work");
});

test("legacy enabled cleanup rejects coerced fixed channel and original-bot identities",()=>{
 for(const bad of [Number(channel),BigInt(channel),new String(channel),{toString:()=>channel}]){
  assert.throws(()=>makeMessageCleanupTransport({enabled:true,botToken:token,
   botUserId,channelId:bad}),/identity/);
 }
 for(const bad of [Number(botUserId),BigInt(botUserId),new String(botUserId),{toString:()=>botUserId}]){
  assert.throws(()=>makeMessageCleanupTransport({enabled:true,botToken:token,
   botUserId:bad,channelId:channel}),/identity/);
 }
});

test("legacy cleanup cannot DELETE an unrelated message authored by the same bot",async()=>{
 let deletes=0;
 const transport=makeMessageCleanupTransport({enabled:true,botToken:token,
  botUserId,channelId:channel,fetchFn:async(_url,init)=>{
   if(init.method==="DELETE"){deletes++;return {status:204};}
   return {status:200,json:async()=>({...receipt(),
    content:"🔎 Den ref: 11111111-1111-4111-8111-111111111111"})};
  }});
 await assert.rejects(transport.removeConfirmedBotPost(planCleanup(row,{now:2000})),/not verified/);
 assert.equal(deletes,0);
});
