// Server-only PostgreSQL adapter for the private Matchmaker schema.
// Development / review branch. No connection credentials, network calls or deployments.
// The injected query(sql, params) function MUST execute using a trusted, private
// PostgreSQL connection. Never expose the adapter to browser clients.
import {validateDraft} from "./matchmaker-core.mjs";

const GUILD="1546529497925296199";
const SNOWFLAKE=/^\d{15,22}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function owner(actor){
 // The private storage adapter is a separate trust boundary. Do not coerce
 // numeric, BigInt or boxed Discord snowflakes: precision loss could cause
 // a direct caller to read or mutate a different member's listing.
 if(!actor || actor.guildId!==GUILD || typeof actor.memberId!=="string" ||
    !SNOWFLAKE.test(actor.memberId))
   throw Error("Invalid verified Discord actor");
 return actor.memberId;
}
function token(value){
 if(typeof value!=="string" || !UUID.test(value))throw Error("Invalid preview token");
 return value;
}
function firstRow(result){
 if(!result || !Array.isArray(result.rows))throw Error("Invalid database result");
 return result.rows[0] || null;
}
export function makePostgresMatchmakerStore({query,publishingEnabled=false}){
 if(typeof query!=="function")throw Error("Trusted PostgreSQL query function required");
 if(typeof publishingEnabled!=="boolean")throw Error("Publishing feature flag must be a boolean");
 async function one(sql,params){
   return firstRow(await query(sql,params));
 }
 async function prepare(actor,draft){
  const id=owner(actor), d=validateDraft(draft);
  const row=await one(
   "select matchmaker_internal.prepare_preview($1,$2,$3,$4,$5,$6,$7) as token",
   [id,d.game,d.platform,d.vibe,d.mic,d.timezone,d.availability]);
  if(!UUID.test(String(row?.token||"")))throw Error("Database did not return a preview");
  return {token:String(row.token)};
 }
 async function confirm(actor,previewToken){
  const id=owner(actor),t=token(previewToken);
  // A private confirmation must never enqueue a future public message:
  // enabling a worker later cannot retroactively publish private requests.
  const sql=publishingEnabled
    ? "select matchmaker_internal.confirm_and_enqueue($1,$2::uuid) as id"
    : "select matchmaker_internal.confirm_preview($1,$2::uuid) as id";
  const row=await one(sql,[id,t]);
  if(row?.id==null)throw Error("Confirmation could not be saved");
  return {listingId:String(row.id),publicPostCreated:false,queuedForPublishing:publishingEnabled};
 }
 async function cancel(actor,previewToken){
  const row=await one("select matchmaker_internal.cancel_preview($1,$2::uuid) as cancelled",
    [owner(actor),token(previewToken)]);
  if(row?.cancelled!==true)throw Error("Preview not yours or already used");
  return true;
 }
 async function close(actor){
  const row=await one("select matchmaker_internal.close_with_post_guard($1) as outcome",[owner(actor)]);
  if(typeof row?.outcome!=="string")throw Error("Close transition unavailable");
  if(row.outcome==="not_active")return false;
  if(!["closed_without_post","closed_delivery_unresolved","closed_cleanup_queued"].includes(row.outcome))
   throw Error("Unexpected private close transition");
  return true;
 }
 async function mine(actor){
  const row=await one(
   "select game,platform,vibe,mic,timezone,availability,expires_at from matchmaker_internal.squad_listings where owner_discord_id=$1 and status='active' and expires_at>clock_timestamp() order by created_at desc limit 1",
   [owner(actor)]);
  return row ? {
   game:row.game,platform:row.platform,vibe:row.vibe,mic:row.mic,
   timezone:row.timezone,availability:row.availability,expiresAt:row.expires_at
  } : null;
 }
 async function list(actor){
  owner(actor);
  const result=await query(
   "select game,platform,vibe,mic,timezone,availability,expires_at from matchmaker_internal.squad_listings where status='active' and expires_at>clock_timestamp() order by created_at desc limit 10",
   []);
  if(!result || !Array.isArray(result.rows))throw Error("Invalid database result");
  return result.rows.map(row=>({
   game:row.game,platform:row.platform,vibe:row.vibe,mic:row.mic,
   timezone:row.timezone,availability:row.availability,expiresAt:row.expires_at
  }));
 }
 // Only the signed HTTP verifier is authorized to supply interaction IDs.
 // Database primary key makes this atomic across server instances.
 async function claimReplay(interactionId){
  if(typeof interactionId!=="string" || !SNOWFLAKE.test(interactionId))
    throw Error("Invalid verified interaction ID");
  const row=await one("select matchmaker_internal.claim_interaction($1) as accepted",[interactionId]);
  if(typeof row?.accepted!=="boolean")throw Error("Replay storage unavailable");
  return row.accepted;
 }
 return Object.freeze({prepare,confirm,cancel,close,mine,list,claimReplay});
}
