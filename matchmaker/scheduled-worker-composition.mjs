// REVIEW ONLY. Private worker wiring; NOT deployed, scheduled, or authorized for
// any real Discord guild. Its future Edge endpoint MUST have Supabase
// verify_jwt=true in addition to this gateway's scheduler secret.
// Never import this from the existing public Discord webhook Edge function.
import {makeScheduledWorkerGateway} from "./scheduled-worker-gateway.mjs";
import {makeDiscordTransport} from "./discord-transport.mjs";
import {makeVerifiedBotCleanup} from "./verified-bot-cleanup.mjs";
import {makeOutboxWorker} from "./outbox-worker.mjs";
import {makeCleanupOutboxWorker} from "./cleanup-outbox-worker.mjs";
import {makeMaintenanceWorker} from "./maintenance-worker.mjs";

const GUILD="1546529497925296199";
const SNOW=/^\d{15,22}$/;

/**
 * Build an isolated, authenticated, one-task-at-a-time scheduler.
 * There are NO live calls at construction. Every individual worker defaults OFF.
 * Approval of deployment, credentials, guild permissions and public posting
 * is an external release gate; destinationReviewed never grants permission.
 */
export function makeScheduledWorkerComposition({
 query,fetchFn=fetch,schedulerSecret="",schedulerEnabled=false,
 postingEnabled=false,cleanupEnabled=false,maintenanceEnabled=false,
 transientRetentionEnabled=false,
 destinationReviewed=false,botToken="",channelId="",botUserId="",
 requestTimeoutMs=5000,batchSize=50,staleMinutes=10
}={}){
 if(typeof query!=="function"||typeof fetchFn!=="function")
  throw Error("Trusted private database and Discord connectors required");
 if([schedulerEnabled,postingEnabled,cleanupEnabled,maintenanceEnabled,transientRetentionEnabled,destinationReviewed]
     .some(flag=>typeof flag!=="boolean"))
  throw Error("Feature gates and destination review must be booleans");
 if(transientRetentionEnabled&&!maintenanceEnabled)
  throw Error("Transient retention requires the separate maintenance feature gate");
 if((postingEnabled||cleanupEnabled)&&(!destinationReviewed||
    !SNOW.test(String(channelId))||String(channelId)===GUILD||
    !SNOW.test(String(botUserId))||String(botUserId)===String(channelId)))
  throw Error("Independently reviewed Discord text channel and bot identity required");
 const outbound=makeDiscordTransport({
  botToken,channelId,botUserId,fetchFn,enabled:postingEnabled,requestTimeoutMs
 });
 const verifiedCleanup=makeVerifiedBotCleanup({
  botToken,channelId,botUserId,fetchFn,enabled:cleanupEnabled,requestTimeoutMs
 });
 const publisher=makeOutboxWorker({
  query,sendMessage:outbound.sendMessage,channelId,botUserId,enabled:postingEnabled
 });
 const cleanup=makeCleanupOutboxWorker({
  query,verifiedCleanup,channelId,botUserId,enabled:cleanupEnabled
 });
 const maintenance=makeMaintenanceWorker({
  query,enabled:maintenanceEnabled,batchSize,staleMinutes,
  transientRetentionEnabled
 });
 return makeScheduledWorkerGateway({
  schedulerSecret,enabled:schedulerEnabled,postingEnabled,cleanupEnabled,
  maintenanceEnabled,publisher,cleanup,maintenance
 });
}
