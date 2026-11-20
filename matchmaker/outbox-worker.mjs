// Review-only one-item Matchmaker publisher. NO built-in network API or bot token.
// Production requires a trusted, injected Discord transport and audited feature gate.
// Ambiguous delivery is quarantined, never automatically retried.
// All Discord snowflakes must be primitive strings: do not round numeric receipts.
import {markerFor} from "./listing-reference.mjs";
const SNOW=/^\d{15,22}$/;
const exactSnow=value=>typeof value==="string"&&SNOW.test(value);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// PostgreSQL bigint listing IDs must also stay exact strings; Number can round
// an int8 claim and accidentally operate on a different persisted listing.
const exactListingId=value=>typeof value==="string" && /^[1-9]\d{0,18}$/.test(value) &&
  BigInt(value)<=9223372036854775807n;
class UnconfirmedOutboxState extends Error {}
function row(result){
 if(!result||!Array.isArray(result.rows))throw Error("Invalid private query result");
 return result.rows[0]||null;
}
function listingToMessage(listing){
 if(!listing || typeof listing.game!=="string" || typeof listing.platform!=="string")
  throw Error("Missing safe listing");
 // The public message contains only voluntary game preferences, never an ID.
 const fields=["game","platform","vibe","mic","timezone","availability"];
 const out=fields.map(k=>{
  if(typeof listing[k]!=="string"||listing[k].length>80||
     /(?:@everyone|@here|<@|<#|https?:\/\/|discord\.gg)/i.test(listing[k]))
   throw Error("Unsafe listing value");
  return listing[k].replace(/[\r\n]/g," ");
 });
 const reference=markerFor(listing.post_reference);
 return "👑 **Looking for a squad?**\n🎮 "+out[0]+"\n"+
  "🎯 "+out[1]+" · "+out[2]+"\n🎙️ "+out[3]+
  "\n🌎 "+out[4]+"\n🕒 "+out[5]+
  "\nUse the Den's #squad-up channel to connect. Listings expire after 36 hours.\n"+reference;
}
export function makeOutboxWorker({query,sendMessage,channelId,botUserId,enabled=false,newWorkerId=()=>crypto.randomUUID()}){
 if(typeof query!=="function")throw Error("Trusted database query required");
 if(typeof sendMessage!=="function")throw Error("Trusted Discord transport required");
 if(typeof enabled!=="boolean")throw Error("Invalid publish flag");
 if(enabled && (!exactSnow(channelId)||!exactSnow(botUserId)))
  throw Error("Trusted configured channel and bot identity required");
 async function call(sql,params){return row(await query(sql,params));}
 async function runOnce(){
  if(!enabled)return {status:"disabled"};
  const workerId=newWorkerId();
  if(typeof workerId!=="string"||!UUID.test(workerId))throw Error("Invalid worker identity");
  const result=await call("select matchmaker_internal.claim_post($1::uuid) as id",[workerId]);
  if(result?.id==null)return {status:"empty"};
  if(!exactListingId(result.id))throw Error("Untrusted claimed post listing ID");
  const listingId=result.id;
  // Fetch only a still-active listing; do not send stale/closed requests.
  let confirmed=false;
  try {
   const listing=await call(
    "select game,platform,vibe,mic,timezone,availability,post_reference from matchmaker_internal.squad_listings where id=$1::bigint and status='active' and expires_at>clock_timestamp()",
    [listingId]);
   if(!listing){
     const stopped=await call("select matchmaker_internal.fail_post($1::bigint,$2::uuid,$3::boolean,$4::text) as ok",
       [listingId,workerId,true,"Listing is no longer active"]);
     if(stopped?.ok!==true)
       throw new UnconfirmedOutboxState("Unsent state not committed; manual reconciliation required");
     return {status:"unsent",listingId};
   }
   const content=listingToMessage(listing);
   // sendMessage MUST use an audited destination, allow_mentions parse [], and
   // classify uncertain network failures conservatively.
   const sent=await sendMessage({content,allowed_mentions:{parse:[]}});
   if(!sent||sent.confirmed!==true||!exactSnow(sent.messageId)||
      sent.channelId!==channelId || sent.botUserId!==botUserId)
    throw Error("Discord delivery could not be confirmed");
   confirmed=true;
   const done=await call(
    "select matchmaker_internal.finish_post_with_receipt($1::bigint,$2::uuid,$3::text,$4::text,$5::text) as result",
    [listingId,workerId,sent.messageId,channelId,botUserId]);
   if(!["posted_active","posted_cleanup_queued"].includes(done?.result))
    throw Error("Could not record trusted Discord receipt");
   return {status:done.result==="posted_active"?"posted":"posted_cleanup_queued",listingId,messageId:sent.messageId};
  }catch(error){
    // A false/absent database safety acknowledgement must never be reported as
    // successful quarantine. Do not attempt a second state transition here.
    if(error instanceof UnconfirmedOutboxState)throw error;
    // If confirmation was received but persisting it failed, DO NOT retry.
    // The row will remain "sending" and needs manual reconciliation.
    if(confirmed)throw Error("Delivery confirmed but persistence uncertain; manual reconciliation required");
    // Network timeout or other errors may represent a successful post.
    const quarantined=await call("select matchmaker_internal.fail_post($1::bigint,$2::uuid,$3::boolean,$4::text) as ok",
      [listingId,workerId,false,"Delivery uncertain; manual reconciliation required"]);
    if(quarantined?.ok!==true)
      throw new UnconfirmedOutboxState("Post quarantine not committed; manual reconciliation required");
    return {status:"uncertain",listingId};
  }
 }
 return Object.freeze({runOnce});
}
