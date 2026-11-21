import test from "node:test";
import assert from "node:assert/strict";
import {makeAuthenticatedSchedulerAdapter} from "./authenticated-scheduler-adapter.mjs";
const req=()=>new Request("https://staging.invalid/functions/v1/den-matchmaker-worker/maintenance",{method:"POST"});
test("scheduler adapter is OFF by default even for a verified secret context",async()=>{
 let calls=0;
 const handle=makeAuthenticatedSchedulerAdapter({gateway:async()=>{calls++;return new Response("ok")}});
 const r=await handle(req(),{authMode:"secret"});
 assert.equal(r.status,503);assert.equal(calls,0);
});
test("only a verified server secret auth context reaches the scheduler gateway",async()=>{
 let calls=0;
 const handle=makeAuthenticatedSchedulerAdapter({enabled:true,gateway:async()=>{calls++;return Response.json({status:"complete"})}});
 for(const context of [undefined,null,{}, {authMode:"none"},{authMode:"user"},{authMode:"publishable"},{authMode:"SECRET"},{authMode:["secret"]}]){
  const r=await handle(req(),context);
  assert.equal(r.status,401);
  assert.deepEqual(await r.json(),{error:"Unauthorized"});
 }
 assert.equal(calls,0);
 const r=await handle(req(),{authMode:"secret"});
 assert.equal(r.status,200);assert.equal(calls,1);
});
test("adapter rejects unsafe construction",()=>{
 assert.throws(()=>makeAuthenticatedSchedulerAdapter({}),/gateway required/);
 assert.throws(()=>makeAuthenticatedSchedulerAdapter({gateway:()=>{},enabled:"true"}),/Boolean/);
 assert.throws(()=>makeAuthenticatedSchedulerAdapter({gateway:()=>{},expectedAuthMode:"none"}),/Only server-to-server/);
});
