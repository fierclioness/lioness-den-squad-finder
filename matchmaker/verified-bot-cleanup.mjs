// Development-only verified cleanup transport. Never enabled in production here.
// Verifies original bot ownership through Discord GET before deleting a fixed-channel post.
import {authorizeReceiptCleanup} from "./receipt-authorization.mjs";
const SNOW=/^\d{15,22}$/;
// Discord snowflakes are opaque decimal strings, not safe JS numbers.
const exactSnow=value=>typeof value==="string"&&SNOW.test(value);
// HTTP 404 does not prove that a message is gone: an unknown/inaccessible
// channel or proxy error can also be 404. Discord's specific Unknown Message
// error (10008) is the only not-found evidence safe to treat as absence.
async function isUnknownMessage(response){
 try {const error=await response.json();return error?.code===10008;}
 catch{return false;}
}
export function makeVerifiedBotCleanup({botToken,botUserId,channelId,fetchFn=fetch,enabled=false,requestTimeoutMs=5000}){
 if(typeof enabled!=="boolean"||typeof fetchFn!=="function")throw Error("Invalid cleanup configuration");
 if(!Number.isInteger(requestTimeoutMs)||requestTimeoutMs<10||requestTimeoutMs>15000)
  throw Error("Bounded cleanup request timeout required");
 if(enabled && (typeof botToken!=="string"||botToken.length<20||
     !exactSnow(botUserId)||!exactSnow(channelId)))
   throw Error("Trusted bot identity and fixed destination required");
 async function remove(messageId){
   if(!enabled)throw Error("Verified cleanup is disabled");
   if(!exactSnow(messageId))throw Error("Invalid original message receipt");
   const url="https://discord.com/api/v10/channels/"+channelId+"/messages/"+messageId;
   const headers={authorization:"Bot "+botToken};
   // Do not delete without reading the precise original and proving authorship.
   const lookup=await fetchFn(url,{method:"GET",headers,redirect:"error",signal:AbortSignal.timeout(requestTimeoutMs)});
   if(lookup.redirected===true)throw Error("Redirected Discord lookup is untrusted");
   if(lookup.status===404){
     if(await isUnknownMessage(lookup))return {status:"already_absent"};
     throw Error("Unverified Discord not-found response");
   }
   if(lookup.status!==200)throw Error("Could not verify original Discord post");
   let message;
   try{message=await lookup.json();}catch{throw Error("Malformed Discord author receipt");}
   if(!authorizeReceiptCleanup({
      receipt:{messageId,channelId,botUserId},
      expected:{channelId,botUserId},
      observedMessage:{id:message?.id,channelId:message?.channel_id,authorId:message?.author?.id}
    })||message?.author?.bot!==true)
      throw Error("Original message was not verified as our bot's post");
   // A timed-out DELETE is ambiguous. Never declare success without a 204/404 receipt.
   const removal=await fetchFn(url,{method:"DELETE",headers,redirect:"error",signal:AbortSignal.timeout(requestTimeoutMs)});
   if(removal.redirected===true)throw Error("Redirected Discord deletion is unconfirmed");
   if(removal.status===204)return {status:"deleted"};
   if(removal.status===404){
     if(await isUnknownMessage(removal))return {status:"already_absent"};
     throw Error("Message deletion not confirmed; require reconciliation");
   }
   throw Error("Message deletion not confirmed; require reconciliation");
 }
 return Object.freeze({remove});
}
