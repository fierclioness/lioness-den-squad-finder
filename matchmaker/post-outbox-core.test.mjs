import test from "node:test";
import assert from "node:assert/strict";
import {newOutbox,claimPost,confirmPost,markPostFailure,cancelOutbox,canAutoRetry,requiresManualReconciliation} from "./post-outbox-core.mjs";
const ownerId="1418199180287148073",messageId="1546529501859815438",listingId="example-listing-1";
test("publish requires claim and valid Discord message evidence",()=>{
 const p=newOutbox({listingId,ownerId,now:1000});
 assert.equal(p.state,"pending");
 const sending=claimPost(p,{workerId:"worker-1",now:1001});
 assert.equal(sending.attempts,1);
 assert.throws(()=>confirmPost(p,{workerId:"worker-1",messageId}),/owning/);
 assert.throws(()=>confirmPost(sending,{workerId:"worker-2",messageId}),/owning/);
 const sent=confirmPost(sending,{workerId:"worker-1",messageId,now:1002});
 assert.equal(sent.state,"posted");
 assert.equal(sent.messageId,messageId);
 assert.throws(()=>claimPost(sent,{workerId:"worker-1"}),/Not safe/);
 assert.throws(()=>cancelOutbox(sent),/reconcile/);
});
test("ambiguous network failure is NEVER automatically retried",()=>{
 const p=claimPost(newOutbox({listingId,ownerId}),{workerId:"worker-1"});
 const uncertain=markPostFailure(p,{workerId:"worker-1",reason:"timeout"});
 assert.equal(uncertain.state,"uncertain");
 assert.equal(canAutoRetry(uncertain),false);
 assert.equal(requiresManualReconciliation(uncertain),true);
 assert.throws(()=>claimPost(uncertain,{workerId:"worker-2"}),/Not safe/);
 assert.throws(()=>cancelOutbox(uncertain),/reconcile/);
});
test("definitively unsent requests allow bounded retry",()=>{
 const start=claimPost(newOutbox({listingId,ownerId}),{workerId:"w"});
 const failed=markPostFailure(start,{workerId:"w",definitelyNotPosted:true});
 assert.equal(failed.state,"failed");
 assert.equal(canAutoRetry(failed),true);
 const again=claimPost(failed,{workerId:"w2"});
 assert.equal(again.attempts,2);
 assert.throws(()=>markPostFailure(again,{workerId:"w"}),/owning/);
 const final=markPostFailure(claimPost(markPostFailure(again,{workerId:"w2",definitelyNotPosted:true}),{workerId:"w3"}),{workerId:"w3",definitelyNotPosted:true});
 assert.equal(final.attempts,3);
 assert.equal(canAutoRetry(final),false);
 assert.throws(()=>claimPost(final,{workerId:"w4"}),/Manual review/);
});
test("unpublished request may be cancelled",()=>{
 const pending=newOutbox({listingId,ownerId});
 assert.equal(cancelOutbox(pending).state,"cancelled");
 assert.throws(()=>claimPost(cancelOutbox(pending),{workerId:"w"}));
 assert.throws(()=>newOutbox({listingId,ownerId:"someone"}),/identity/);
});

test("offline outbox refuses imprecise numeric or coerced Discord owner identities",()=>{
 for(const invalid of [Number(ownerId),BigInt(ownerId),new String(ownerId),{toString:()=>ownerId},null,undefined]){
  assert.throws(()=>newOutbox({listingId,ownerId:invalid}),/identity/);
 }
 assert.equal(newOutbox({listingId,ownerId}).ownerId,ownerId);
});
