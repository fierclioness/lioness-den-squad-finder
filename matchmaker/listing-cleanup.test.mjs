import test from "node:test";
import assert from "node:assert/strict";
import {planCleanup,makeMessageCleanupTransport} from "./listing-cleanup.mjs";
const id="1546529501859815438",channel="1546529497925296199";
const row={status:"active",expiresAtMs:1000,postState:"posted",botOwned:true,messageId:id,channelId:channel};
const token="local-fake-not-a-real-token-12345";
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
 assert.equal(planCleanup({...row,postState:"pending"},{now:2000}).action,"none");
});
test("transport is disabled by default and only deletes confirmed fixed-channel post",async()=>{
 let calls=0;
 const disabled=makeMessageCleanupTransport({fetchFn:async()=>{calls++;throw Error("Unexpected");}});
 await assert.rejects(disabled.removeConfirmedBotPost({action:"delete",channelId:channel,messageId:id}),/disabled/);
 assert.equal(calls,0);
 const enabled=makeMessageCleanupTransport({enabled:true,botToken:token,channelId:channel,
  fetchFn:async(url,opt)=>{
   calls++;assert.equal(url,"https://discord.com/api/v10/channels/"+channel+"/messages/"+id);
   assert.equal(opt.method,"DELETE");return {status:204};
  }});
 assert.equal((await enabled.removeConfirmedBotPost(planCleanup(row,{now:2000}))).status,"deleted");
 assert.equal(calls,1);
 await assert.rejects(enabled.removeConfirmedBotPost({action:"delete",channelId:"999999999999999999",messageId:id}),/Unverified/);
 assert.equal(calls,1);
});
test("only verified absence is terminal, errors remain unresolved",async()=>{
 const missing=makeMessageCleanupTransport({enabled:true,botToken:token,channelId:channel,fetchFn:async()=>({status:404})});
 assert.equal((await missing.removeConfirmedBotPost(planCleanup(row,{now:2000}))).status,"already_absent");
 const unknown=makeMessageCleanupTransport({enabled:true,botToken:token,channelId:channel,fetchFn:async()=>({status:429})});
 await assert.rejects(unknown.removeConfirmedBotPost(planCleanup(row,{now:2000})),/reconciliation/);
});
