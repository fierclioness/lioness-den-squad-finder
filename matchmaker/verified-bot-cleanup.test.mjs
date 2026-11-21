import test from "node:test";
import assert from "node:assert/strict";
import {makeVerifiedBotCleanup} from "./verified-bot-cleanup.mjs";
const channelId="1546529497925296199",botUserId="1546529501859815438",messageId="1546529501859815439";
const botToken="test-only-secret-is-not-real-123456789";
const reference="9ff00490-3730-4390-8c87-80f0aaffc231";
function good(){return {id:messageId,channel_id:channelId,author:{id:botUserId,bot:true},
 content:"🎮 COD\n🔎 Den ref: "+reference};}
const create=(fetchFn)=>makeVerifiedBotCleanup({botToken,botUserId,channelId,fetchFn,enabled:true});
test("disabled cleanup makes no network requests",async()=>{
 let calls=0;
 const x=makeVerifiedBotCleanup({fetchFn:async()=>{calls++;}});
 await assert.rejects(x.remove(messageId,reference),/disabled/);
 assert.equal(calls,0);
});
test("verifies author and channel before deleting exact bot post",async()=>{
 const methods=[];
 const x=create(async(url,options)=>{
  methods.push(options.method);
  assert.equal(url,"https://discord.com/api/v10/channels/"+channelId+"/messages/"+messageId);
  assert.equal(options.headers.authorization,"Bot "+botToken);
  assert.equal(options.redirect,"error","Do not redirect bot-authorized cleanup calls");
  return options.method==="GET"?{status:200,json:async()=>good()}:{status:204};
 });
 assert.equal((await x.remove(messageId,reference)).status,"deleted");
 assert.deepEqual(methods,["GET","DELETE"]);
});
test("never deletes a message owned by an ordinary member or different bot",async()=>{
 for(const author of [{id:"1418199180287148073",bot:false},{id:"1546529501859815411",bot:true}]){
  let deletes=0;
  const x=create(async(_url,opts)=>{
   if(opts.method==="DELETE")deletes++;
   return {status:200,json:async()=>({...good(),author})};
  });
  await assert.rejects(x.remove(messageId,reference),/not verified/);
  assert.equal(deletes,0);
 }
});
test("unverified response and unavailable Discord fail closed",async()=>{
 let deletes=0;
 const x=create(async(_url,opts)=>{
  if(opts.method==="DELETE")deletes++;
  return {status:200,json:async()=>({...good(),channel_id:"999999999999999999"})};
 });
 await assert.rejects(x.remove(messageId,reference),/not verified/);
 assert.equal(deletes,0);
 const missing=create(async()=>({status:404,json:async()=>({code:10008,message:"Unknown Message"})}));
 assert.equal((await missing.remove(messageId,reference)).status,"already_absent");
 const unauthorized=create(async()=>({status:403}));
 await assert.rejects(unauthorized.remove(messageId,reference),/Could not verify/);
});
test("failed DELETE is not marked successful",async()=>{
 const x=create(async(_url,opts)=>opts.method==="GET"?
  {status:200,json:async()=>good()}:{status:429});
 await assert.rejects(x.remove(messageId,reference),/reconciliation/);
});

test("timed out GET cannot authorize a DELETE; timed out DELETE is unresolved",async()=>{
 // Native fetch keeps the event loop alive; our mock intentionally does not.
 const hold=setTimeout(()=>{},400);
 try {
 const waitForAbort=signal=>new Promise((_resolve,reject)=>{
   if(signal.aborted)return reject(signal.reason);
   signal.addEventListener("abort",()=>reject(signal.reason),{once:true});
 });
 let deletes=0;
 const stalledRead=makeVerifiedBotCleanup({enabled:true,botToken,botUserId,channelId,requestTimeoutMs:20,
  fetchFn:async(_url,init)=>{
    assert.equal(init.signal instanceof AbortSignal,true);
    if(init.method==="DELETE")deletes++;
    return waitForAbort(init.signal);
  }});
 await assert.rejects(stalledRead.remove(messageId,reference),e=>e?.name==="TimeoutError");
 assert.equal(deletes,0);
 const stalledDelete=makeVerifiedBotCleanup({enabled:true,botToken,botUserId,channelId,requestTimeoutMs:20,
  fetchFn:async(_url,init)=>init.method==="GET"?
    {status:200,json:async()=>good()}:waitForAbort(init.signal)});
 await assert.rejects(stalledDelete.remove(messageId,reference),e=>e?.name==="TimeoutError");
 assert.throws(()=>makeVerifiedBotCleanup({enabled:true,botToken,botUserId,channelId,requestTimeoutMs:0}),/timeout/);
 } finally {clearTimeout(hold);}
});

test("redirected GET never authorizes DELETE; redirected DELETE never confirms cleanup",async()=>{
 let deletes=0;
 const redirectedRead=create(async(_url,init)=>{
  assert.equal(init.redirect,"error");
  if(init.method==="DELETE")deletes++;
  return {status:200,redirected:true,json:async()=>good()};
 });
 await assert.rejects(redirectedRead.remove(messageId,reference),/Redirected Discord lookup/);
 assert.equal(deletes,0);
 const redirectedDelete=create(async(_url,init)=>{
  assert.equal(init.redirect,"error");
  if(init.method==="GET")return {status:200,json:async()=>good()};
  deletes++;
  return {status:204,redirected:true};
 });
 await assert.rejects(redirectedDelete.remove(messageId,reference),/Redirected Discord deletion/);
 assert.equal(deletes,1,"No retry after potentially ambiguous DELETE");
});

test("numeric Discord snowflakes never authorize bot-message deletion",async()=>{
 assert.notEqual(String(Number(messageId)),messageId);
 assert.throws(()=>makeVerifiedBotCleanup({
  enabled:true,botToken,botUserId,channelId:Number(channelId)
 }),/Trusted bot identity/);
 assert.throws(()=>makeVerifiedBotCleanup({
  enabled:true,botToken,botUserId:Number(botUserId),channelId
 }),/Trusted bot identity/);
 let calls=0;
 const safe=create(async()=>{calls++;return {status:200,json:async()=>good()};});
 await assert.rejects(safe.remove(Number(messageId),reference),/Invalid original message receipt/);
 assert.equal(calls,0,"Invalid numeric message ID must not reach Discord GET");
 for(const fake of [
  {...good(),id:Number(messageId)},
  {...good(),channel_id:Number(channelId)},
  {...good(),author:{id:Number(botUserId),bot:true}}
 ]){
  let gets=0,deletes=0;
  const cleanup=create(async(_url,options)=>{
   if(options.method==="GET"){gets++;return {status:200,json:async()=>fake};}
   deletes++;return {status:204};
  });
  await assert.rejects(cleanup.remove(messageId,reference),/not verified/);
  assert.equal(gets,1);
  assert.equal(deletes,0,"Numeric author, channel or message IDs cannot authorize DELETE");
 }
});

test("GET 404 requires exact Discord Unknown Message code before declaring cleanup complete",async()=>{
 for(const reply of [
  {status:404,json:async()=>({code:10003,message:"Unknown Channel"})},
  {status:404,json:async()=>({code:"10008",message:"Unknown Message"})},
  {status:404,json:async()=>({code:12345,message:"Proxy not found"})},
  {status:404,json:async()=>{throw Error("Non-JSON proxy response")}},
  {status:404}
 ]){
  const methods=[];
  const transport=create(async(_url,init)=>{methods.push(init.method);return reply;});
  await assert.rejects(transport.remove(messageId,reference),/Unverified Discord not-found response/);
  assert.deepEqual(methods,["GET"],"Never DELETE when 404 could be a missing channel or proxy error");
 }
 const methods=[];
 const safelyAbsent=create(async(_url,init)=>{
  methods.push(init.method);
  return {status:404,json:async()=>({code:10008,message:"Unknown Message"})};
 });
 assert.deepEqual(await safelyAbsent.remove(messageId,reference),{status:"already_absent"});
 assert.deepEqual(methods,["GET"]);
});

test("DELETE 404 may finish only on Discord Unknown Message; other 404s need reconciliation",async()=>{
 for(const reply of [
  {status:404,json:async()=>({code:10003,message:"Unknown Channel"})},
  {status:404,json:async()=>({code:"10008",message:"Unknown Message"})},
  {status:404,json:async()=>{throw Error("Untrusted gateway response")}}
 ]){
  const methods=[];
  const transport=create(async(_url,init)=>{
   methods.push(init.method);
   return init.method==="GET"?{status:200,json:async()=>good()}:reply;
  });
  await assert.rejects(transport.remove(messageId,reference),/Message deletion not confirmed/);
  assert.deepEqual(methods,["GET","DELETE"],"Ambiguous deletion is never retried");
 }
 const methods=[];
 const safelyAbsent=create(async(_url,init)=>{
  methods.push(init.method);
  return init.method==="GET"?{status:200,json:async()=>good()}:
   {status:404,json:async()=>({code:10008,message:"Unknown Message"})};
 });
 assert.deepEqual(await safelyAbsent.remove(messageId,reference),{status:"already_absent"});
 assert.deepEqual(methods,["GET","DELETE"]);
});

// Regression: even matching IDs cannot authorize a deletion unless Discord
// identifies the author as a bot (not merely as a matching account).
test("matching IDs with non-bot or missing bot flag never authorize DELETE",async()=>{
 for(const author of [
  {id:botUserId,bot:false},
  {id:botUserId},
  {id:botUserId,bot:"true"}
 ]){
  const methods=[];
  const cleanup=create(async(_url,init)=>{
   methods.push(init.method);
   return {status:200,json:async()=>({...good(),author})};
  });
  await assert.rejects(cleanup.remove(messageId,reference),/not verified/);
  assert.deepEqual(methods,["GET"]);
 }
});

test("malformed Discord GET payloads never authorize DELETE",async()=>{
 for(const payload of [null,[],{}, {id:messageId,channel_id:channelId},
  {...good(),author:null}, {...good(),author:[]},
  {...good(),author:{id:botUserId,bot:1}}]){
  const methods=[];
  const cleanup=create(async(_url,init)=>{
   methods.push(init.method);
   return {status:200,json:async()=>payload};
  });
  await assert.rejects(cleanup.remove(messageId,reference),/not verified/);
  assert.deepEqual(methods,["GET"],"Malformed Discord response must not reach DELETE");
 }
});

test("unreadable Discord GET JSON cannot authorize DELETE",async()=>{
 let deletes=0;
 const cleanup=create(async(_url,init)=>{
  if(init.method==="DELETE"){deletes++;return {status:204};}
  return {status:200,json:async()=>{throw Error("truncated response body");}};
 });
 await assert.rejects(cleanup.remove(messageId,reference),/Malformed Discord author receipt/);
 assert.equal(deletes,0);
});

// Identical message/channel/bot IDs are insufficient: the bot may own unrelated posts.
test("same-bot message without the original listing marker never reaches DELETE",async()=>{
 for(const content of [undefined,"Bot announcement",
  "🔎 Den ref: 11111111-1111-4111-8111-111111111111",
  "🔎 Den ref: "+reference+"\\n🔎 Den ref: "+reference]){
  const methods=[];
  const safe=create(async(_url,init)=>{
   methods.push(init.method);
   return {status:200,json:async()=>({...good(),content})};
  });
  await assert.rejects(safe.remove(messageId,reference),/not verified/);
  assert.deepEqual(methods,["GET"],"Foreign or ambiguous same-bot post must not be deleted");
 }
});
test("invalid or missing persisted reference fails before Discord GET",async()=>{
 let gets=0;
 const safe=create(async()=>{gets++;throw Error("No network allowed");});
 for(const bad of [undefined,null,123,{toString:()=>reference},"untrusted"]){
  await assert.rejects(safe.remove(messageId,bad),/Invalid private listing reference/);
 }
 assert.equal(gets,0);
});
