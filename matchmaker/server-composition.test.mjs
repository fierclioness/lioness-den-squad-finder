import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {makeMatchmakerServer} from "./server-composition.mjs";
const pair=generateKeyPairSync("ed25519");
const publicKeyHex=pair.publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("hex");
const now=1795032000000,stamp=String(now/1000);
let seq=1572091972217257000n;
function signed(data){
  const payload=Buffer.from(JSON.stringify({id:String(++seq),...data}));
  return new Request("https://example.invalid/den-matchmaker",{
    method:"POST",
    headers:{"x-signature-ed25519":sign(null,Buffer.concat([Buffer.from(stamp),payload]),pair.privateKey).toString("hex"),
             "x-signature-timestamp":stamp,"content-type":"application/json"},
    body:payload
  });
}
const guild_id="1546529497925296199",member={user:{id:"1418199180287148073"}};
test("server starts disabled and cannot change any listing",async()=>{
  const calls=[],seen=new Set();
  const query=async(sql,params)=>{
    calls.push({sql,params});
    if(sql.includes("claim_interaction")){
      const id=params[0], accepted=!seen.has(id);seen.add(id);return {rows:[{accepted}]};
    }
    throw Error("Disabled handler must not access listing functions");
  };
  const server=makeMatchmakerServer({publicKeyHex,query,clock:()=>now});
  const ping=await server(signed({type:1}));
  assert.deepEqual(await ping.json(),{type:1});
  const r=await server(signed({type:2,guild_id,member,data:{name:"squad",options:[{name:"list"}]}}));
  assert.equal(r.status,200);
  const data=await r.json();
  assert.equal(data.data.flags,64);
  assert.match(data.data.content,/in development/);
  assert.equal(calls.length,2);
  assert.ok(calls.every(x=>x.sql.includes("claim_interaction")));
});
test("server fails closed when private DB connection fails",async()=>{
 const server=makeMatchmakerServer({publicKeyHex,query:async()=>{throw Error("private DB unavailable");},enabled:true,clock:()=>now});
 const ping=await server(signed({type:1}));
 assert.equal(ping.status,401);
});
test("invalid configuration cannot enable or weaken server",()=>{
 assert.throws(()=>makeMatchmakerServer({publicKeyHex}),/database query/);
 assert.throws(()=>makeMatchmakerServer({publicKeyHex,query:async()=>({rows:[]}),enabled:"true"}),/boolean/);
 assert.throws(()=>makeMatchmakerServer({publicKeyHex,query:async()=>({rows:[]}),publishingEnabled:true}),/Publishing requires/);
 assert.throws(()=>makeMatchmakerServer({publicKeyHex,query:async()=>({rows:[]}),enabled:true,publishingEnabled:"true"}),/Publishing requires/);
});
