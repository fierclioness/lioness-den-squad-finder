// Explicit opt-in registration for the SEPARATE Den Matchmaker Test application.
// Dry-run is the default. Never commits credentials, never touches global commands.
import {squadCommand,validateManifest} from "./discord-command-manifest.mjs";
const APP="1572772707542507580";
const GUILD="1546529497925296199";
const endpoint="https://discord.com/api/v10/applications/"+APP+"/guilds/"+GUILD+"/commands";
export function makeRegistrationRequest({token,applicationId=APP,guildId=GUILD}={}){
 if(applicationId!==APP||guildId!==GUILD)throw Error("Refusing unexpected Discord app or guild");
 if(typeof token!=="string"||token.length<20)throw Error("Bot token required only for explicit registration");
 validateManifest();
 return {url:endpoint,options:{method:"POST",headers:{authorization:"Bot "+token,"content-type":"application/json"},body:JSON.stringify(squadCommand)}};
}
export async function registerTestGuildCommand({token,fetchFn=fetch,applicationId=APP,guildId=GUILD}={}){
 if(typeof fetchFn!=="function")throw Error("Fetch implementation required");
 const {url,options}=makeRegistrationRequest({token,applicationId,guildId});
 const res=await fetchFn(url,options);
 if(!res.ok)throw Error("Discord test command registration failed (HTTP "+res.status+")");
 const body=await res.json();
 if(body?.name!=="squad"||body?.application_id!==APP||body?.guild_id!==GUILD)
  throw Error("Discord returned an unexpected command receipt");
 return {registered:true,name:body.name,guildId:GUILD};
}
if(import.meta.url===new URL("file://"+process.argv[1]).href){
 const apply=process.argv.includes("--register");
 if(!apply){
  console.log("DRY RUN: test app "+APP+", guild "+GUILD+", command /squad. No network request. Use --register with DEN_MATCHMAKER_TEST_BOT_TOKEN in local environment.");
 }else{
  if(process.argv.some(x=>x!=="--register"&&x.startsWith("--")))throw Error("Unknown argument");
  const result=await registerTestGuildCommand({token:process.env.DEN_MATCHMAKER_TEST_BOT_TOKEN});
  console.log("Registered test command: "+result.name);
 }
}
