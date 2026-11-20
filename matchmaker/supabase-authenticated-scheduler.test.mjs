import test from "node:test";
import assert from "node:assert/strict";
import {makeSupabaseAuthenticatedScheduler,SCHEDULER_AUTH_MODE} from "./supabase-authenticated-scheduler.mjs";
const request=()=>new Request("https://example.invalid/functions/v1/den-matchmaker-worker/maintenance",{method:"POST"});
test("named Supabase secret is mandatory and worker remains OFF by default",async()=>{
 let mode,work=0;
 const withSupabase=(options,callback)=>{mode=options.auth;return callback;};
 const handler=makeSupabaseAuthenticatedScheduler({withSupabase,gateway:async()=>{work++;return Response.json({ok:true})}});
 assert.equal(mode,"secret:den-matchmaker-scheduler");
 assert.equal(SCHEDULER_AUTH_MODE,mode);
 const response=await handler(request(),{authMode:"secret"});
 assert.equal(response.status,503);assert.equal(work,0);
});
test("missing, user, and publishable contexts cannot reach gateway",async()=>{
 let calls=0;
 const handler=makeSupabaseAuthenticatedScheduler({
  withSupabase:(_options,callback)=>callback,enabled:true,
  gateway:async()=>{calls++;return Response.json({ok:true})}
 });
 for(const context of [null,undefined,{}, {authMode:"user"},{authMode:"publishable"},{authMode:"none"}]){
  const result=await handler(request(),context);
  assert.equal(result.status,401);
 }
 assert.equal(calls,0);
 const accepted=await handler(request(),{authMode:"secret"});
 assert.equal(accepted.status,200);assert.equal(calls,1);
});
test("missing trusted wrapper or gateway fails during construction",()=>{
 assert.throws(()=>makeSupabaseAuthenticatedScheduler({gateway:()=>{}}),/wrapper required/);
 assert.throws(()=>makeSupabaseAuthenticatedScheduler({withSupabase:()=>{}}),/gateway required/);
});
