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
