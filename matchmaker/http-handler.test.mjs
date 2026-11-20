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
test("signed HTTP boundary rejects numeric or malformed actor IDs before dispatch",async()=>{
 let dispatches=0;
 // Numeric Discord snowflakes round in JavaScript. The rounded string is
 // deliberately allowlisted here to catch an accidental String(number) bypass.
 const rounded=String(1418199180287148073);
 assert.notEqual(rounded,member.user.id);
 const handle=fixture({enabled:true,allowedTesterIds:new Set([rounded,member.user.id]),
  dispatch:async({memberId})=>{dispatches++;return {content:memberId};}});
 for(const id of [1418199180287148073,123456789012345,null,{},["1418199180287148073"]]){
  const response=await handle(signed({type:2,guild_id,member:{user:{id}},data:{name:"squad"}}));
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.data.flags,64);
  assert.match(body.data.content,/Lioness Den members only/);
 }
 assert.equal(dispatches,0,"Invalid signed actors must never reach the dispatcher");
 const valid=await (await handle(signed({type:2,guild_id,member,data:{name:"squad"}}))).json();
 assert.equal(valid.data.content,member.user.id);
 assert.equal(dispatches,1);
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


test("stalled signed request bodies are cancelled before signature, replay, or dispatch",async()=>{
 let claims=0,dispatches=0,cancelled=false;
 const handle=fixture({enabled:true,bodyReadTimeoutMs:50,
  claimReplay:async()=>{claims++;return true;},
  dispatch:async()=>{dispatches++;return {content:"should not run"};}
 });
 // Deliver the first bytes, then leave the stream indefinitely open.
 // The request is rejected at the pre-authentication read boundary.
 const stream=new ReadableStream({
  start(controller){controller.enqueue(new TextEncoder().encode('{"id":"1546529501859815438"'));},
  cancel(){cancelled=true;}
 });
 const req=new Request("https://example.invalid/functions/v1/den-matchmaker",{
  method:"POST",duplex:"half",
  headers:{"x-signature-ed25519":"00".repeat(64),"x-signature-timestamp":ts},
  body:stream
 });
 const started=performance.now();
 const res=await handle(req);
 assert.equal(res.status,408);
 assert.deepEqual(await res.json(),{error:"Request timeout"});
 assert.ok(performance.now()-started<1000,"Must bound a stalled body, not wait for peer completion");
 assert.equal(claims,0);
 assert.equal(dispatches,0);
 assert.equal(cancelled,true);
});
test("body deadline configuration is bounded and normal signed PING still succeeds",async()=>{
 for(const invalid of [0,24,2001,Infinity,"1500",null]){
  assert.throws(()=>fixture({bodyReadTimeoutMs:invalid}),/body read timeout/);
 }
 const handle=fixture({bodyReadTimeoutMs:500});
 const res=await handle(signed({type:1}));
 assert.equal(res.status,200);
 assert.deepEqual(await res.json(),{type:1});
});

test("body deadline is cumulative across slow-but-continuing chunks",async()=>{
 let claims=0,dispatches=0,cancelled=false;
 const handle=fixture({enabled:true,bodyReadTimeoutMs:120,
  claimReplay:async()=>{claims++;return true;},
  dispatch:async()=>{dispatches++;return {content:"unexpected"};}
 });
 // Each 70ms interval is individually shorter than the 120ms limit.
 // Resetting the timer on each chunk would allow all chunks and produce 401
 // from the deliberately invalid signature, instead of the required 408.
 let timers=[];
 const stream=new ReadableStream({
  start(controller){
   controller.enqueue(new Uint8Array([123]));
   timers=[
    setTimeout(()=>controller.enqueue(new Uint8Array([32])),70),
    setTimeout(()=>controller.enqueue(new Uint8Array([32])),140),
    setTimeout(()=>controller.close(),210)
   ];
  },
  cancel(){cancelled=true;for(const timer of timers)clearTimeout(timer);}
 });
 const res=await handle(new Request("https://example.invalid/functions/v1/den-matchmaker",{
  method:"POST",duplex:"half",
  headers:{"x-signature-ed25519":"00".repeat(64),"x-signature-timestamp":ts},
  body:stream
 }));
 assert.equal(res.status,408,"Total read deadline must not restart after each chunk");
 assert.equal(claims,0);
 assert.equal(dispatches,0);
 assert.equal(cancelled,true);
});

test("stream transport failure and malformed Content-Length fail before replay",async()=>{
 let claims=0;
 const handle=fixture({claimReplay:async()=>{claims++;return true;}});
 const failed=new ReadableStream({
  start(controller){controller.error(new Error("transport reset"));}
 });
 const broken=await handle(new Request("https://example.invalid",{
  method:"POST",duplex:"half",body:failed,
  headers:{"x-signature-ed25519":"00".repeat(64),"x-signature-timestamp":ts}
 }));
 assert.equal(broken.status,401);
 for(const length of ["-1","not-a-number","1048577"]){
  const res=await handle(new Request("https://example.invalid",{
   method:"POST",body:"{}",headers:{
    "content-length":length,"x-signature-ed25519":"00".repeat(64),
    "x-signature-timestamp":ts
   }
  }));
  assert.equal(res.status,413);
 }
 assert.equal(claims,0);
});

test("only primitive UUID preview tokens may become clickable confirmation components",async()=>{
 const valid="11111111-1111-4111-8111-111111111111";
 let token;
 const handle=fixture({enabled:true,dispatch:async()=>({
  content:"Review",
  buttons:[{action:"confirm",token,label:"Post to #squad-up"},
           {action:"cancel",token,label:"Cancel"}]
 })});
 for(const bad of [new String(valid),{toString:()=>valid},[valid],12345,null,valid+"extra"]){
  token=bad;
  const body=await (await handle(signed({type:2,guild_id,member,data:{name:"squad"}}))).json();
  assert.equal(body.data.flags,64);
  assert.equal(body.data.components,undefined,"Untrusted preview tokens cannot become Discord action IDs");
 }
 token=valid;
 const success=await (await handle(signed({type:2,guild_id,member,data:{name:"squad"}}))).json();
 assert.equal(success.data.components[0].components[0].custom_id,"mm:confirm:"+valid+":public");
});
