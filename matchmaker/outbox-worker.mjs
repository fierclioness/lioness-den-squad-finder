// Review-only one-item Matchmaker publisher. NO built-in network API or bot token.
// Production requires a trusted, injected Discord transport and audited feature gate.
// Ambiguous delivery is quarantined, never automatically retried.
const SNOW=/^\d{15,22}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
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
     /(?:@everyone|@here|<@|https?:\/\/|discord\.gg)/i.test(listing[k]))
   throw Error("Unsafe listing value");
  return listing[k].replace(/[\r\n]/g," ");
 });
 return "👑 **Looking for a squad?**\n🎮 "+out[0]+"\n"+
  "🎯 "+out[1]+" · "+out[2]+"\n🎙️ "+out[3]+
  "\n🌎 "+out[4]+"\n🕒 "+out[5]+
  "\nUse the Den's #squad-up channel to connect. Listings expire after 36 hours.";
}
export function makeOutboxWorker({query,sendMessage,enabled=false,newWorkerId=()=>crypto.randomUUID()}){
 if(typeof query!=="function")throw Error("Trusted database query required");
 if(typeof sendMessage!=="function")throw Error("Trusted Discord transport required");
 if(typeof enabled!=="boolean")throw Error("Invalid publish flag");
 async function call(sql,params){return row(await query(sql,params));}
 async function runOnce(){
  if(!enabled)return {status:"disabled"};
  const workerId=newWorkerId();
  if(typeof workerId!=="string"||!UUID.test(workerId))throw Error("Invalid worker identity");
  const result=await call("select matchmaker_internal.claim_post($1::uuid) as id",[workerId]);
  if(result?.id==null)return {status:"empty"};
  const listingId=String(result.id);
  // Fetch only a still-active listing; do not send stale/closed requests.
  let confirmed=false;
  try {
   const listing=await call(
    "select game,platform,vibe,mic,timezone,availability from matchmaker_internal.squad_listings where id=$1::bigint and status='active' and expires_at>clock_timestamp()",
    [listingId]);
   if(!listing){
     await call("select matchmaker_internal.fail_post($1::bigint,$2::uuid,$3::boolean,$4::text) as ok",
       [listingId,workerId,true,"Listing is no longer active"]);
     return {status:"unsent",listingId};
   }
   const content=listingToMessage(listing);
   // sendMessage MUST use an audited destination, allow_mentions parse [], and
   // classify uncertain network failures conservatively.
   const sent=await sendMessage({content,allowed_mentions:{parse:[]}});
   if(!sent||sent.confirmed!==true||!SNOW.test(String(sent.messageId||"")))
    throw Error("Discord delivery could not be confirmed");
   confirmed=true;
   const done=await call(
    "select matchmaker_internal.finish_post($1::bigint,$2::uuid,$3::text) as ok",
    [listingId,workerId,String(sent.messageId)]);
   if(done?.ok!==true)throw Error("Could not record Discord confirmation");
   return {status:"posted",listingId,messageId:String(sent.messageId)};
  }catch(error){
    // If confirmation was received but persisting it failed, DO NOT retry.
    // The row will remain "sending" and needs manual reconciliation.
    if(confirmed)throw Error("Delivery confirmed but persistence uncertain; manual reconciliation required");
    // Network timeout or other errors may represent a successful post.
    await call("select matchmaker_internal.fail_post($1::bigint,$2::uuid,$3::boolean,$4::text) as ok",
      [listingId,workerId,false,"Delivery uncertain; manual reconciliation required"]);
    return {status:"uncertain",listingId};
  }
 }
 return Object.freeze({runOnce});
}
