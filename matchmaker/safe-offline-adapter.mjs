// Offline signed Discord command simulation with transaction-like state.
// Never deploy: Node crypto and memory-backed storage are for integration tests.
import {makeSignatureGate} from "./signature-gate.mjs";
import {makeTransactionalMock} from "./transactional-mock.mjs";
const GUILD="1546529497925296199";
const EPHEMERAL=64;
const SNOWFLAKE=/^\d{15,22}$/;
const response=(message)=>({httpStatus:200,body:{type:4,data:{
  content:String(message).slice(0,1900),flags:EPHEMERAL,allowed_mentions:{parse:[]}
}}});
const choice=(fields,key)=>fields.find(x=>x?.name===key)?.value;
export function makeSafeOfflineAdapter({publicKeyHex,clock=()=>Date.now()}){
 const gate=makeSignatureGate({publicKeyHex,clock});
 const storage=makeTransactionalMock({clock});
 async function handleSigned(headers){
  let signed;
  try{signed=gate.authenticate(headers);}
  catch{return {httpStatus:401,body:{error:"Unauthorized"}};}
  if(!await storage.acceptInteraction(signed.id))
    return {httpStatus:401,body:{error:"Duplicate interaction"}};
  if(signed.type===1)return {httpStatus:200,body:{type:1}};
  if(signed.guild_id!==GUILD || !SNOWFLAKE.test(String(signed.member?.user?.id||"")))
   return response("Only Lioness Den members can use this feature.");
  const actor={guildId:signed.guild_id,memberId:String(signed.member.user.id)};
  try{
    if(signed.type===2&&signed.data?.name==="squad"){
      const sub=signed.data.options?.[0];
      if(sub?.name==="create"){
        const fields=Array.isArray(sub.options)?sub.options:[];
        const draft=Object.fromEntries(["game","platform","vibe","mic","timezone","availability"].map(k=>[k,choice(fields,k)]));
        const preview=storage.preview(actor,draft);
        const res=response("Preview only. Nothing has been posted:\n\n"+preview.text);
        res.body.data.components=[{type:1,components:[
          {type:2,style:3,label:"Confirm preview (test)",custom_id:"mm:confirm:"+preview.token},
          {type:2,style:2,label:"Cancel",custom_id:"mm:cancel:"+preview.token}
        ]}];
        return res;
      }
      if(sub?.name==="mine"){
        const own=storage.mine(actor);
        return response(own?"You have an active "+own.game+" listing.":"You have no active listing.");
      }
      if(sub?.name==="list"){
        const all=storage.list(actor);
        return response(all.length?all.map(x=>x.game+" · "+x.platform+" · "+x.vibe).join("\n"):"No active squad listings.");
      }
      if(sub?.name==="close"){
        const result=await storage.close(actor);
        return response(result.status==="closed"?"Your listing was closed.":"No active listing.");
      }
      return response("Use /squad create, mine, list, or close.");
    }
    if(signed.type===3&&typeof signed.data?.custom_id==="string"){
      const match=/^mm:(confirm|cancel):([0-9a-f-]{36})$/i.exec(signed.data.custom_id);
      if(!match)return response("Unknown button.");
      if(match[1]==="cancel"){
        // Confirmed preview not created; simply no posting.
        return response("No squad listing was posted. Your preview will expire automatically.");
      }
      const result=await storage.confirm(actor,match[2]);
      return response(result.publicPostCreated?"Published.":"Saved to the test model. No Discord message was posted.");
    }
    return response("Unsupported Matchmaker interaction.");
  }catch(error){
    return response("Unable to complete request: "+String(error.message||"Check your details.").slice(0,140));
  }
 }
 return Object.freeze({handleSigned});
}
