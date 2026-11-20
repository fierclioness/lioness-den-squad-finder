// Development-only lifecycle cleanup planner. NOT a scheduled worker.
// Requires trusted private DB records and a verified, bot-owned Discord message ID.
// Never deletes arbitrary member messages; only matching original bot posts.
const SNOW=/^\d{15,22}$/;
// A rounded numeric Discord ID or boxed/convertible object is not an exact
// receipt. Never turn it into a candidate for original-bot deletion.
const exactSnow=value=>typeof value==="string"&&SNOW.test(value);
const STATES=new Set(["active","closed","expired"]);
export function planCleanup(record,{now=Date.now()}={}){
 if(!record || !STATES.has(record.status) || !Number.isFinite(now))throw Error("Invalid listing state");
 if(typeof record.expiresAtMs!=="number"||!Number.isFinite(record.expiresAtMs))throw Error("Missing expiry");
 if(record.status==="active"&&record.expiresAtMs>now)return {action:"none",reason:"Active listing"};
 if(record.postState==="uncertain"||record.postState==="sending")
  return {action:"manual",reason:"Posting may have succeeded without a receipt"};
 if(record.postState!=="posted")return {action:"none",reason:"No confirmed public message"};
 if(!exactSnow(record.messageId) || !exactSnow(record.channelId) ||
    record.botOwned!==true)
  return {action:"manual",reason:"Ownership, channel or receipt not verified"};
 return {action:"delete",messageId:record.messageId,channelId:record.channelId};
}
// The legacy cleanup transport must NEVER delete on DB-record trust alone.
// Re-check the exact Discord message's author and channel before every DELETE.
// This enforces the same bot-owned message gate as the reviewed cleanup path.
import {makeVerifiedBotCleanup} from "./verified-bot-cleanup.mjs";
export function makeMessageCleanupTransport({botToken,botUserId,channelId,fetchFn=fetch,enabled=false}){
 if(typeof enabled!=="boolean"||typeof fetchFn!=="function")throw Error("Invalid transport setup");
 if(enabled && (typeof botToken!=="string"||botToken.length<20||
    !exactSnow(botUserId)||!exactSnow(channelId)))
   throw Error("Trusted bot token, bot identity and channel required");
 const verified=makeVerifiedBotCleanup({botToken,botUserId,channelId,fetchFn,enabled});
 return Object.freeze({
   async removeConfirmedBotPost(plan){
     if(!enabled)throw Error("Cleanup disabled");
     if(plan?.action!=="delete"||plan.channelId!==channelId||
        !exactSnow(plan.messageId))
       throw Error("Unverified message deletion request");
     return verified.remove(plan.messageId);
   }
 });
}
