import test from "node:test";
import assert from "node:assert/strict";
import {assessUncertainDelivery,assessNotFoundEvidence} from "./uncertain-reconciliation.mjs";
const listing={id:"27",post_reference:"5d6e21e8-2637-4f6d-91b6-a51549a087e5",status:"closed",expiresAt:"2026-12-01T00:00:00Z"};
const outbox={listingId:"27",state:"uncertain",claimedBy:null};
const channelId="1546529497925296199",botUserId="1546529501859815438";
const message={id:"1546529501859815445",channel_id:channelId,
 author:{id:botUserId,bot:true},content:"🎮 Call of Duty\n🔎 Den ref: 5d6e21e8-2637-4f6d-91b6-a51549a087e5"};
const check=(overrides={})=>assessUncertainDelivery({listing,outbox,message,channelId,botUserId,...overrides});
test("missing message cannot authorize a resend even after complete search",()=>{
 assert.equal(check({message:null}).decision,"manual_review");
 assert.equal(assessNotFoundEvidence({searchComplete:true}).safeToRetry,false);
 assert.equal(assessNotFoundEvidence().safeToRetry,false);
});
test("never reconcile a member's message, other bot or wrong channel",()=>{
 assert.equal(check({message:{...message,author:{id:"1418199180287148073",bot:false}}}).decision,"block");
 assert.equal(check({message:{...message,channel_id:"999999999999999999"}}).decision,"block");
 assert.equal(check({message:{...message,author:{id:"1546529501859815440",bot:true}}}).decision,"block");
});
test("matching message content is insufficient to identify a listing",()=>{
 assert.equal(check({message:{...message,content:"🎮 Call of Duty"}}).decision,"manual_review");
 assert.equal(check({message:{...message,content:"🎮 Call of Duty\n🔎 Den ref: 11111111-1111-4111-8111-111111111111"}}).decision,"manual_review");
});
test("explicit approval and verified binding required before recording",()=>{
 assert.equal(check().decision,"approval_required");
 const result=check({operatorApproved:true});
 assert.equal(result.decision,"record_confirmed_receipt");
 assert.equal(result.cleanupRequired,true);
 assert.equal(result.messageId,message.id);
});
test("wrong listing, non-unresolved and invalid worker claims rejected",()=>{
 assert.equal(check({outbox:{...outbox,state:"posted"}}).decision,"no_action");
 assert.equal(check({outbox:{...outbox,listingId:"30"}}).decision,"block");
 assert.equal(check({outbox:{...outbox,claimedBy:"not-a-uuid"}}).decision,"block");
});

// A recovered bot-owned post must not be accepted with an unknowable lifetime:
// NaN expiration would otherwise silently suppress a required cleanup.
test("uncertain delivery reconciliation blocks missing lifecycle or expiry evidence",()=>{
 for(const expiresAt of [undefined,null,"invalid date",0,Number.NaN,new Date(NaN)]){
  const result=check({listing:{...listing,status:"active",expiresAt},operatorApproved:true});
  assert.equal(result.decision,"block","Invalid expiry must block receipt reconciliation");
  assert.equal(result.cleanupRequired,undefined,"Do not report cleanup as unnecessary");
 }
 for(const status of [undefined,null,"pending","unexpected"]){
  const result=check({listing:{...listing,status},operatorApproved:true});
  assert.equal(result.decision,"block","Unknown lifecycle cannot authorize reconciliation");
 }
});
test("verified active receipt requires cleanup on expired timestamp only",()=>{
 const future=check({listing:{...listing,status:"active",expiresAt:"2099-12-01T00:00:00Z"},operatorApproved:true});
 assert.equal(future.decision,"record_confirmed_receipt");
 assert.equal(future.cleanupRequired,false);
 const overdue=check({listing:{...listing,status:"active",expiresAt:"2000-01-01T00:00:00Z"},operatorApproved:true});
 assert.equal(overdue.decision,"record_confirmed_receipt");
 assert.equal(overdue.cleanupRequired,true);
 const dateObject=check({listing:{...listing,status:"active",expiresAt:new Date("2000-01-01T00:00:00Z")},operatorApproved:true});
 assert.equal(dateObject.cleanupRequired,true);
});

test("uncertain receipts reject imprecise numeric and boxed Discord snowflakes",()=>{
 // This gate can be called by an operator-assisted recovery flow.
 // Even a correctly bound reference + approval cannot trust a rounded ID.
 for(const badId of [Number(message.id),BigInt(message.id),new String(message.id)]){
  const result=check({message:{...message,id:badId},operatorApproved:true});
  assert.equal(result.decision,"block");
  assert.equal(result.messageId,undefined);
 }
 for(const badAuthor of [Number(botUserId),BigInt(botUserId),new String(botUserId)]){
  const result=check({message:{...message,author:{id:badAuthor,bot:true}},operatorApproved:true});
  assert.equal(result.decision,"block");
 }
 for(const badChannel of [Number(channelId),BigInt(channelId),new String(channelId)]){
  const result=check({message:{...message,channel_id:badChannel},operatorApproved:true});
  assert.equal(result.decision,"block");
 }
 assert.throws(()=>check({channelId:Number(channelId),botUserId:Number(botUserId),operatorApproved:true}),/Trusted reconciliation context/);
 assert.throws(()=>check({channelId:new String(channelId),operatorApproved:true}),/Trusted reconciliation context/);
 assert.throws(()=>check({botUserId:BigInt(botUserId),operatorApproved:true}),/Trusted reconciliation context/);
 const verified=check({operatorApproved:true});
 assert.equal(verified.decision,"record_confirmed_receipt");
 assert.equal(verified.messageId,message.id);
});


test("operator-assisted recovery cannot coerce or round PostgreSQL bigint listing identities",()=>{
 const valid=check({operatorApproved:true});
 assert.equal(valid.decision,"record_confirmed_receipt");
 assert.equal(valid.listingId,"27");
 // Keep large signed int8 identifiers as exact canonical strings, including at
 // the operator boundary. A JS Number cannot safely preserve 19-digit int8 IDs.
 const large="9007199254740993";
 assert.equal(check({listing:{...listing,id:large},
   outbox:{...outbox,listingId:large},operatorApproved:true}).decision,"record_confirmed_receipt");
 for(const invalid of [27,27n,new Number(27),new String("27"),
   {toString:()=>"27"},"027","0","-1","9223372036854775808",
   Number(large),BigInt(large),undefined,null]){
  for(const side of ["listing","outbox"]){
   const changed=side==="listing"
     ?{listing:{...listing,id:invalid}}
     :{outbox:{...outbox,listingId:invalid}};
   const result=check({...changed,operatorApproved:true});
   assert.equal(result.decision,"block",side+" must reject untrusted listing identity");
   assert.equal(result.messageId,undefined,"No receipt can be recorded");
  }
 }
 // Distinct exact strings cannot collide via rounded Number conversion.
 assert.equal(check({listing:{...listing,id:large},
   outbox:{...outbox,listingId:"9007199254740992"},operatorApproved:true}).decision,"block");
});
