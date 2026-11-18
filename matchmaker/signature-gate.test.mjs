import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {makeSignatureGate} from "./signature-gate.mjs";
const {publicKey,privateKey}=generateKeyPairSync("ed25519");
const raw=publicKey.export({format:"der",type:"spki"});
const publicKeyHex=raw.subarray(-32).toString("hex");
const now=1795032000000;
const timestamp=String(now/1000);
const body=(id)=>Buffer.from(JSON.stringify({id,type:1}));
const signHeaders=(bytes,ts=timestamp)=>({rawBody:bytes,timestamp:ts,signature:sign(null,Buffer.concat([Buffer.from(ts),bytes]),privateKey).toString("hex")});
test("accepts correctly signed raw body, rejects replay",()=>{
 const gate=makeSignatureGate({publicKeyHex,clock:()=>now});
 const headers=signHeaders(body("1546529501859815438"));
 assert.equal(gate.authenticate(headers).type,1);
 assert.throws(()=>gate.authenticate(headers),/Replay/);
});
test("rejects forged, stale, and future requests",()=>{
 const gate=makeSignatureGate({publicKeyHex,clock:()=>now});
 const signed=signHeaders(body("1546529501859815438"));
 assert.throws(()=>gate.authenticate({...signed,rawBody:body("1418199180287148073")}),/signature/);
 assert.throws(()=>gate.authenticate({...signed,signature:"00".repeat(64)}),/signature/);
 assert.throws(()=>gate.authenticate(signHeaders(body("1546529501859815438"),String((now-301000)/1000))),/Stale/);
 assert.throws(()=>gate.authenticate(signHeaders(body("1546529501859815438"),String((now+301000)/1000))),/Stale/);
 assert.throws(()=>gate.authenticate({...signed,timestamp:"oops"}),/timestamp/);
});
test("rejects malformed payload and validates limits",()=>{
 const gate=makeSignatureGate({publicKeyHex,clock:()=>now});
 assert.throws(()=>gate.authenticate(signHeaders(body("bad"))),/interaction ID/);
 const malformed=Buffer.from("not json");
 assert.throws(()=>gate.authenticate(signHeaders(malformed)),SyntaxError);
 assert.throws(()=>gate.authenticate(signHeaders(Buffer.alloc(0))),/body/);
});
