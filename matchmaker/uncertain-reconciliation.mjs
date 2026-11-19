// Review-only reconciliation decision engine. Does NOT send, retry or delete messages.
// Missing a message from a channel search does NOT prove it was never posted.
// A receipt may be accepted only after verifying the exact original message,
// destination and expected bot author; an operator must approve the action.
import {verifyReferenceMatch} from "./listing-reference.mjs";
const snow=/^\d{15,22}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assessUncertainDelivery({listing,outbox,message,channelId,botUserId,operatorApproved=false}={}){
 if(!listing||!outbox||!snow.test(String(channelId||""))||!snow.test(String(botUserId||"")))
  throw Error("Trusted reconciliation context required");
 if(!["uncertain","sending"].includes(outbox.state))
  return {decision:"no_action",reason:"Not an unresolved delivery"};
 if(outbox.listingId==null||String(outbox.listingId)!==String(listing.id))
  return {decision:"block",reason:"Listing and delivery identity mismatch"};
 if(!message)
  return {decision:"manual_review",reason:"Absence of evidence is not proof of an unsent Discord POST"};
 if(!snow.test(String(message.id||""))||message.channel_id!==channelId||
    message.author?.id!==botUserId||message.author?.bot!==true)
  return {decision:"block",reason:"Original Discord message identity not verified"};
 if(outbox.claimedBy!=null&&!uuid.test(String(outbox.claimedBy)))
  return {decision:"block",reason:"Untrusted worker claim"};
 // Only the original bot's authenticated message may supply this marker.
 // The reference comes from private PostgreSQL, not a member ID or user input.
 if(!verifyReferenceMatch(listing.post_reference,message.content))
  return {decision:"manual_review",reason:"Bot message does not contain this listing's unique persisted reference"};
 // Never mark a recovered delivery as safe without a trustworthy lifecycle.
 // In particular, Date.parse(undefined) is NaN and would silently make an
 // expired-but-unparseable ACTIVE listing appear to need no cleanup.
 if(!["active","closed","expired"].includes(listing.status))
  return {decision:"block",reason:"Listing lifecycle state is not verified"};
 const hasExpiry=typeof listing.expiresAt==="string" || listing.expiresAt instanceof Date;
 const expiresAt=hasExpiry ? Date.parse(String(listing.expiresAt)) : NaN;
 if(!Number.isFinite(expiresAt))
  return {decision:"block",reason:"Listing expiry is not verified"};
 if(operatorApproved!==true)
  return {decision:"approval_required",reason:"A verified receipt still requires explicit reconciliation approval"};
 return {decision:"record_confirmed_receipt",listingId:String(listing.id),
   messageId:String(message.id),channelId,botUserId,
   cleanupRequired:listing.status!=="active" || expiresAt<=Date.now()};
}
export function assessNotFoundEvidence({searchComplete=false}={}){
 // Even a thorough history lookup can miss deleted messages or eventual consistency.
 return {decision:"manual_review",safeToRetry:false,
  reason:searchComplete?"Historical absence is not proof Discord never accepted the post":"Channel lookup incomplete"};
}
