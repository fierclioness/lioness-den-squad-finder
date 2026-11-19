// Development-only verified cleanup transport. Never enabled in production here.
// Verifies original bot ownership through Discord GET before deleting a fixed-channel post.
const SNOW=/^\d{15,22}$/;
export function makeVerifiedBotCleanup({botToken,botUserId,channelId,fetchFn=fetch,enabled=false,requestTimeoutMs=5000}){
 if(typeof enabled!=="boolean"||typeof fetchFn!=="function")throw Error("Invalid cleanup configuration");
 if(!Number.isInteger(requestTimeoutMs)||requestTimeoutMs<10||requestTimeoutMs>15000)
  throw Error("Bounded cleanup request timeout required");
 if(enabled && (typeof botToken!=="string"||botToken.length<20||
     !SNOW.test(String(botUserId||""))||!SNOW.test(String(channelId||""))))
   throw Error("Trusted bot identity and fixed destination required");
 async function remove(messageId){
   if(!enabled)throw Error("Verified cleanup is disabled");
   if(!SNOW.test(String(messageId||"")))throw Error("Invalid original message receipt");
   const url="https://discord.com/api/v10/channels/"+channelId+"/messages/"+messageId;
   const headers={authorization:"Bot "+botToken};
   // Do not delete without reading the precise original and proving authorship.
   const lookup=await fetchFn(url,{method:"GET",headers,redirect:"error",signal:AbortSignal.timeout(requestTimeoutMs)});
   if(lookup.redirected===true)throw Error("Redirected Discord lookup is untrusted");
   if(lookup.status===404)return {status:"already_absent"};
   if(lookup.status!==200)throw Error("Could not verify original Discord post");
   let message;
   try{message=await lookup.json();}catch{throw Error("Malformed Discord author receipt");}
   if(String(message?.id)!==messageId||String(message?.channel_id)!==channelId||
      String(message?.author?.id)!==botUserId||message?.author?.bot!==true)
      throw Error("Original message was not verified as our bot's post");
   // A timed-out DELETE is ambiguous. Never declare success without a 204/404 receipt.
   const removal=await fetchFn(url,{method:"DELETE",headers,redirect:"error",signal:AbortSignal.timeout(requestTimeoutMs)});
   if(removal.redirected===true)throw Error("Redirected Discord deletion is unconfirmed");
   if(removal.status===204)return {status:"deleted"};
   if(removal.status===404)return {status:"already_absent"};
   throw Error("Message deletion not confirmed; require reconciliation");
 }
 return Object.freeze({remove});
}
