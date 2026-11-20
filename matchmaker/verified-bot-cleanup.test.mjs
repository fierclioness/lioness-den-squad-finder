import test from "node:test";
import assert from "node:assert/strict";
import {makeVerifiedBotCleanup} from "./verified-bot-cleanup.mjs";
const channelId="1546529497925296199",botUserId="1546529501859815438",messageId="1546529501859815439";
const botToken="test-only-secret-is-not-real-123456789";
function good(){return {id:messageId,channel_id:channelId,author:{id:botUserId,bot:true}};}
const create=(fetchFn)=>makeVerifiedBotCleanup({botToken,botUserId,channelId,fetchFn,enabled:true});
test("disabled cleanup makes no network requests",async()=>{
 let calls=0;
 const x=makeVerifiedBotCleanup({fetchFn:async()=>{calls++;}});
 await assert.rejects(x.remove(messageId),/disabled/);
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
 assert.equal((await x.remove(messageId)).status,"deleted");
 assert.deepEqual(methods,["GET","DELETE"]);
});
test("never deletes a message owned by an ordinary member or different bot",async()=>{
 for(const author of [{id:"1418199180287148073",bot:false},{id:"1546529501859815411",bot:true}]){
  let deletes=0;
  const x=create(async(_url,opts)=>{
   if(opts.method==="DELETE")deletes++;
   return {status:200,json:async()=>({...good(),author})};
  });
  await assert.rejects(x.remove(messageId),/not verified/);
  assert.equal(deletes,0);
 }
});
test("unverified response and unavailable Discord fail closed",async()=>{
 let deletes=0;
 const x=create(async(_url,opts)=>{
  if(opts.method==="DELETE")deletes++;
  return {status:200,json:async()=>({...good(),channel_id:"999999999999999999"})};
 });
 await assert.rejects(x.remove(messageId),/not verified/);
 assert.equal(deletes,0);
 const missing=create(async()=>({status:404}));
 assert.equal((await missing.remove(messageId)).status,"already_absent");
 const unauthorized=create(async()=>({status:403}));
 await assert.rejects(unauthorized.remove(messageId),/Could not verify/);
});
test("failed DELETE is not marked successful",async()=>{
 const x=create(async(_url,opts)=>opts.method==="GET"?
  {status:200,json:async()=>good()}:{status:429});
 await assert.rejects(x.remove(messageId),/reconciliation/);
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
 await assert.rejects(stalledRead.remove(messageId),e=>e?.name==="TimeoutError");
 assert.equal(deletes,0);
 const stalledDelete=makeVerifiedBotCleanup({enabled:true,botToken,botUserId,channelId,requestTimeoutMs:20,
  fetchFn:async(_url,init)=>init.method==="GET"?
    {status:200,json:async()=>good()}:waitForAbort(init.signal)});
 await assert.rejects(stalledDelete.remove(messageId),e=>e?.name==="TimeoutError");
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
 await assert.rejects(redirectedRead.remove(messageId),/Redirected Discord lookup/);
 assert.equal(deletes,0);
 const redirectedDelete=create(async(_url,init)=>{
  assert.equal(init.redirect,"error");
  if(init.method==="GET")return {status:200,json:async()=>good()};
  deletes++;
  return {status:204,redirected:true};
 });
 await assert.rejects(redirectedDelete.remove(messageId),/Redirected Discord deletion/);
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
 await assert.rejects(safe.remove(Number(messageId)),/Invalid original message receipt/);
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
  await assert.rejects(cleanup.remove(messageId),/not verified/);
  assert.equal(gets,1);
  assert.equal(deletes,0,"Numeric author, channel or message IDs cannot authorize DELETE");
 }
});
