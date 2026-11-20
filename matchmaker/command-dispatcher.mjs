// Development-only command dispatcher with injectable authenticated storage.
// No Discord network calls, no messages posted, no production credentials.
import {validateDraft,formatPreview} from "./matchmaker-core.mjs";
const guild="1546529497925296199";
const fields=["game","platform","vibe","mic","timezone","availability"];
const option=(options,name)=>options.find(x=>x?.name===name)?.value;
export function makeMatchmakerDispatcher({store,publishingEnabled=false}){
 const methods=["prepare","confirm","cancel","mine","list","close"];
 if(!store||methods.some(k=>typeof store[k]!=="function"))throw Error("Complete trusted storage adapter required");
 if(typeof publishingEnabled!=="boolean")throw Error("Publishing feature flag must be a boolean");
 return async input=>{
  // Discord snowflakes are opaque decimal strings. Numeric IDs can lose
  // precision and must never be used to authorize a member's storage actions.
  if(input?.guildId!==guild || typeof input.memberId!=="string" ||
     !/^\d{15,22}$/.test(input.memberId))
   throw Error("Invalid signed actor");
  const actor={guildId:guild,memberId:input.memberId},data=input.data;
  if(input.type===2&&data?.name==="squad"){
   const sub=data.options?.[0];
   if(sub?.name==="create"){
    const opts=Array.isArray(sub.options)?sub.options:[];
    const draft=validateDraft(Object.fromEntries(fields.map(k=>[k,option(opts,k)])));
    const preview=await store.prepare(actor,draft);
    if(!/^[0-9a-f-]{36}$/i.test(String(preview?.token||"")))throw Error("Invalid preview token");
    const consent=publishingEnabled
      ? "Confirming queues this opt-in listing for PUBLIC posting in #squad-up. Nothing has been posted yet."
      : "Nothing has been posted. Confirming saves a discoverable opt-in listing: other Matchmaker users can see these game preferences with /squad list. No #squad-up post is queued now or later.";
    return {content:"Review your squad request. "+consent+"\n\n"+formatPreview(draft,{publishingEnabled}),
      buttons:[{action:"confirm",token:preview.token,label:publishingEnabled?"Post to #squad-up":"Save to /squad list"},{action:"cancel",token:preview.token,label:"Cancel"}]};
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
   const match=/^mm:(confirm|cancel):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(private|public)$/i.exec(data.custom_id);
   if(!match)return {content:"Button no longer available. Create a fresh squad request."};
   // Consent is bound to the preview button mode. A deployment flag change
   // must never reinterpret a private preview as authorization to publish.
   if(match[3] !== (publishingEnabled?"public":"private"))
    return {content:"Posting settings changed since this preview. Create a fresh squad request to review the current options."};
   if(match[1]==="cancel"){
    await store.cancel(actor,match[2]);return {content:"Preview cancelled. Nothing was posted."};
   }
   const result=await store.confirm(actor,match[2]);
   if(result?.publicPostCreated!==false ||
      (publishingEnabled ? result.queuedForPublishing!==true : result.queuedForPublishing===true))
     throw Error("Inconsistent publishing consent or unexpected posting behavior");
   return {content:publishingEnabled
      ? "Your opted-in squad request was queued for posting in #squad-up. It may take a moment to appear."
      : "Your opt-in listing is visible to other Matchmaker users via /squad list. Nothing was posted or queued to #squad-up; enabling posting later will not publish it."};
  }
  return {content:"Unsupported action."};
 };
}
