import test from "node:test";
import assert from "node:assert/strict";
import {markerFor,parseBotMessageReference,verifyReferenceMatch} from "./listing-reference.mjs";
const id="5d6e21e8-2637-4f6d-91b6-a51549a087e5";
test("round-trip one random opaque reference, not a member ID",()=>{
 const marker=markerFor(id);
 assert.equal(parseBotMessageReference("🎮 COD\n"+marker),id);
 assert.equal(verifyReferenceMatch(id,"🎮 COD\n"+marker),true);
 assert.doesNotMatch(marker,/1418199180287148073/);
});
test("missing, wrong or duplicated markers cannot establish identity",()=>{
 assert.equal(parseBotMessageReference("Hello!"),null);
 assert.equal(verifyReferenceMatch(id,markerFor("11111111-1111-4111-8111-111111111111")),false);
 assert.equal(parseBotMessageReference(markerFor(id)+"\n"+markerFor(id)),null);
 assert.equal(parseBotMessageReference("🔎 Den ref: <script>"),null);
});
test("cannot emit unaudited member-supplied reference",()=>{
 assert.throws(()=>markerFor("1418199180287148073"),/Invalid/);
 assert.throws(()=>markerFor("@everyone"),/Invalid/);
});
