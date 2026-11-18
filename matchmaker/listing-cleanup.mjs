// Development-only lifecycle cleanup planner. NOT a scheduled worker.
// Requires trusted private DB records and a verified, bot-owned Discord message ID.
// Never deletes arbitrary member messages; only matching original bot posts.
const SNOW=/^\d{15,22}$/;
const STATES=new Set(["active","closed","expired"]);
export function planCleanup(record,{now=Date.now()}={}){
 if(!record || !STATES.has(record.status) || !Number.isFinite(now))throw Error("Invalid listing state");
 if(typeof record.expiresAtMs!=="number"||!Number.isFinite(record.expiresAtMs))throw Error("Missing expiry");
 if(record.status==="active"&&record.expiresAtMs>now)return {action:"none",reason:"Active listing"};
 if(record.postState==="uncertain"||record.postState==="sending")
  return {action:"manual",reason:"Posting may have succeeded without a receipt"};
 if(record.postState!=="posted")return {action:"none",reason:"No confirmed public message"};
 if(!SNOW.test(String(record.messageId||"")) || !SNOW.test(String(record.channelId||"")) ||
    record.botOwned!==true)
  return {action:"manual",reason:"Ownership, channel or receipt not verified"};
 return {action:"delete",messageId:String(record.messageId),channelId:String(record.channelId)};
}
export function makeMessageCleanupTransport({botToken,channelId,fetchFn=fetch,enabled=false}){
 if(typeof enabled!=="boolean"||typeof fetchFn!=="function")throw Error("Invalid transport setup");
 if(enabled && (typeof botToken!=="string"||botToken.length<20||!SNOW.test(String(channelId))))
  throw Error("Trusted bot token and channel required");
 return Object.freeze({
   async removeConfirmedBotPost(plan){
     if(!enabled)throw Error("Cleanup disabled");
     if(plan?.action!=="delete"||plan.channelId!==channelId||!SNOW.test(String(plan.messageId||"")))
       throw Error("Unverified message deletion request");
     const url="https://discord.com/api/v10/channels/"+channelId+"/messages/"+plan.messageId;
     const response=await fetchFn(url,{method:"DELETE",headers:{authorization:"Bot "+botToken}});
     if(response?.status===204)return {status:"deleted"};
     // 404 means the post is absent; a verified own-message ID is required above.
     if(response?.status===404)return {status:"already_absent"};
     // 429, 403, timeouts and 5xx require controlled retry/reconciliation.
     throw Error("Delete not confirmed; manual reconciliation required");
   }
 });
}
