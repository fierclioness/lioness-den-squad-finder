// Mock-only Discord command workflow. No Discord SDK, API, webhooks, or database writes.
// Production must use durable atomic storage, authenticated guild identity, signed callbacks,
// and cross-instance rate limits instead of this in-memory demonstration.
import {createListing, closeListing, activeListings, formatPreview, validateDraft} from "./matchmaker-core.mjs";

export const COMMANDS = Object.freeze(["create","list","mine","close"]);
export const EPHEMERAL = 64;
const SNOWFLAKE = /^\d{15,22}$/;
const GUILD_ID = "1546529497925296199";
function validActor(actor) {
  if (!actor || !SNOWFLAKE.test(String(actor.memberId)) || actor.guildId !== GUILD_ID)
    throw new Error("This command is only for signed-in Lioness Den members");
  return String(actor.memberId);
}
export function makeMockMatchmaker({clock = () => Date.now()} = {}) {
  const listings = new Map();
  const pending = new Map();
  const cooldown = new Map();
  const asResponse = (content, extra = {}) => ({visibility:"ephemeral", flags:EPHEMERAL, content, ...extra});

  // These names model /squad create, /squad mine, /squad list, /squad close.
  function create(actor,draft) {
    const memberId=validActor(actor);
    if (listings.has(memberId) && activeListings([listings.get(memberId)],clock()).length)
      return asResponse("You already have an active squad listing. Use /squad close first.");
    const clean=validateDraft(draft);
    pending.set(memberId,{draft:clean,preparedAt:clock()});
    return asResponse("Review your squad request. Nothing is posted until you confirm.", {
      preview:formatPreview(clean), actions:["confirm","cancel"]
    });
  }
  function confirm(actor) {
    const memberId=validActor(actor);
    const saved=pending.get(memberId);
    if (!saved) return asResponse("No pending preview. Start with /squad create.");
    if (clock()-saved.preparedAt>10*60*1000) {
      pending.delete(memberId); return asResponse("Preview expired. Please create it again.");
    }
    // Rate limit: once per 60 seconds even when a previous listing was closed.
    if (clock()-(cooldown.get(memberId)??-Infinity)<60000)
      return asResponse("Please wait a minute before creating another squad listing.");
    let listing;
    try {listing=createListing({ownerId:memberId,draft:saved.draft,nowMs:clock(),existing:[...listings.values()]});}
    catch(err){pending.delete(memberId);return asResponse(err.message);}
    listings.set(memberId,listing);cooldown.set(memberId,clock());pending.delete(memberId);
    // Deliberately returns private draft for future explicit Discord publishing.
    return asResponse("Listing confirmed for this prototype. No Discord message was posted.",{
      listing, preview:formatPreview(listing), mockOnly:true
    });
  }
  function cancel(actor) {
    const memberId=validActor(actor);pending.delete(memberId);
    return asResponse("Preview cancelled. No listing created or posted.");
  }
  function mine(actor) {
    const memberId=validActor(actor), listing=listings.get(memberId);
    return asResponse(listing && activeListings([listing],clock()).length?
      "Your active squad listing:":"You have no active squad listing.",{
      listing:listing&&activeListings([listing],clock()).length?listing:null
    });
  }
  function list(actor) {
    validActor(actor);
    return asResponse("Active squad requests (preview only; no Discord messages sent).", {
      listings:activeListings([...listings.values()],clock()).map(l=>({
        game:l.game,platform:l.platform,vibe:l.vibe,mic:l.mic,
        timezone:l.timezone,availability:l.availability,expiresAt:l.expiresAt
      }))
    });
  }
  function close(actor) {
    const memberId=validActor(actor),listing=listings.get(memberId);
    if (!listing || !activeListings([listing],clock()).length)
      return asResponse("You have no active listing to close.");
    const closed=closeListing(listing,memberId,clock());
    listings.set(memberId,closed);
    return asResponse("Your squad listing is closed.",{mockOnly:true});
  }
  return Object.freeze({create,confirm,cancel,mine,list,close});
}
