// Branch-only signed HTTP replay concurrency checks. No Supabase, Discord,
// guild, production, or real member access. Test keys/IDs are synthetic.
import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {makeMatchmakerHttpHandler} from "./http-handler.mjs";

const {publicKey,privateKey}=generateKeyPairSync("ed25519");
const publicKeyHex=publicKey.export({type:"spki",format:"der"}).subarray(-32).toString("hex");
const timeMs=1795032000000;
const timestamp=String(timeMs/1000);
const guildId="1546529497925296199";
const memberId="1418199180287148073";
const syntheticMember={user:{id:memberId}};

function signedRequest(interaction){
 const body=Buffer.from(JSON.stringify(interaction));
 const signature=sign(null,Buffer.concat([Buffer.from(timestamp),body]),privateKey).toString("hex");
 return new Request("https://staging.invalid/functions/v1/den-matchmaker",{
  method:"POST",
  headers:{"x-signature-ed25519":signature,"x-signature-timestamp":timestamp,
   "content-type":"application/json"},
  body
 });
}
function handler({dispatch,claimReplay}){
 return makeMatchmakerHttpHandler({
  publicKeyHex,clock:()=>timeMs,enabled:true,allowedTesterIds:new Set([memberId]),
  dispatch,claimReplay
 });
}
function durableMock(){
 const claimed=new Set();
 let attempts=0;
 return {
  claimed,
  get attempts(){return attempts;},
  async claimReplay(id){
   attempts++;
   // Yield before the atomic insert to exercise concurrent callers.
   await Promise.resolve();
   if(claimed.has(id))return false;
   claimed.add(id);
   return true;
  }
 };
}
const command=id=>({id,type:2,guild_id:guildId,member:syntheticMember,
 data:{name:"squad",options:[{name:"list"}]}});

test("concurrent identical authentic command deliveries dispatch exactly once",async()=>{
 const store=durableMock();
 let dispatches=0;
 const handle=handler({claimReplay:id=>store.claimReplay(id),
  dispatch:async()=>{dispatches++;await Promise.resolve();return {content:"test-only list"};}});
 const interaction=command("1546529501859815438");
 const results=await Promise.all(Array.from({length:12},()=>handle(signedRequest(interaction))));
 assert.equal(results.filter(r=>r.status===200).length,1);
 assert.equal(results.filter(r=>r.status===401).length,11);
 assert.equal(dispatches,1,"no duplicate command side effects after replay collision");
 assert.equal(store.attempts,12);
 assert.equal(store.claimed.size,1);
 const accepted=await results.find(r=>r.status===200).json();
 assert.equal(accepted.type,4);
 assert.equal(accepted.data.flags,64,"signed commands remain ephemeral");
 assert.equal(accepted.data.content,"test-only list");
});

test("failed command after durable replay claim cannot be redispatched by a retry",async()=>{
 const store=durableMock();
 let dispatches=0;
 const handle=handler({claimReplay:id=>store.claimReplay(id),
  dispatch:async()=>{dispatches++;throw Error("synthetic DB failure - do not leak");}});
 const payload=command("1546529501859815439");
 const initial=await handle(signedRequest(payload));
 assert.equal(initial.status,200);
 const data=await initial.json();
 assert.equal(data.data.flags,64);
 assert.match(data.data.content,/could not complete/i);
 assert.doesNotMatch(JSON.stringify(data),/synthetic DB failure/i);
 const retry=await handle(signedRequest(payload));
 assert.equal(retry.status,401);
 assert.equal(dispatches,1);
 assert.equal(store.claimed.size,1);
});

test("replay storage outage fails closed before any command dispatch",async()=>{
 let dispatches=0;
 const handle=handler({claimReplay:async()=>{throw Error("offline ledger failure");},
  dispatch:async()=>{dispatches++;return {content:"unexpected"};}});
 const response=await handle(signedRequest(command("1546529501859815440")));
 assert.equal(response.status,401);
 assert.deepEqual(await response.json(),{error:"Unauthorized"});
 assert.equal(dispatches,0);
});

test("concurrent differently signed commands reusing one interaction ID cannot both dispatch",async()=>{
 const store=durableMock();
 const executed=[];
 const handle=handler({claimReplay:id=>store.claimReplay(id),
  dispatch:async input=>{executed.push(input.data.options?.[0]?.name);return {content:"test-only response"};}});
 // Two authentic test signatures containing the same interaction ID but
 // different signed commands must still contend for ONE durable replay key.
 const id="1546529501859815441";
 const [first,second]=await Promise.all([
  handle(signedRequest(command(id))),
  handle(signedRequest({...command(id),data:{name:"squad",options:[{name:"mine"}]}}))
 ]);
 assert.deepEqual([first.status,second.status].sort((a,b)=>a-b),[200,401]);
 assert.equal(store.attempts,2);
 assert.equal(store.claimed.size,1);
 assert.equal(executed.length,1,"signed payload variation must not bypass durable replay");
 assert.ok(["list","mine"].includes(executed[0]));
});

test("delayed durable replay claim is never skipped to meet a latency budget",async()=>{
 let releaseClaim;
 let dispatches=0;
 let started=0;
 const handle=handler({
  claimReplay:()=>new Promise(resolve=>{releaseClaim=resolve;}),
  dispatch:async()=>{dispatches++;return {content:"test-only authorized response"};}
 });
 const pending=handle(signedRequest(command("1546529501859815442")));
 // The authenticated callback must NOT acknowledge or dispatch until the
 // durable replay claimant has returned, even if doing so adds latency.
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(typeof releaseClaim,"function");
 assert.equal(dispatches,0);
 releaseClaim(true);
 const response=await pending;
 assert.equal(response.status,200);
 assert.equal(dispatches,1);
 assert.equal((await response.json()).data.flags,64);
});
