import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {makeMatchmakerHttpHandler} from "./http-handler.mjs";
const pair=generateKeyPairSync("ed25519");
const hex=pair.publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("hex");
const now=1795032000000,ts=String(now/1000);
let sequence=1546529501859815438n;
function signed(obj,options={}){
 const data={id:String(++sequence),...obj};
 const raw=Buffer.from(JSON.stringify(data));
 const signature=sign(null,Buffer.concat([Buffer.from(ts),raw]),pair.privateKey).toString("hex");
 return new Request("https://example.invalid/functions/v1/den-matchmaker",{
  method:"POST",
  headers:{"x-signature-ed25519":options.badSignature?"00".repeat(64):signature,
           "x-signature-timestamp":ts,"content-type":"application/json"},
  body:raw
 });
}
const guild_id="1546529497925296199",member={user:{id:"1418199180287148073"}};
function fixture(overrides={}){
 const replay=new Set();
 return makeMatchmakerHttpHandler({publicKeyHex:hex,clock:()=>now,
  allowedTesterIds:new Set(["1418199180287148073"]),
  claimReplay:async id=>{if(replay.has(id))return false;replay.add(id);return true;},...overrides});
}
test("only signed PING accepted; disabled endpoint makes no public post",async()=>{
 const handle=fixture();
 const ping=await handle(signed({type:1}));assert.equal(ping.status,200);assert.deepEqual(await ping.json(),{type:1});
 const cmd=await handle(signed({type:2,guild_id,member,data:{name:"squad",options:[{name:"list"}]}}));
 const body=await cmd.json();
 assert.equal(body.data.flags,64);assert.match(body.data.content,/development/);
 assert.deepEqual(body.data.allowed_mentions,{parse:[]});
});
test("unsigned, forged and invalid methods rejected",async()=>{
 const handle=fixture();
 assert.equal((await handle(new Request("https://example.invalid",{method:"GET"}))).status,405);
 assert.equal((await handle(new Request("https://example.invalid",{method:"POST",body:"{}"}))).status,401);
 assert.equal((await handle(signed({type:1},{badSignature:true}))).status,401);
});
test("cross-guild rejected and dispatcher cannot create non-ephemeral replies",async()=>{
 let calls=0;
 const handle=fixture({enabled:true,dispatch:async()=>{calls++;return {content:"Only a private response",flags:0};}});
 const wrong=await (await handle(signed({type:2,guild_id:"999999999999999999",member,data:{name:"squad"}}))).json();
 assert.equal(wrong.data.flags,64);
 assert.equal(calls,0);
 const good=await (await handle(signed({type:2,guild_id,member,data:{name:"squad"}}))).json();
 assert.equal(calls,1);
 assert.equal(good.data.flags,64);
 assert.equal(good.data.content,"Only a private response");
});
test("unavailable replay ledger denies valid signed request",async()=>{
 const handle=makeMatchmakerHttpHandler({publicKeyHex:hex,clock:()=>now,claimReplay:async()=>{throw Error("db down");}});
 assert.equal((await handle(signed({type:1}))).status,401);
});

test("streamed payload without Content-Length is bounded before signature or replay storage",async()=>{
 let claims=0,pulls=0;
 const handle=fixture({claimReplay:async()=>{claims++;return true;}});
 const stream=new ReadableStream({
  pull(controller){
   pulls++;
   if(pulls>8)return controller.close();
   controller.enqueue(new Uint8Array(256*1024));
  }
 });
 const req=new Request("https://example.invalid/functions/v1/den-matchmaker",{
  method:"POST",duplex:"half",
  headers:{"x-signature-ed25519":"00".repeat(64),"x-signature-timestamp":ts},
  body:stream
 });
 const res=await handle(req);
 assert.equal(res.status,413);
 assert.deepEqual(await res.json(),{error:"Payload too large"});
 assert.equal(claims,0);
 assert.ok(pulls<=8,"Must stop reading once the limit is crossed");
});
test("declared oversized payload is rejected before reading or storing any replay ID",async()=>{
 let claims=0;
 const handle=fixture({claimReplay:async()=>{claims++;return true;}});
 const req=new Request("https://example.invalid",{
  method:"POST",headers:{"content-length":"1048577",
   "x-signature-ed25519":"00".repeat(64),"x-signature-timestamp":ts},body:"{}"
 });
 const res=await handle(req);
 assert.equal(res.status,413);
 assert.equal(claims,0);
});

test("preview buttons bind publishing consent to the exact button identifiers",async()=>{
 const token="11111111-1111-4111-8111-111111111111";
 for(const [label,mode] of [["Save to /squad list","private"],["Post to #squad-up","public"]]){
  const handle=fixture({enabled:true,dispatch:async()=>({
   content:"Review",buttons:[{action:"confirm",token,label},{action:"cancel",token,label:"Cancel"}]
  })});
  const res=await handle(signed({type:2,guild_id,member,data:{name:"squad"}}));
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.data.flags,64);
  assert.equal(body.data.components[0].components[0].custom_id,"mm:confirm:"+token+":"+mode);
  assert.equal(body.data.components[0].components[1].custom_id,"mm:cancel:"+token+":"+mode);
 }
});

test("enabled commands cannot accidentally authorize the whole guild",()=>{
 assert.throws(()=>fixture({enabled:true,allowedTesterIds:null}),/nonempty tester allowlist/);
 assert.throws(()=>fixture({enabled:true,allowedTesterIds:new Set()}),/nonempty tester allowlist/);
 assert.throws(()=>fixture({enabled:"true"}),/feature gate/);
 // Explicitly disabled signed PING remains available before a tester list is configured.
 assert.doesNotThrow(()=>fixture({enabled:false,allowedTesterIds:null}));
});
test("tester authorization is immutable after setup and requires exact string IDs",async()=>{
 const initial=new Set([member.user.id]);
 let dispatches=0;
 const handle=fixture({enabled:true,allowedTesterIds:initial,
   dispatch:async()=>{dispatches++;return {content:"authorized"};}});
 // Simulate an accidental or malicious mutation in the deployment config.
 initial.clear();
 initial.add("1546529501859815438");
 const valid=await (await handle(signed({type:2,guild_id,member,data:{name:"squad"}}))).json();
 assert.equal(valid.data.content,"authorized");
 const stranger={user:{id:"1546529501859815438"}};
 const denied=await (await handle(signed({type:2,guild_id,member:stranger,data:{name:"squad"}}))).json();
 assert.match(denied.data.content,/authorized testers/);
 assert.equal(dispatches,1,"A mutated source Set cannot grant extra access");
 for(const invalid of [1418199180287148073n,1418199180287148073,null,{}]){
  assert.throws(()=>fixture({enabled:true,allowedTesterIds:new Set([invalid])}),/tester allowlist/);
 }
});

test("restricted staging test allowlist rejects other members before dispatch",async()=>{
 let calls=0;
 const handle=fixture({enabled:true,allowedTesterIds:new Set(["1418199180287148073"]),dispatch:async()=>{calls++;return {content:"ok"};}});
 const stranger={user:{id:"1546529501859815438"}};
 const denied=await (await handle(signed({type:2,guild_id,member:stranger,data:{name:"squad"}}))).json();
 assert.match(denied.data.content,/authorized testers/);
 assert.equal(denied.data.flags,64);
 assert.equal(calls,0);
 const allowed=await (await handle(signed({type:2,guild_id,member,data:{name:"squad"}}))).json();
 assert.equal(allowed.data.content,"ok");
 assert.equal(calls,1);
 assert.throws(()=>fixture({allowedTesterIds:new Set(["bad"])}),/allowlist/);
});
