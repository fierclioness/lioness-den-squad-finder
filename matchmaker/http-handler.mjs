// Runtime-neutral HTTP Request -> Response implementation for Edge/Deno/Node 22.
// Safe by default: signed PING accepted, all other interactions fail closed.
// No public posting, persistence, Discord bot token or live deployment.
// A future dispatch callback MUST implement authorization, durable state and publish safety.
import {makeDiscordVerifier} from "./discord-webcrypto-verifier.mjs";

const GUILD="1546529497925296199";
const SNOWFLAKE=/^\d{15,22}$/;
const MAX_BODY=1024*1024;
class BodyTooLarge extends Error {}
// Limit streamed bodies *before* allocating/validating Ed25519 data. A hostile
// request can omit Content-Length or lie about it; arrayBuffer() is unbounded.
async function readLimitedBody(request){
 const reader=request.body?.getReader();
 if(!reader)return new Uint8Array(0);
 let total=0;
 const parts=[];
 try{
  for(;;){
   const {done,value}=await reader.read();
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
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(total);
 let offset=0;
 for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
 return bytes;
}
const JSON_HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:JSON_HEADERS});
const ephemeral=content=>({type:4,data:{flags:64,content,allowed_mentions:{parse:[]}}});
export function makeMatchmakerHttpHandler({publicKeyHex,claimReplay,dispatch,enabled=false,clock=()=>Date.now()}){
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
  try{bytes=await readLimitedBody(request);}
  catch(error){return error instanceof BodyTooLarge
    ? json({error:"Payload too large"},413):json({error:"Unauthorized"},401);}
  try{interaction=await verifier.authenticate({rawBody:bytes,timestamp,signature});}
  catch{return json({error:"Unauthorized"},401);}
  if(interaction.type===1)return json({type:1}); // Signed PING only.
  if(interaction.guild_id!==GUILD ||
     !SNOWFLAKE.test(String(interaction.member?.user?.id||"")))
   return json(ephemeral("The Den Matchmaker is for Lioness Den members only."));
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
     memberId:String(interaction.member.user.id),
     guildId:interaction.guild_id,
     type:interaction.type,
     data:interaction.data
   });
   // Dispatch may respond ONLY with ephemeral messages. It must never control flags.
   if(!result || typeof result.content!=="string")
    return json(ephemeral("Matchmaker couldn't complete that action."));
   const output=ephemeral(result.content.slice(0,1850));
   // Only a tightly validated ephemeral Confirm/Cancel row is allowed.
   // Never pass untrusted component data through from a dispatcher.
   if(Array.isArray(result.buttons) && result.buttons.length===2 &&
      result.buttons[0]?.action==="confirm" && result.buttons[1]?.action==="cancel" &&
      result.buttons.every(b=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(b.token||""))) &&
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
