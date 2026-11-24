// Offline Discord interaction adapter: NO HTTP server or production posting.
// Entrypoint accepts verified Ed25519 signed bytes, never raw caller-provided owner IDs.
// Mock storage is ephemeral in memory. DO NOT deploy to a live endpoint.
import {makeMockMatchmaker} from "./matchmaker-command-mock.mjs";
import {makeSignatureGate} from "./signature-gate.mjs";
const GUILD_ID="1546529497925296199";
const MEMBER_ID=/^\d{15,22}$/;
const EPHEMERAL=64;
const reply=(content)=>({type:4,data:{flags:EPHEMERAL,content:String(content).slice(0,1900),allowed_mentions:{parse:[]}}});
const getOption=(options,name)=>options.find(x=>x?.name===name)?.value;

export function makeOfflineDiscordAdapter({publicKeyHex,clock=()=>Date.now()}){
  const gate=makeSignatureGate({publicKeyHex,clock});
  const mock=makeMockMatchmaker({clock});
  function handleSigned({rawBody,timestamp,signature}){
    let interaction;
    try{interaction=gate.authenticate({rawBody,timestamp,signature});}
    catch{return {httpStatus:401,body:{error:"Unauthorized"}};}
    if(interaction.type===1) return {httpStatus:200,body:{type:1}}; // Signed PING only.
    // Keep the signed JSON actor exact. Numbers lose Discord snowflake precision,
    // while arrays can stringify to someone else's ID. Never coerce ownership.
    const memberId=interaction.member?.user?.id;
    if(interaction.guild_id!==GUILD_ID || typeof memberId!=="string" ||
       !MEMBER_ID.test(memberId))
      return {httpStatus:200,body:reply("Only members of The Lioness Den may use Matchmaker.")};
    const actor={guildId:interaction.guild_id,memberId};
    try{
      let result;
      if(interaction.type===2 && interaction.data?.name==="squad"){
        const sub=interaction.data.options?.[0];
        if(!sub||!["create","list","mine","close"].includes(sub.name))
          return {httpStatus:200,body:reply("Use /squad create, list, mine or close.")};
        if(sub.name==="create"){
          const opts=Array.isArray(sub.options)?sub.options:[];
          const draft=Object.fromEntries(["game","platform","vibe","mic","timezone","availability"].map(x=>[x,getOption(opts,x)]));
          result=mock.create(actor,draft);
        }else result=mock[sub.name](actor);
      }else if(interaction.type===3 && ["matchmaker:confirm","matchmaker:cancel"].includes(interaction.data?.custom_id)){
        result=interaction.data.custom_id==="matchmaker:confirm"?mock.confirm(actor):mock.cancel(actor);
      }else return {httpStatus:200,body:reply("Unsupported Matchmaker interaction.")};
      const content=[result.content,result.preview||""].filter(Boolean).join("\n\n");
      const components=result.actions?[
        {type:1,components:[
          {type:2,style:3,custom_id:"matchmaker:confirm",label:"Confirm (demo only)"},
          {type:2,style:2,custom_id:"matchmaker:cancel",label:"Cancel"}
        ]}
      ]:[];
      return {httpStatus:200,body:{type:4,data:{
        flags:EPHEMERAL,content:content.slice(0,1900),
        allowed_mentions:{parse:[]},...(components.length?{components}:{})
      }}};
    }catch{
      return {httpStatus:200,body:reply("Could not process that request. Please check your fields and try again.")};
    }
  }
  return Object.freeze({handleSigned});
}
