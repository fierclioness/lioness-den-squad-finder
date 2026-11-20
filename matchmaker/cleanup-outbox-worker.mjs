// REVIEW ONLY — durable, one-item original-bot cleanup orchestrator.
// No network implementation, no credentials, no scheduling, no live Discord calls.
// The injected verifiedCleanup MUST be makeVerifiedBotCleanup (fixed channel, GET
// message/author verification before DELETE). Never trust listing/user input.
class UnconfirmedCleanupState extends Error {}
const SNOW=/^\d{15,22}$/;
const exactSnow=value=>typeof value==="string"&&SNOW.test(value);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = result => {
 if(!result || !Array.isArray(result.rows)) throw Error("Invalid trusted DB result");
 return result.rows[0]??null;
};
export function makeCleanupOutboxWorker({
 query,verifiedCleanup,channelId,botUserId,
 enabled=false,newWorkerId=()=>crypto.randomUUID(),clock=()=>Date.now()
}){
 if(typeof query!=="function"||typeof verifiedCleanup?.remove!=="function"||
    typeof newWorkerId!=="function"||typeof clock!=="function"||typeof enabled!=="boolean")
  throw Error("Trusted private cleanup connector, clock, and feature gate required");
 if(enabled && (!exactSnow(channelId)||!exactSnow(botUserId)))
  throw Error("Trusted fixed Discord channel and original bot identity required");
 const call=async(sql,params)=>one(await query(sql,params));
 const finish=async(listingId,workerId,confirmed)=>{
  // Never speculate that cleanup was quarantined or finished if the
  // private database did not confirm the transition. A retry here could
  // overwrite a durable outcome or hide an earlier acknowledgement failure.
  let acknowledged;
  try{
   const row=await call("select matchmaker_internal.finish_cleanup($1::bigint,$2::uuid,$3::boolean) as ok",
    [listingId,workerId,confirmed]);
   acknowledged=row?.ok===true;
  }catch{
   throw new UnconfirmedCleanupState("Cleanup ledger state unconfirmed; manual reconciliation required");
  }
  if(!acknowledged)
   throw new UnconfirmedCleanupState("Cleanup ledger state unconfirmed; manual reconciliation required");
 };
 async function runOnce(){
  if(!enabled)return {status:"disabled"};
  const workerId=newWorkerId();
  if(typeof workerId!=="string"||!UUID.test(workerId))throw Error("Invalid cleanup worker id");
  const claim=await call("select matchmaker_internal.claim_cleanup($1::uuid) as listing_id",[workerId]);
  if(claim?.listing_id==null)return {status:"empty"};
  const listingId=String(claim.listing_id);
  if(!/^\d+$/.test(listingId))throw Error("Untrusted claimed cleanup id");
  let confirmedAbsent=false;
  try{
   // Compare the claimed job to the ORIGINAL trusted receipt and listing state.
   // Do not delete a guessed message or any message of a different bot/channel.
   const rec=await call(
    "select c.listing_id,c.message_id,c.channel_id,c.bot_user_id, "+
    "r.discord_message_id as receipt_message_id,r.channel_id as receipt_channel_id, "+
    "r.bot_user_id as receipt_bot_user_id,s.status as listing_status,s.expires_at "+
    "from matchmaker_internal.cleanup_outbox c "+
    "join matchmaker_internal.squad_listings s on s.id=c.listing_id "+
    "left join matchmaker_internal.post_receipts r on r.listing_id=c.listing_id "+
    "where c.listing_id=$1::bigint and c.state='claimed' and c.claimed_by=$2::uuid",
    [listingId,workerId]);
   const expired=rec?.expires_at!=null && Number.isFinite(Date.parse(String(rec.expires_at))) &&
     Date.parse(String(rec.expires_at))<=clock();
   const inactive=rec?.listing_status==="closed"||rec?.listing_status==="expired"||expired;
   const safe=rec&&String(rec.listing_id)===listingId&&inactive &&
     exactSnow(rec.message_id) &&
     rec.message_id===rec.receipt_message_id &&
     rec.channel_id===channelId && rec.receipt_channel_id===channelId &&
     rec.bot_user_id===botUserId && rec.receipt_bot_user_id===botUserId;
   if(!safe){
    await finish(listingId,workerId,false);
    return {status:"quarantined",listingId};
   }
   // The verifiedCleanup transport separately GETs this exact original
   // message and checks immutable ID/channel/bot authorship before DELETE.
   const removal=await verifiedCleanup.remove(rec.message_id);
   if(!["deleted","already_absent"].includes(removal?.status))
    throw Error("Discord deletion outcome not verified");
   confirmedAbsent=true;
   await finish(listingId,workerId,true);
   return {status:removal.status==="deleted"?"deleted":"already_absent",listingId};
  }catch(error){
   // A failed safety acknowledgement must propagate without a second
   // speculative finish_cleanup attempt or a misleading "uncertain" success.
   if(error instanceof UnconfirmedCleanupState)throw error;
   if(confirmedAbsent)
    throw Error("Discord absence confirmed but DB receipt uncertain; operator reconciliation required");
   // A timed-out DELETE may already have succeeded. Quarantine, NEVER retry.
   await finish(listingId,workerId,false);
   return {status:"uncertain",listingId};
  }
 }
 return Object.freeze({runOnce});
}
