// Runtime-neutral HTTP Request -> Response implementation for Edge/Deno/Node 22.
// Safe by default: signed PING accepted, all other interactions fail closed.
// No public posting, persistence, Discord bot token or live deployment.
// A future dispatch callback MUST implement authorization, durable state and publish safety.
import {makeDiscordVerifier} from "./discord-webcrypto-verifier.mjs";

const GUILD="1546529497925296199";
const SNOWFLAKE=/^\d{15,22}$/;
const MAX_BODY=1024*1024;
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
  if(Number(request.headers.get("content-length"))>MAX_BODY)
   return json({error:"Payload too large"},413);
  let bytes,interaction;
  try{
   bytes=new Uint8Array(await request.arrayBuffer());
   interaction=await verifier.authenticate({rawBody:bytes,timestamp,signature});
  }catch{
   return json({error:"Unauthorized"},401);
  }
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
   return json(ephemeral(result.content.slice(0,1850)));
  }catch{
   // No internal details, tokens or database errors in public responses.
   return json(ephemeral("Matchmaker could not complete the request. Please try again later."));
  }
 };
}
