// Development-only command dispatcher with injectable authenticated storage.
// No Discord network calls, no messages posted, no production credentials.
import {validateDraft,formatPreview} from "./matchmaker-core.mjs";
const guild="1546529497925296199";
const fields=["game","platform","vibe","mic","timezone","availability"];
const option=(options,name)=>options.find(x=>x?.name===name)?.value;
export function makeMatchmakerDispatcher({store}){
 const methods=["prepare","confirm","cancel","mine","list","close"];
 if(!store||methods.some(k=>typeof store[k]!=="function"))throw Error("Complete trusted storage adapter required");
 return async input=>{
  if(input?.guildId!==guild||!/^\d{15,22}$/.test(String(input.memberId||"")))
   throw Error("Invalid signed actor");
  const actor={guildId:guild,memberId:String(input.memberId)},data=input.data;
  if(input.type===2&&data?.name==="squad"){
   const sub=data.options?.[0];
   if(sub?.name==="create"){
    const opts=Array.isArray(sub.options)?sub.options:[];
    const draft=validateDraft(Object.fromEntries(fields.map(k=>[k,option(opts,k)])));
    const preview=await store.prepare(actor,draft);
    if(!/^[0-9a-f-]{36}$/i.test(String(preview?.token||"")))throw Error("Invalid preview token");
    return {content:"Review your squad request. Nothing has been posted.\n\n"+formatPreview(draft),
      buttons:[{action:"confirm",token:preview.token,label:"Confirm"},{action:"cancel",token:preview.token,label:"Cancel"}]};
   }
   if(sub?.name==="mine"){
    const item=await store.mine(actor);
    return {content:item?"Your active squad: "+item.game+" · "+item.platform+" · "+item.vibe:"You have no active listing."};
   }
   if(sub?.name==="list"){
    const items=await store.list(actor);
    if(!Array.isArray(items))throw Error("Invalid listing response");
    const lines=items.slice(0,10).map(x=>x.game+" · "+x.platform+" · "+x.vibe+" · "+x.availability+" ("+x.timezone+")");
    return {content:lines.length?"Active opt-in listings:\n"+lines.join("\n"):"No active listings."};
   }
   if(sub?.name==="close")return {content:(await store.close(actor))?"Your listing was closed.":"No active listing to close."};
   return {content:"Use /squad create, mine, list, or close."};
  }
  if(input.type===3&&typeof data?.custom_id==="string"){
   const match=/^mm:(confirm|cancel):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(data.custom_id);
   if(!match)return {content:"Button no longer available."};
   if(match[1]==="cancel"){
    await store.cancel(actor,match[2]);return {content:"Preview cancelled. Nothing was posted."};
   }
   const result=await store.confirm(actor,match[2]);
   if(result?.publicPostCreated!==false)throw Error("Unexpected posting behavior");
   return {content:"Your squad request was saved privately. Nothing was posted to Discord because publishing is not enabled."};
  }
  return {content:"Unsupported action."};
 };
}
