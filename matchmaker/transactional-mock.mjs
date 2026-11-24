// Development-only transactional state model.
// Models durable storage semantics in memory. It is NOT a production database,
// distributed lock, or Discord publishing implementation.
import {randomUUID} from "node:crypto";
import {createListing, closeListing, activeListings, formatPreview, validateDraft} from "./matchmaker-core.mjs";
const SNOWFLAKE = /^\d{15,22}$/;
const GUILD_ID = "1546529497925296199";
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;
const REPLAY_TTL_MS = 10 * 60 * 1000;

export function makeTransactionalMock({clock=()=>Date.now()}={}){
  const listings=new Map(), previews=new Map(), lastCreated=new Map(), interactions=new Map();
  const locks=new Map();
  function assertActor(actor) {
    // Discord snowflakes cannot be safely coerced from JS Numbers/objects.
    // This offline model must enforce the same exact actor boundary as the
    // signed HTTP and private PostgreSQL adapters.
    if(!actor || actor.guildId!==GUILD_ID ||
       typeof actor.memberId!=="string" || !SNOWFLAKE.test(actor.memberId))
      throw new Error("Invalid guild member");
    return actor.memberId;
  }
  async function locked(key,operation){
    const prior=locks.get(key)||Promise.resolve();
    let release;
    const current=new Promise(resolve=>{release=resolve;});
    locks.set(key,current);
    await prior;
    try{return await operation();}
    finally{release();if(locks.get(key)===current)locks.delete(key);}
  }
  function preview(actor,draft) {
    const id=assertActor(actor),clean=validateDraft(draft);
    const token=randomUUID();
    previews.set(token,{ownerId:id,guildId:GUILD_ID,draft:clean,createdAt:clock(),consumed:false});
    return {token,text:formatPreview(clean),expiresAt:clock()+PREVIEW_TTL_MS,visibility:"ephemeral"};
  }
  async function confirm(actor,token){
    const id=assertActor(actor);
    if(typeof token!=="string" || !/^[0-9a-f-]{36}$/i.test(token))
      throw new Error("Invalid preview token");
    return locked(id,async()=>{
      const p=previews.get(token);
      if(!p||p.consumed||p.ownerId!==id||p.guildId!==GUILD_ID)
        throw new Error("Preview not found, used, or not yours");
      if(clock()<p.createdAt || clock()-p.createdAt>PREVIEW_TTL_MS){
        previews.delete(token);throw new Error("Preview expired");
      }
      // Validate immediately before creation; no implicit publish occurs.
      const prior=listings.get(id);
      if(prior && prior.status==="active" && prior.expiresAt<=clock())
        listings.set(id,{...prior,status:"expired"});
      if(lastCreated.has(id) && clock()-lastCreated.get(id)<COOLDOWN_MS)
        throw new Error("Creation cooldown active");
      const listing=createListing({ownerId:id,draft:p.draft,nowMs:clock(),existing:[...listings.values()]});
      p.consumed=true;
      listings.set(id,{...listing,listingId:randomUUID(),publishStatus:"not_published"});
      lastCreated.set(id,clock());
      // Mock does NOT create public Discord messages.
      return {listing:listings.get(id),publicPostCreated:false};
    });
  }
  function cancel(actor,token) {
    const id=assertActor(actor);
    const p=previews.get(token);
    if(!p || p.ownerId!==id || p.guildId!==GUILD_ID || p.consumed)
      throw new Error("Preview not found, used, or not yours");
    previews.delete(token);
    return {cancelled:true};
  }
  async function close(actor) {
    const id=assertActor(actor);
    return locked(id,async()=>{
      const listing=listings.get(id);
      const closed=closeListing(listing,id,clock());
      listings.set(id,closed);
      return closed;
    });
  }
  function mine(actor) {
    const id=assertActor(actor);
    const own=listings.get(id);
    return own && activeListings([own],clock()).length?{...own}:null;
  }
  function list(actor) {
    assertActor(actor);
    return activeListings([...listings.values()],clock()).map(x=>({
      listingId:x.listingId,game:x.game,platform:x.platform,vibe:x.vibe,mic:x.mic,
      timezone:x.timezone,availability:x.availability,expiresAt:x.expiresAt
    }));
  }
  // Models a durable unique interaction-ID insert. Actual storage must be cross-instance.
  async function acceptInteraction(interactionId){
    // Never round or coerce a signed interaction's replay key into another
    // member's ID. Only the original primitive Discord string is valid.
    if(typeof interactionId!=="string" || !SNOWFLAKE.test(interactionId))
      throw new Error("Invalid interaction ID");
    return locked("interaction:"+interactionId,async()=>{
      for(const [id,expiry] of interactions)if(expiry<=clock())interactions.delete(id);
      if(interactions.has(interactionId))return false;
      interactions.set(interactionId,clock()+REPLAY_TTL_MS);
      return true;
    });
  }
  return Object.freeze({preview,confirm,cancel,close,mine,list,acceptInteraction});
}
