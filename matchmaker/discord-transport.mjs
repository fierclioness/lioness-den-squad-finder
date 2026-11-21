// Review-only Discord REST message transport.
// Server-side only. Nothing sends until a trusted caller explicitly invokes sendMessage.
// The target is an APPROVED GUILD TEXT CHANNEL (e.g., existing #squad-up), not a DM.
const SNOW=/^\d{15,22}$/;
// Discord snowflakes exceed JS safe-integer precision: never coerce numbers.
const exactSnow=value=>typeof value==="string"&&SNOW.test(value);
const API="https://discord.com/api/v10";
export function makeDiscordTransport({botToken,channelId,botUserId,fetchFn=fetch,enabled=false,requestTimeoutMs=5000}){
 if(typeof enabled!=="boolean")throw Error("Invalid publish feature gate");
 if(enabled && (typeof botToken!=="string"||botToken.length<20||!exactSnow(channelId)||!exactSnow(botUserId)))
  throw Error("Verified server-side bot credentials and destination required");
 if(typeof fetchFn!=="function")throw Error("Trusted transport fetch required");
 if(!Number.isInteger(requestTimeoutMs)||requestTimeoutMs<10||requestTimeoutMs>15000)
  throw Error("Bounded request timeout required");
 async function sendMessage({content,allowed_mentions}){
  if(!enabled)throw Error("Discord publishing disabled");
  if(typeof content!=="string"||content.length<1||content.length>1800)
   throw Error("Invalid message content");
  // Enforce no mentions regardless of what the caller supplies.
  if(!allowed_mentions || JSON.stringify(allowed_mentions)!==JSON.stringify({parse:[]}))
   throw Error("Mentions must be disabled");
  // Avoid accidental public pings due to formatting or malicious field strings.
  if(/@everyone|@here|<@!?[0-9]+>|<@&[0-9]+>/i.test(content))
   throw Error("Unsafe Discord mention");
  const response=await fetchFn(API+"/channels/"+channelId+"/messages",{
   method:"POST",
   headers:{"authorization":"Bot "+botToken,"content-type":"application/json"},
   body:JSON.stringify({content,allowed_mentions:{parse:[]}}),
   // Aborts only the HTTP attempt; delivery may already have happened.
   // The outbox MUST quarantine this as UNCERTAIN, never automatically resend.
   redirect:"error", // never follow bot-authorized REST requests off the fixed Discord endpoint
   signal:AbortSignal.timeout(requestTimeoutMs)
  });
  // Any non-2xx response is marked ambiguous by the worker; do not blindly retry.
  if(response.redirected===true)throw Error("Redirected delivery is untrusted");
  // Discord Create Message confirms publication with HTTP 200 and a
  // trustworthy message object. Other 2xx statuses (e.g. 202 Accepted or
  // 206 Partial Content) do NOT establish that a post exists: the outbox
  // must quarantine any such delivery as uncertain, never auto-retry it.
  if(response.status!==200 || response.ok!==true)throw Error("Delivery not confirmed");
  let data;
  try{data=await response.json();}catch{throw Error("Missing delivery receipt");}
  if(!data || !exactSnow(data.id) || data.channel_id!==channelId||
      data.author?.id!==botUserId||data.author?.bot!==true)
   throw Error("Untrusted delivery receipt");
  return {confirmed:true,messageId:String(data.id),channelId:String(data.channel_id),botUserId:String(data.author.id)};
 }
 return Object.freeze({sendMessage});
}
