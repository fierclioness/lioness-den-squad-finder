// Public, random, non-identifying listing reference for Discord post reconciliation.
// This UUID is generated and uniquely stored by PostgreSQL, never a member ID.
// Only trust a reference found in an authenticated, bot-owned Discord message.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MARKER=/^🔎 Den ref: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/im;
export function markerFor(reference){
 if(typeof reference!=="string"||!UUID.test(reference))throw Error("Invalid private listing reference");
 return "🔎 Den ref: "+reference.toLowerCase();
}
export function parseBotMessageReference(content){
 if(typeof content!=="string"||content.length>4000)return null;
 const matches=[...content.matchAll(new RegExp(MARKER.source,"gim"))];
 if(matches.length!==1)return null;
 return matches[0][1].toLowerCase();
}
export function verifyReferenceMatch(reference,content){
 return typeof reference==="string"&&UUID.test(reference)&&
   parseBotMessageReference(content)===reference.toLowerCase();
}
