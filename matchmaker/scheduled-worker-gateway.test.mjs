import test from "node:test";
import assert from "node:assert/strict";
import {makeScheduledWorkerGateway} from "./scheduled-worker-gateway.mjs";
const secret="dev-only-not-a-real-scheduler-secret-123456789";
const request=(path="/run/cleanup",{key=secret,method="POST",body}={})=>
 new Request("https://example.invalid"+path,{
  method,headers:{"x-matchmaker-scheduler-key":key},
  ...(body?{body}: {})
 });
test("scheduler disabled by default: no authentication, writes or Discord calls",async()=>{
 let calls=0;
 const handler=makeScheduledWorkerGateway({publisher:{runOnce:async()=>{calls++;}}});
 const r=await handler(request("/run/publish"));
 assert.equal(r.status,503);
 assert.deepEqual(await r.json(),{status:"disabled"});
 assert.equal(calls,0);
});
test("only a long scheduler key can access a separately enabled task",async()=>{
 let cleanupCalls=0,publishCalls=0;
 const handler=makeScheduledWorkerGateway({enabled:true,schedulerSecret:secret,
  cleanupEnabled:true,postingEnabled:false,
  cleanup:{runOnce:async()=>{cleanupCalls++;return {status:"deleted",messageId:"should-never-leak"};}},
  publisher:{runOnce:async()=>{publishCalls++;return {status:"posted"};}}
 });
 for(const key of ["wrong","wrong-scheduler-key-is-long-enough-123456",null]){
  const r=await handler(request("/run/cleanup",{key:key??""}));
  assert.equal(r.status,401);
 }
 assert.equal(cleanupCalls,0);
 assert.equal((await handler(request("/run/publish"))).status,403);
 assert.equal(publishCalls,0);
 const accepted=await handler(request("/run/cleanup"));
 assert.equal(accepted.status,200);
 const raw=await accepted.text();
 assert.deepEqual(JSON.parse(raw),{task:"cleanup",status:"deleted"});
 assert.equal(cleanupCalls,1);
 assert.doesNotMatch(raw,/should-never-leak|secret/);
});
test("fail closed on malformed task, wrong method and any request body",async()=>{
 const handler=makeScheduledWorkerGateway({enabled:true,schedulerSecret:secret,
  maintenanceEnabled:true,maintenance:{runOnce:async()=>({status:"complete",expired:2})}});
 assert.equal((await handler(request("/run/not-a-task"))).status,404);
 assert.equal((await handler(request("/run/maintenance",{method:"GET"}))).status,405);
 assert.equal((await handler(request("/run/maintenance",{body:"{}"}))).status,400);
 const result=await handler(request("/run/maintenance"));
 assert.deepEqual(await result.json(),{task:"maintenance",status:"complete"});
});
test("configuration rejects missing secret, inconsistent flags and missing workers",()=>{
 assert.throws(()=>makeScheduledWorkerGateway({enabled:true}),/scheduler secret/);
 assert.throws(()=>makeScheduledWorkerGateway({postingEnabled:true}),/scheduler is disabled/);
 assert.throws(()=>makeScheduledWorkerGateway({enabled:true,schedulerSecret:secret,cleanupEnabled:true}),/worker is missing/);
 assert.throws(()=>makeScheduledWorkerGateway({enabled:"true"}),/booleans/);
});
test("worker exception or untrusted result never leaks details",async()=>{
 const handler=makeScheduledWorkerGateway({enabled:true,schedulerSecret:secret,
  postingEnabled:true,publisher:{runOnce:async()=>{throw Error("private member ID 123 and bot token");}}});
 const r=await handler(request("/run/publish"));
 assert.equal(r.status,503);
 assert.deepEqual(await r.json(),{error:"Worker unavailable"});
 const bad=makeScheduledWorkerGateway({enabled:true,schedulerSecret:secret,
  postingEnabled:true,publisher:{runOnce:async()=>({status:"custom",member:"sensitive"})}});
 assert.equal((await bad(request("/run/publish"))).status,503);
});
