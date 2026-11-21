import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {makeMatchmakerHttpHandler} from "./http-handler.mjs";
import {makeMatchmakerDispatcher} from "./command-dispatcher.mjs";
import {makeTransactionalMock} from "./transactional-mock.mjs";

const pair=generateKeyPairSync("ed25519");
const publicKeyHex=pair.publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("hex");
const now=1795032000000, ts=String(now/1000);
const guild_id="1546529497925296199", member={user:{id:"1418199180287148073"}};
const other={user:{id:"1546529501859815438"}};
const draft={game:"Call of Duty",platform:"Xbox",vibe:"Casual",mic:"Optional",timezone:"ET",availability:"Saturday evening"};
let seq=1546529501859815438n;
function request(data){
 const bytes=Buffer.from(JSON.stringify({id:String(++seq),...data}));
 return new Request("https://example.invalid/functions/v1/den-matchmaker",{
  method:"POST",
  headers:{"x-signature-ed25519":sign(null,Buffer.concat([Buffer.from(ts),bytes]),pair.privateKey).toString("hex"),
           "x-signature-timestamp":ts,"content-type":"application/json"},
  body:bytes
 });
}
const cmd=(user,name,options=[])=>({type:2,guild_id,member:user,data:{name:"squad",options:[{name,options}]}});
const button=(user,custom_id)=>({type:3,guild_id,member:user,data:{custom_id}});
function system(){
 const state=makeTransactionalMock({clock:()=>now});
 const store={
  prepare:(a,d)=>state.preview(a,d),
  confirm:(a,t)=>state.confirm(a,t),
  cancel:(a,t)=>state.cancel(a,t),
  mine:a=>state.mine(a), list:a=>state.list(a),
  close:async a=>{try{return (await state.close(a)).status==="closed";}catch{return false;}}
 };
 const replay=new Set();
 return makeMatchmakerHttpHandler({
  publicKeyHex,clock:()=>now,enabled:true,
  // Both are explicit mock testers so stolen-preview rejection exercises
  // token ownership, not just the surrounding allowlist check.
  allowedTesterIds:new Set([member.user.id,other.user.id]),
  dispatch:makeMatchmakerDispatcher({store}),
  claimReplay:async id=>{if(replay.has(id))return false;replay.add(id);return true;}
 });
}
test("end-to-end signed mock interaction: preview, owner confirm, list, close",async()=>{
 const handle=system();
 const options=Object.entries(draft).map(([name,value])=>({name,value}));
 const first=await (await handle(request(cmd(member,"create",options)))).json();
 assert.equal(first.data.flags,64);
 assert.deepEqual(first.data.allowed_mentions,{parse:[]});
 assert.equal(first.data.components[0].components.length,2);
 assert.equal(first.data.components[0].components[0].label,"Save to /squad list");
 assert.match(first.data.content,/other Matchmaker users can see/);
 assert.match(first.data.content,/Nothing has been posted/);
 const confirm=first.data.components[0].components[0].custom_id;
 const stolen=await (await handle(request(button(other,confirm)))).json();
 assert.match(stolen.data.content,/could not complete/i);
 const confirmed=await (await handle(request(button(member,confirm)))).json();
 assert.match(confirmed.data.content,/Nothing was posted/);
 assert.equal(confirmed.data.flags,64);
 const duplicate=await (await handle(request(button(member,confirm)))).json();
 assert.match(duplicate.data.content,/could not complete/i);
 const listings=await (await handle(request(cmd(member,"list")))).json();
 assert.match(listings.data.content,/Call of Duty/);
 assert.deepEqual(listings.data.allowed_mentions,{parse:[]});
 assert.doesNotMatch(listings.data.content,/1418199180287148073/);
 assert.match((await (await handle(request(cmd(member,"close")))).json()).data.content,/closed/);
 assert.match((await (await handle(request(cmd(member,"list")))).json()).data.content,/No active/);
});
test("cancelled preview never confirms and wrong guild cannot dispatch",async()=>{
 const handle=system();
 const options=Object.entries(draft).map(([name,value])=>({name,value}));
 const created=await (await handle(request(cmd(member,"create",options)))).json();
 const cancelled=await (await handle(request(button(member,created.data.components[0].components[1].custom_id)))).json();
 assert.match(cancelled.data.content,/cancelled/);
 const later=await (await handle(request(button(member,created.data.components[0].components[0].custom_id)))).json();
 assert.match(later.data.content,/could not complete/i);
 const wrong=await (await handle(request({...cmd(member,"list"),guild_id:"999999999999999999"}))).json();
 assert.match(wrong.data.content,/only/i);
});

test("concurrent identical signed interaction is dispatched exactly once",async()=>{
 const handle=system();
 const request1=request(cmd(member,"list"));
 // Cloning preserves the exact signature, timestamp, body and replay ID.
 const request2=request1.clone();
 const responses=await Promise.all([handle(request1),handle(request2)]);
 assert.deepEqual(responses.map(r=>r.status).sort((a,b)=>a-b),[200,401]);
 const bodies=await Promise.all(responses.map(r=>r.json()));
 assert.equal(bodies.filter(x=>x?.data?.flags===64).length,1);
 assert.equal(bodies.filter(x=>x?.error==="Unauthorized").length,1);
});

// Offline signed end-to-end containment of stored preference text. This is
// NOT a real Discord-client latency test or authorization to enable posting.
test("signed private list response keeps whole escaped rows and visible omissions",async()=>{
 const long={...draft,game:"*".repeat(55),availability:"_".repeat(70)};
 const rows=Array.from({length:10},()=>({...long}));
 const store={
  prepare:async()=>null,confirm:async()=>null,cancel:async()=>false,
  mine:async()=>null,list:async()=>rows,close:async()=>false
 };
 const handle=makeMatchmakerHttpHandler({
  publicKeyHex,clock:()=>now,enabled:true,
  allowedTesterIds:new Set([member.user.id]),claimReplay:async()=>true,
  dispatch:makeMatchmakerDispatcher({store})
 });
 const response=await handle(request(cmd(member,"list")));
 const body=await response.json();
 assert.equal(response.status,200);
 assert.equal(body.type,4);
 assert.equal(body.data.flags,64);
 assert.deepEqual(body.data.allowed_mentions,{parse:[]});
 assert.ok(body.data.content.length<=1800);
 assert.match(body.data.content,/Additional listings omitted to fit the response limit\.$/);
 assert.match(body.data.content,/\\\*\\\*\\\*/);
});
