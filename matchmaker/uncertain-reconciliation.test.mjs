import test from "node:test";
import assert from "node:assert/strict";
import {assessUncertainDelivery,assessNotFoundEvidence} from "./uncertain-reconciliation.mjs";
const listing={id:"27",status:"closed",expiresAt:"2026-12-01T00:00:00Z"};
const outbox={listingId:"27",state:"uncertain",claimedBy:null};
const channelId="1546529497925296199",botUserId="1546529501859815438";
const message={id:"1546529501859815445",channel_id:channelId,
 author:{id:botUserId,bot:true},boundListingId:"27"};
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
 assert.equal(check({message:{...message,boundListingId:null}}).decision,"manual_review");
 assert.equal(check({message:{...message,boundListingId:"28"}}).decision,"manual_review");
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
