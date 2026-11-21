// Pure, offline MVP logic for The Lioness Den's opt-in squad listings.
// No Discord network access, member reads, database writes, or automatic DMs.
export const LISTING_TTL_MS = 36 * 60 * 60 * 1000;
export const PLATFORMS = Object.freeze(["Xbox","PlayStation","PC","Switch","Cross-play","Other"]);
export const VIBES = Object.freeze(["Casual","Competitive","Either"]);
export const MIC = Object.freeze(["Optional","Required","No mic"]);
export const ZONES = Object.freeze(["ET","CT","MT","PT","AT","UK","CET/CEST","UTC","Other"]);
const SNOWFLAKE = /^\d{15,22}$/;
// Reject invisible control/direction marks before preview or storage so
// private /squad responses cannot be visually impersonated by user text.
// Block invisible soft hyphen/zero-width space/word joiner and grapheme controls
// that could hide extra text in a preference; retain ZWJ for emoji sequences.
// Keep ordinary Unicode, accents and emoji (including ZWJ sequences) valid.
const INVISIBLE_LAYOUT = /[\u0080-\u009f\u00ad\u034f\u061c\u180e\u200b\u200e\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;

function plain(value, max) {
  if (typeof value !== "string") throw new Error("Invalid text");
  if (INVISIBLE_LAYOUT.test(value)) throw new Error("Unsafe invisible or directional text");
  const text = value.trim().replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ");
  if (!text || text.length > max) throw new Error("Text missing or too long");
  if (/@everyone|@here|<@!?|<@&|<#|https?:\/\/|discord\.gg/i.test(text)) {
    throw new Error("Mentions and links are not allowed in squad listings");
  }
  return text.replace(/@/g,"＠"); // Prevent unexpected Discord mention syntax.
}
function choose(value, options) {
  if (!options.includes(value)) throw new Error("Invalid selection");
  return value;
}
// Also protect private Discord previews: the trusted bot template must not be
// re-styled as a heading, spoiler, hyperlink or code block by a preference.
export function escapeDiscordDisplay(value) {
  if (typeof value !== "string") throw new Error("Invalid display value");
  return value.replace(/([\\`*_~|>#\[\]()!])/g, "\\$1");
}
export function validateDraft(draft) {
  if (!draft || typeof draft !== "object") throw new Error("Invalid draft");
  return {
    game: plain(draft.game, 55),
    platform: choose(draft.platform, PLATFORMS),
    vibe: choose(draft.vibe, VIBES),
    mic: choose(draft.mic, MIC),
    timezone: choose(draft.timezone, ZONES),
    availability: plain(draft.availability, 70)
  };
}
export function createListing({ownerId, draft, nowMs = Date.now(), existing = []}) {
  if (typeof ownerId !== "string" || !SNOWFLAKE.test(ownerId)) throw new Error("Invalid Discord member ID");
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error("Invalid timestamp");
  if (existing.some(item => item.ownerId === ownerId && item.status === "active" && item.expiresAt > nowMs)) {
    throw new Error("Close your existing listing before making another");
  }
  const fields = validateDraft(draft);
  return Object.freeze({
    ownerId,
    ...fields,
    createdAt: nowMs,
    expiresAt: nowMs + LISTING_TTL_MS,
    status: "active"
  });
}
export function closeListing(listing, requesterId, nowMs = Date.now()) {
  if (!listing || typeof requesterId !== "string" || !SNOWFLAKE.test(requesterId) || listing.ownerId !== requesterId)
    throw new Error("Only the listing owner may close it");
  if (listing.status !== "active" || listing.expiresAt <= nowMs) throw new Error("Listing not active");
  return {...listing, status:"closed", closedAt:nowMs};
}
export function activeListings(listings, nowMs = Date.now()) {
  return listings.filter(item => item.status === "active" && item.expiresAt > nowMs);
}
export function formatPreview(listing,{publishingEnabled=false}={}) {
  if(typeof publishingEnabled!=="boolean")throw Error("Invalid preview publishing mode");
  const d = validateDraft(listing);
  return [
    "👑 THE LIONESS DEN | SQUAD MATCHMAKER",
    "🎮 Game: " + escapeDiscordDisplay(d.game),
    "🕹️ Platform: " + escapeDiscordDisplay(d.platform),
    "✨ Vibe: " + escapeDiscordDisplay(d.vibe),
    "🎧 Mic: " + escapeDiscordDisplay(d.mic),
    "🕒 Availability: " + escapeDiscordDisplay(d.availability) + " (" + escapeDiscordDisplay(d.timezone) + ")",
    "",
    publishingEnabled
      ? "Only after you confirm, the bot may post this request in #squad-up. No pressure, no automatic DMs. 💕"
      : "After you save, only /squad list shows these preferences. No pressure. No #squad-up post or automatic DMs. 💕"
  ].join("\n");
}
