import test from "node:test";
import assert from "node:assert/strict";
import {makeSupabaseAuthenticatedScheduler} from "./supabase-authenticated-scheduler.mjs";
import {makeScheduledWorkerGateway} from "./scheduled-worker-gateway.mjs";

const schedulerSecret="offline-only-scheduler-secret-1234567890";
const request=(headers={})=>new Request(
 "https://staging.invalid/functions/v1/den-matchmaker-worker/maintenance",
 {method:"POST",headers}
);
test("end-to-end mock auth layers reject invalid API key and scheduler key before private work",async()=>{
 let work=0;
 const expectedApiKey="test-only-dedicated-named-secret-not-real";
 // Simulate the wrapper's independent API key verification. This does not
 // establish that the real Supabase SDK behaves identically.
 const withSupabase=(options,handler)=>{
  assert.deepEqual(options,{auth:"secret:den_matchmaker_scheduler"});
  return async req=>{
   if(req.headers.get("apikey")!==expectedApiKey)
    return Response.json({error:"Unauthorized"},{status:401});
   return handler(req,{authMode:"secret"});
  };
 };
 const gateway=makeScheduledWorkerGateway({
  enabled:true,schedulerSecret,maintenanceEnabled:true,
  maintenance:{runOnce:async()=>{work++;return {status:"complete"};}}
 });
 const handle=makeSupabaseAuthenticatedScheduler({withSupabase,gateway,enabled:true});
 const cases=[
  [{},401],
  [{apikey:"wrong","x-matchmaker-scheduler-key":schedulerSecret},401],
  [{apikey:expectedApiKey},401],
  [{apikey:expectedApiKey,"x-matchmaker-scheduler-key":"wrong"},401]
 ];
 for(const [headers,status] of cases){
  const response=await handle(request(headers));
  assert.equal(response.status,status);
 }
 assert.equal(work,0,"No SQL/Discord work may run before both auth checks");
 const ok=await handle(request({
  apikey:expectedApiKey,"x-matchmaker-scheduler-key":schedulerSecret
 }));
 assert.equal(ok.status,200);
 assert.deepEqual(await ok.json(),{task:"maintenance",status:"complete"});
 assert.equal(work,1);
});
test("even with both credentials, default-off scheduler adapter does not execute",async()=>{
 let calls=0;
 const withSupabase=(_config,handler)=>req=>handler(req,{authMode:"secret"});
 const gateway=async()=>{calls++;return Response.json({ok:true})};
 const handle=makeSupabaseAuthenticatedScheduler({withSupabase,gateway});
 const response=await handle(request({apikey:"test"}));
 assert.equal(response.status,503);
 assert.equal(calls,0);
});
