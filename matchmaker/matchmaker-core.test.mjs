import assert from "node:assert/strict";
import test from "node:test";
import {createListing,closeListing,activeListings,formatPreview,LISTING_TTL_MS,validateDraft} from "./matchmaker-core.mjs";

const ownerId = "1418199180287148073";
const otherId = "1546529501859815438";
const draft = {game:"Call of Duty", platform:"Xbox", vibe:"Casual",mic:"Optional",timezone:"ET",availability:"Saturday evening"};
test("valid opt-in listing and preview",()=>{
 const l=createListing({ownerId,draft,nowMs:1000000});
 assert.equal(l.expiresAt-l.createdAt,LISTING_TTL_MS);
 assert.match(formatPreview(l), /Call of Duty/);
 assert.match(formatPreview(l), /No pressure/);
 assert.equal(activeListings([l],1000001).length,1);
 assert.equal(activeListings([l],l.expiresAt).length,0);
});
test("one active listing and owner-only close",()=>{
 const a=createListing({ownerId,draft,nowMs:1000000});
 assert.throws(()=>createListing({ownerId,draft,existing:[a],nowMs:1000001}),/existing listing/);
 assert.throws(()=>closeListing(a,otherId,1000001),/owner/);
 const closed=closeListing(a,ownerId,1000001);
 assert.equal(closed.status,"closed");
 assert.equal(activeListings([closed],1000002).length,0);
 assert.doesNotThrow(()=>createListing({ownerId,draft,existing:[closed],nowMs:1000002}));
});
test("reject malformed and dangerous values",()=>{
 assert.throws(()=>createListing({ownerId:"someone",draft,nowMs:1000}),/Discord member/);
 assert.throws(()=>validateDraft({...draft,platform:"Anything"}),/Invalid selection/);
 for (const game of ["@everyone","<#123456789012345678>","https://example.com","discord.gg/example","<@&123456789012345678>"]) {
   assert.throws(()=>validateDraft({...draft,game}),/Mentions and links/);
 }
 assert.throws(()=>validateDraft({...draft,game:"a".repeat(56)}),/too long/);
 assert.throws(()=>validateDraft({...draft,availability:"  "}),/missing/);
});

test("consent-aware preview never suggests public chat for private-only drafts",()=>{
 const privateText=formatPreview(draft);
 assert.match(privateText,/only \/squad list shows these preferences/);
 assert.match(privateText,/No #squad-up post/);
 assert.doesNotMatch(privateText,/Reply in #squad-up/);
 const publicText=formatPreview(draft,{publishingEnabled:true});
 assert.match(publicText,/Only after you confirm/);
 assert.match(publicText,/may post this request in #squad-up/);
 assert.throws(()=>formatPreview(draft,{publishingEnabled:"true"}),/Invalid preview publishing mode/);
});

// Offline models must preserve exact Discord snowflakes, just like the signed
// HTTP handler and the private PostgreSQL adapter. Number() can round 19-digit IDs.
test("offline listing ownership never rounds numeric or object-coerced Discord IDs",()=>{
 const rounded=String(Number(ownerId));
 assert.notEqual(rounded,ownerId);
 for(const invalid of [Number(ownerId),BigInt(ownerId),new String(ownerId),{toString:()=>ownerId},null,undefined]){
  assert.throws(()=>createListing({ownerId:invalid,draft,nowMs:1000}),/Discord member/);
 }
 const listing=createListing({ownerId:rounded,draft,nowMs:1000});
 for(const invalid of [Number(ownerId),BigInt(rounded),new String(rounded),{toString:()=>rounded},null,undefined]){
  assert.throws(()=>closeListing(listing,invalid,1001),/owner/);
 }
 assert.equal(closeListing(listing,rounded,1001).status,"closed");
});
