import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {makeDiscordVerifier} from "./discord-webcrypto-verifier.mjs";
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
const hex=publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("hex");
const now=1795032000000,timestamp=String(now/1000);
const signed=(object,ts=timestamp)=>{
 const rawBody=new TextEncoder().encode(JSON.stringify(object));
 const signed=new Uint8Array(new TextEncoder().encode(ts).length+rawBody.length);
 signed.set(new TextEncoder().encode(ts),0);signed.set(rawBody,ts.length);
 return {rawBody,timestamp:ts,signature:sign(null,Buffer.from(signed),privateKey).toString("hex")};
};
test("signed request with durable claimant is accepted once",async()=>{
 const seen=new Set();
 const verifier=makeDiscordVerifier({publicKeyHex:hex,clock:()=>now,claimReplay:async id=>{if(seen.has(id))return false;seen.add(id);return true;}});
 const data=signed({id:"1546529501859815438",type:1});
 assert.equal((await verifier.authenticate(data)).type,1);
 await assert.rejects(verifier.authenticate(data),/already handled/);
});
test("invalid or tampered requests fail closed before storage",async()=>{
 let hits=0;
 const v=makeDiscordVerifier({publicKeyHex:hex,clock:()=>now,claimReplay:async()=>{hits++;return true;}});
 const item=signed({id:"1546529501859815438",type:1});
 await assert.rejects(v.authenticate({...item,rawBody:new TextEncoder().encode('{"id":"1546529501859815438","type":2}')}),/signature/);
 await assert.rejects(v.authenticate({...item,timestamp:String((now-301000)/1000)}),/time window/);
 await assert.rejects(v.authenticate({...item,signature:"00".repeat(64)}),/signature/);
 assert.equal(hits,0);
});
test("missing claimant, unavailable claimant and malformed JSON fail closed",async()=>{
 assert.throws(()=>makeDiscordVerifier({publicKeyHex:hex}),/Durable replay/);
 const v=makeDiscordVerifier({publicKeyHex:hex,clock:()=>now,claimReplay:async()=>{throw Error("Database unavailable");}});
 await assert.rejects(v.authenticate(signed({id:"1546529501859815438",type:1})),/Database unavailable/);
 const noJson=new TextEncoder().encode("not json");
 const sig=sign(null,Buffer.concat([Buffer.from(timestamp),Buffer.from(noJson)]),privateKey).toString("hex");
 await assert.rejects(v.authenticate({rawBody:noJson,timestamp,signature:sig}),/Invalid JSON/);
});

test("signature freshness cannot be weakened by unsafe configuration",()=>{
 const basic={publicKeyHex:hex,claimReplay:async()=>true,clock:()=>now};
 for(const maxAgeMs of [-1,0,999,300001,Infinity,NaN,1.5]){
  assert.throws(()=>makeDiscordVerifier({...basic,maxAgeMs}),/bounded to five minutes/);
 }
 assert.throws(()=>makeDiscordVerifier({...basic,clock:null}),/bounded to five minutes/);
 assert.doesNotThrow(()=>makeDiscordVerifier({...basic,maxAgeMs:300000}));
});
