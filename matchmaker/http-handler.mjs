// Runtime-neutral HTTP Request -> Response implementation for Edge/Deno/Node 22.
// Safe by default: signed PING accepted, all other interactions fail closed.
// No public posting, persistence, Discord bot token or live deployment.
// A future dispatch callback MUST implement authorization, durable state and publish safety.
import {makeDiscordVerifier} from "./discord-webcrypto-verifier.mjs";

const GUILD="1546529497925296199";
const SNOWFLAKE=/^\d{15,22}$/;
const MAX_BODY=1024*1024;
const DEFAULT_BODY_READ_TIMEOUT_MS=1500; // leave headroom for Discord signature + DB work
class BodyTooLarge extends Error {}
class BodyReadTimeout extends Error {}
// Limit streamed bodies *before* allocating/validating Ed25519 data. A hostile
// request can omit Content-Length or lie about it; arrayBuffer() is unbounded.
async function readLimitedBody(request,timeoutMs){
 const reader=request.body?.getReader();
 if(!reader)return new Uint8Array(0);
 // A small body can still stall forever between chunks. Set ONE deadline for
 // the entire pre-authentication read, not a fresh deadline per chunk.
 // This is safe to time out: no signature verification or DB write has begun.
 // A referenced timer also works with a fully idle/never-resolving stream in
 // Node tests; clear it immediately after the body has finished reading.
 let timer;
 const timeout=new Promise((_,reject)=>{
  timer=setTimeout(()=>reject(new BodyReadTimeout("Discord payload read deadline exceeded")),timeoutMs);
 });
 let total=0;
 const parts=[];
 try{
  for(;;){
   const {done,value}=await Promise.race([reader.read(),timeout]);
   if(done)break;
   if(!(value instanceof Uint8Array))throw Error("Invalid request bytes");
   total+=value.byteLength;
   if(total>MAX_BODY)throw new BodyTooLarge("Oversized Discord payload");
   parts.push(value);
  }
 }catch(error){
  // Cancel excess streaming input; never reach signing or replay storage.
  void reader.cancel().catch(()=>{});
  throw error;
 }finally{clearTimeout(timer);reader.releaseLock();}
 const bytes=new Uint8Array(total);
 let offset=0;
 for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
 return bytes;
}
const JSON_HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:JSON_HEADERS});
const ephemeral=content=>({type:4,data:{flags:64,content,allowed_mentions:{parse:[]}}});
export function makeMatchmakerHttpHandler({publicKeyHex,claimReplay,dispatch,enabled=false,allowedTesterIds=null,clock=()=>Date.now(),bodyReadTimeoutMs=DEFAULT_BODY_READ_TIMEOUT_MS}){
 if(typeof enabled!=="boolean")throw Error("Invalid command feature gate");
 if(!Number.isInteger(bodyReadTimeoutMs)||bodyReadTimeoutMs<25||bodyReadTimeoutMs>2000)
  throw Error("Invalid Discord body read timeout");
 if(allowedTesterIds!==null && (!(allowedTesterIds instanceof Set)||[...allowedTesterIds].some(id=>typeof id!=="string"||!SNOWFLAKE.test(id))))
  throw Error("Invalid tester allowlist");
 // Freeze authorization at construction time. A caller mutating the Set later
 // must not expand the scope of a running Discord endpoint.
 const testerIds=allowedTesterIds===null?null:new Set(allowedTesterIds);
 // Fail closed at the signed HTTP boundary too, not only in the staging
 // environment loader. A misconfigured deployment must never authorize
 // everyone in the guild by omitting its restricted test-user list.
 if(enabled && (!(allowedTesterIds instanceof Set)||allowedTesterIds.size===0))
  throw Error("Enabled commands require a nonempty tester allowlist");
 const verifier=makeDiscordVerifier({publicKeyHex,claimReplay,clock});
 return async function handle(request){
  if(request.method!=="POST")return json({error:"Method not allowed"},405);
  const signature=request.headers.get("x-signature-ed25519");
  const timestamp=request.headers.get("x-signature-timestamp");
  if(!signature||!timestamp)return json({error:"Unauthorized"},401);
  const declaredLength=request.headers.get("content-length");
  if(declaredLength!==null && (!/^\d+$/.test(declaredLength)||Number(declaredLength)>MAX_BODY))
   return json({error:"Payload too large"},413);
  let bytes,interaction;
  try{bytes=await readLimitedBody(request,bodyReadTimeoutMs);}
  catch(error){return error instanceof BodyTooLarge
    ? json({error:"Payload too large"},413)
    : error instanceof BodyReadTimeout ? json({error:"Request timeout"},408)
    : json({error:"Unauthorized"},401);}
  try{interaction=await verifier.authenticate({rawBody:bytes,timestamp,signature});}
  catch{return json({error:"Unauthorized"},401);}
  if(interaction.type===1)return json({type:1}); // Signed PING only.
  // Discord snowflakes are exact strings. Converting a JSON number to String
  // can lose precision and accidentally match a different allowlisted actor.
  const memberId=interaction.member?.user?.id;
  if(interaction.guild_id!==GUILD || typeof memberId!=="string" ||
     !SNOWFLAKE.test(memberId))
   return json(ephemeral("The Den Matchmaker is for Lioness Den members only."));
  if(testerIds!==null && !testerIds.has(memberId))
   return json(ephemeral("Den Matchmaker is currently limited to authorized testers."));
  if(!enabled || typeof dispatch!=="function")
   return json(ephemeral("Den Matchmaker is in development. The current Squad Finder is available."));
  // Restrict any future dispatcher to explicitly recognized signed command types.
  const command=interaction.type===2 && interaction.data?.name==="squad";
  const component=interaction.type===3 && typeof interaction.data?.custom_id==="string"
    && interaction.data.custom_id.startsWith("mm:");
  if(!command && !component)return json(ephemeral("Unsupported Matchmaker action."));
  try{
   const result=await dispatch({
     interactionId:interaction.id,
     memberId,
     guildId:interaction.guild_id,
     type:interaction.type,
     data:interaction.data
   });
   // Dispatch may respond ONLY with ephemeral messages. It must never control flags.
   // Never silently trim bot-authored consent or listing text. In particular,
   // an oversized preview must not retain actionable Confirm buttons after
   // its disclosure text has been cut off. Fail closed with no components.
   if(!result || typeof result.content!=="string" ||
      result.content.length===0 || result.content.length>1850)
    return json(ephemeral("Matchmaker couldn't safely display that response. Please create a fresh request."));
   const output=ephemeral(result.content);
   // Only a tightly validated ephemeral Confirm/Cancel row is allowed.
   // Never pass untrusted component data through from a dispatcher.
   if(Array.isArray(result.buttons) && result.buttons.length===2 &&
      result.buttons[0]?.action==="confirm" && result.buttons[1]?.action==="cancel" &&
      result.buttons.every(b=>typeof b.token==="string" &&
       /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.token)) &&
      result.buttons[0].token===result.buttons[1].token) {
     const token=result.buttons[0].token;
     output.data.components=[{type:1,components:[
       {type:2,style:3,label:result.buttons[0].label==="Post to #squad-up"?"Post to #squad-up":"Save to /squad list",custom_id:"mm:confirm:"+token+":"+(result.buttons[0].label==="Post to #squad-up"?"public":"private")},
       {type:2,style:2,label:"Cancel",custom_id:"mm:cancel:"+token+":"+(result.buttons[0].label==="Post to #squad-up"?"public":"private")}
     ]}];
   }
   return json(output);
  }catch{
   // No internal details, tokens or database errors in public responses.
   return json(ephemeral("Matchmaker could not complete the request. Please try again later."));
  }
 };
}
