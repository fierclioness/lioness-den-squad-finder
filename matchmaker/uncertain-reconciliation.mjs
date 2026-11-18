// Review-only reconciliation decision engine. Does NOT send, retry or delete messages.
// Missing a message from a channel search does NOT prove it was never posted.
// A receipt may be accepted only after verifying the exact original message,
// destination and expected bot author; an operator must approve the action.
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
 // Listing identity is NOT established by content similarity or date alone.
 // A signed, private post token embedded by the bot, or a durable trusted
 // receipt binding, must be verified out of band before invoking a DB resolver.
 if(message.boundListingId==null||String(message.boundListingId)!==String(listing.id))
  return {decision:"manual_review",reason:"Posting identity is not cryptographically or durably bound to this listing"};
 if(operatorApproved!==true)
  return {decision:"approval_required",reason:"A verified receipt still requires explicit reconciliation approval"};
 return {decision:"record_confirmed_receipt",listingId:String(listing.id),
   messageId:String(message.id),channelId,botUserId,
   cleanupRequired:listing.status!=="active" || Date.parse(listing.expiresAt)<=Date.now()};
}
export function assessNotFoundEvidence({searchComplete=false}={}){
 // Even a thorough history lookup can miss deleted messages or eventual consistency.
 return {decision:"manual_review",safeToRetry:false,
  reason:searchComplete?"Historical absence is not proof Discord never accepted the post":"Channel lookup incomplete"};
}
