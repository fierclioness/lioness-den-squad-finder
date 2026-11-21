import test from "node:test";
import assert from "node:assert/strict";
import {makeCleanupOutboxWorker} from "./cleanup-outbox-worker.mjs";
import {makeVerifiedBotCleanup} from "./verified-bot-cleanup.mjs";
const channelId="1546529497925296199",botUserId="1546529501859815438";
const messageId="1546529501859815439";
const workerId="11111111-1111-4111-8111-111111111111";
const reference="9ff00490-3730-4390-8c87-80f0aaffc231";
const receipt=()=>({
 listing_id:"8",message_id:messageId,channel_id:channelId,bot_user_id:botUserId,
 receipt_message_id:messageId,receipt_channel_id:channelId,receipt_bot_user_id:botUserId,
 listing_status:"closed",expires_at:"2026-12-01T00:00:00.000Z",post_reference:reference
});
function fixture({rec=receipt(),remove=async()=>({status:"deleted"}),failFinish=false,throwFinish=false}={}){
 let claimed=false,finished=[],selected=0,claims=0;
 const query=async(sql,params)=>{
  if(sql.includes("claim_cleanup")){
   claims++;
   if(claimed)return {rows:[{listing_id:null}]};
   claimed=true;return {rows:[{listing_id:"8"}]};
  }
  if(sql.includes("from matchmaker_internal.cleanup_outbox")){
   selected++;
   assert.deepEqual(params,["8",workerId]);
   return {rows:rec?[rec]:[]};
  }
  if(sql.includes("finish_cleanup")){
   finished.push(params);
   if(throwFinish)throw Error("private database unavailable");
   return {rows:[{ok:!failFinish}]};
  }
  throw Error("Unexpected SQL");
 };
 return {
  worker:makeCleanupOutboxWorker({query,verifiedCleanup:{remove},channelId,botUserId,enabled:true,
    newWorkerId:()=>workerId,clock:()=>new Date("2026-11-19T00:00:00Z").valueOf()}),
  state:()=>({claimed,claims,selected,finished})
 };
}
test("disabled cleanup worker does not contact DB or Discord",async()=>{
 let calls=0;
 const worker=makeCleanupOutboxWorker({enabled:false,query:async()=>{calls++;throw Error("Unexpected");},
  verifiedCleanup:{remove:async()=>{calls++;throw Error("Unexpected");}}});
 assert.deepEqual(await worker.runOnce(),{status:"disabled"});
 assert.equal(calls,0);
 assert.throws(()=>makeCleanupOutboxWorker({enabled:true,channelId,botUserId,query:async()=>{},verifiedCleanup:{}}),/Trusted/);
 assert.throws(()=>makeCleanupOutboxWorker({enabled:true,channelId:"bad",botUserId,query:async()=>{},verifiedCleanup:{remove:async()=>{}}}),/fixed/);
});
test("after verified bot-only GET, one pending job is deleted exactly once",async()=>{
 let methods=[];
 const verified=makeVerifiedBotCleanup({enabled:true,channelId,botUserId,
  botToken:"testing-only-not-real-bot-secret-0123",fetchFn:async(_url,init)=>{
    methods.push(init.method);
    return init.method==="GET"?{status:200,json:async()=>({
      id:messageId,channel_id:channelId,author:{id:botUserId,bot:true},
      content:"🔎 Den ref: "+reference
    })}:{status:204};
  }});
 const fx=fixture({remove:verified.remove});
 assert.deepEqual(await fx.worker.runOnce(),{status:"deleted",listingId:"8"});
 assert.deepEqual(methods,["GET","DELETE"]);
 assert.deepEqual(fx.state().finished,[["8",workerId,true]]);
 assert.deepEqual(await fx.worker.runOnce(),{status:"empty"});
 assert.deepEqual(methods,["GET","DELETE"]);
});
test("active unexpired listing and mismatched original receipt are quarantined before DELETE",async()=>{
 for(const rec of [
  {...receipt(),listing_status:"active"},
  {...receipt(),receipt_message_id:"1546529501859815440"},
  {...receipt(),receipt_channel_id:"999999999999999999"},
  {...receipt(),receipt_bot_user_id:"999999999999999999"},
  {...receipt(),post_reference:null},
  {...receipt(),post_reference:"not-a-uuid"},
  null
 ]){
  let deletes=0;
  const fx=fixture({rec,remove:async()=>{deletes++;return {status:"deleted"};}});
  assert.deepEqual(await fx.worker.runOnce(),{status:"quarantined",listingId:"8"});
  assert.equal(deletes,0);
  assert.deepEqual(fx.state().finished,[["8",workerId,false]]);
 }
});
test("uncertain Discord deletion is quarantined with zero automatic retries",async()=>{
 let attempts=0;
 const fx=fixture({remove:async()=>{attempts++;throw Error("Timeout after DELETE request");}});
 assert.deepEqual(await fx.worker.runOnce(),{status:"uncertain",listingId:"8"});
 assert.deepEqual(await fx.worker.runOnce(),{status:"empty"});
 assert.equal(attempts,1);
 assert.deepEqual(fx.state().finished,[["8",workerId,false]]);
});
test("verified post already absent is terminal; failed DB persistence requires manual review",async()=>{
 const absent=fixture({remove:async()=>({status:"already_absent"})});
 assert.deepEqual(await absent.worker.runOnce(),{status:"already_absent",listingId:"8"});
 assert.deepEqual(absent.state().finished,[["8",workerId,true]]);
 const failed=fixture({failFinish:true,remove:async()=>({status:"deleted"})});
 await assert.rejects(failed.worker.runOnce(),/Cleanup ledger state unconfirmed; manual reconciliation required/);
 assert.deepEqual(failed.state().finished,[["8",workerId,true]]);
});

test("failed quarantine acknowledgement never reports success or retries finish",async()=>{
 for(const options of [{failFinish:true},{throwFinish:true}]){
  let deletes=0;
  const fx=fixture({...options,rec:null,remove:async()=>{
   deletes++;return {status:"deleted"};
  }});
  await assert.rejects(fx.worker.runOnce(),/Cleanup ledger state unconfirmed; manual reconciliation required/);
  assert.equal(deletes,0,"untrusted original receipt must never trigger Discord deletion");
  assert.deepEqual(fx.state().finished,[["8",workerId,false]],
   "one failed database quarantine must not trigger a speculative second write");
 }
});
test("uncertain Discord deletion with failed quarantine acknowledgement requires manual review",async()=>{
 for(const options of [{failFinish:true},{throwFinish:true}]){
  let deletes=0;
  const fx=fixture({...options,remove:async()=>{
   deletes++;throw Error("timeout after Discord DELETE request");
  }});
  await assert.rejects(fx.worker.runOnce(),/Cleanup ledger state unconfirmed; manual reconciliation required/);
  assert.equal(deletes,1,"ambiguous Discord DELETE is never retried");
  assert.deepEqual(fx.state().finished,[["8",workerId,false]]);
 }
});

test("imprecise numeric/boxed Discord receipts never authorize removal",async()=>{
 for(const badId of [Number(messageId),BigInt(messageId),new String(messageId)]){
  let deletes=0;
  // Simulate the same malformed ID in both private receipt and cleanup row,
  // which previously passed a String(...) snowflake check and strict equality.
  const rec={...receipt(),message_id:badId,receipt_message_id:badId};
  const fx=fixture({rec,remove:async()=>{deletes++;return {status:"deleted"};}});
  assert.deepEqual(await fx.worker.runOnce(),{status:"quarantined",listingId:"8"});
  assert.equal(deletes,0);
  assert.deepEqual(fx.state().finished,[["8",workerId,false]]);
 }
 const query=async()=>{throw Error("No query expected");};
 const verifiedCleanup={remove:async()=>{throw Error("No DELETE expected");}};
 for(const id of [Number(channelId),BigInt(channelId),new String(channelId)]){
  assert.throws(()=>makeCleanupOutboxWorker({
   query,verifiedCleanup,enabled:true,channelId:id,botUserId
  }),/Trusted fixed/);
 }
 for(const id of [Number(botUserId),BigInt(botUserId),new String(botUserId)]){
  assert.throws(()=>makeCleanupOutboxWorker({
   query,verifiedCleanup,enabled:true,channelId,botUserId:id
  }),/Trusted fixed/);
 }
});

test("rounded or noncanonical cleanup listing claims never reach Discord",async()=>{
 const badIds=[8,Number("9007199254740993"),8n,new String("8"),
  "0","08","8e0","9223372036854775808",{}];
 for(const listing_id of badIds){
  let queries=0,removals=0;
  const worker=makeCleanupOutboxWorker({
   enabled:true,channelId,botUserId,newWorkerId:()=>workerId,
   query:async(sql)=>{
    queries++;
    if(sql.includes("claim_cleanup"))return {rows:[{listing_id}]};
    throw Error("Untrusted claim reached a private cleanup query");
   },
   verifiedCleanup:{remove:async()=>{removals++;throw Error("Unsafe Discord DELETE");}}
  });
  await assert.rejects(worker.runOnce(),/Untrusted claimed cleanup id/);
  assert.equal(queries,1,"no lookup or ledger mutation for an invalid claim");
  assert.equal(removals,0,"never DELETE from a malformed database claim");
 }
});
test("rounded original receipt listing IDs cannot authorize Discord cleanup",async()=>{
 for(const badId of [8,8n,new String("8")]){
  let removals=0;
  const fx=fixture({rec:{...receipt(),listing_id:badId},
   remove:async()=>{removals++;return {status:"deleted"};}});
  assert.deepEqual(await fx.worker.runOnce(),{status:"quarantined",listingId:"8"});
  assert.equal(removals,0);
  assert.deepEqual(fx.state().finished,[["8",workerId,false]]);
 }
});

test("cleanup sends the trusted persisted listing reference, never a caller-supplied marker",async()=>{
 let received=null;
 const fx=fixture({remove:async(id,ref)=>{
  received={id,ref};return {status:"deleted"};
 }});
 assert.equal((await fx.worker.runOnce()).status,"deleted");
 assert.deepEqual(received,{id:messageId,ref:reference});
});
