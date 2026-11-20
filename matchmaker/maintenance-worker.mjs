// REVIEW ONLY. Server-side private DB maintenance; no HTTP endpoint or scheduler.
// Disabled by default. Never sends/edits/deletes Discord messages or member data.
// Any future scheduled caller MUST be authenticated and explicitly authorized.
// The expiry and transient-retention RPCs MUST be independently deployed and
// approved before their respective maintenance gates can be enabled.
const positiveInt=(n,max)=>Number.isInteger(n)&&n>=1&&n<=max;
const count=(result,key,limit)=>{
 if(!result||!Array.isArray(result.rows)||result.rows.length!==1)
  throw Error("Invalid private maintenance database response");
 const raw=result.rows[0]?.[key];
 // PostgreSQL may return integer as a number or canonical decimal string.
 const value=typeof raw==="number"?raw:
   (typeof raw==="string"&&/^\d+$/.test(raw)?Number(raw):NaN);
 if(!Number.isSafeInteger(value)||value<0||value>limit)
  throw Error("Unexpected private maintenance operation count");
 return value;
};
export function makeMaintenanceWorker({
 query,enabled=false,batchSize=50,staleMinutes=10,
 transientRetentionEnabled=false
}){
 if(typeof query!=="function"||typeof enabled!=="boolean"||
    typeof transientRetentionEnabled!=="boolean")
  throw Error("Trusted private database connector and boolean feature gate required");
 if(!positiveInt(batchSize,500)||!positiveInt(staleMinutes,10080) || staleMinutes<5)
  throw Error("Unsafe maintenance batch or stale-worker minimum");
 async function runOnce(){
  if(!enabled)return {status:"disabled"};
  // Expire opt-in records before handling abandoned workers; no user calls.
  // Each RPC has its own private PostgreSQL transaction.
  const expired=count(await query(
   "select matchmaker_internal.expire_due_listings($1::integer) as affected",
   [batchSize]),"affected",batchSize);
  // Never requeue an ambiguous Discord delivery. Mark it UNCERTAIN only.
  const stalePost=count(await query(
   "select matchmaker_internal.quarantine_stale_post_claims($1::interval,$2::integer) as affected",
   [staleMinutes+" minutes",batchSize]),"affected",batchSize);
  const staleCleanup=count(await query(
   "select matchmaker_internal.quarantine_stale_cleanup_claims($1::interval,$2::integer) as affected",
   [staleMinutes+" minutes",batchSize]),"affected",batchSize);
  // Not installed on hosted staging. This separate OFF-by-default gate
  // prevents an ordinary maintenance run from calling an absent/new RPC.
  if(!transientRetentionEnabled)
   return {status:"complete",expired,stalePost,staleCleanup};
  const purged=await query(
   "select replays_purged,previews_purged from matchmaker_internal.purge_expired_transient_rows($1::integer)",
   [batchSize]);
  // Validate BOTH counts before acknowledging a successful maintenance cycle.
  const replaysPurged=count(purged,"replays_purged",batchSize);
  const previewsPurged=count(purged,"previews_purged",batchSize);
  return {status:"complete",expired,stalePost,staleCleanup,
   replaysPurged,previewsPurged};
 }
 return Object.freeze({runOnce});
}
