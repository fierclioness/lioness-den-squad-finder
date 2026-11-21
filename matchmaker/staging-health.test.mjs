import test from "node:test";
import assert from "node:assert/strict";
import {stagingHealthResponse} from "./staging-health.mjs";

test("disabled staging health endpoint returns static, non-sensitive state",async()=>{
 const r=stagingHealthResponse(new Request("https://example.invalid/functions/v1/den-matchmaker/health"));
 assert.equal(r.status,200);
 for(const path of ["/health","/den-matchmaker/health"]){
  assert.equal(stagingHealthResponse(new Request("https://example.invalid"+path))?.status,200);
 }
 assert.equal(r.headers.get("cache-control"),"no-store");
 assert.deepEqual(await r.json(),{
   service:"den-matchmaker",environment:"staging",status:"commands_disabled",
   posting_enabled:false,member_data_access:false
 });
});
test("health remains routable when restricted commands are enabled",async()=>{
 const request=new Request("https://example.invalid/functions/v1/den-matchmaker/health");
 const enabled=stagingHealthResponse(request,{commandsEnabled:true,configured:true});
 assert.equal(enabled.status,200);
 assert.deepEqual(await enabled.json(),{
   service:"den-matchmaker",environment:"staging",status:"commands_enabled",
   posting_enabled:false,member_data_access:false
 });
 const incomplete=stagingHealthResponse(request,{commandsEnabled:true,configured:false});
 assert.equal(incomplete.status,200);
 assert.equal((await incomplete.json()).status,"configuration_incomplete");
 // Health is intentionally a static routing diagnostic, not proof of DB readiness.
});
test("request parameters cannot enable commands or leak tester identifiers",async()=>{
 const request=new Request("https://example.invalid/health?commandsEnabled=true&tester=1418199180287148073");
 const response=stagingHealthResponse(request);
 const raw=await response.text();
 assert.match(raw,/commands_disabled/);
 assert.doesNotMatch(raw,/1418199180287148073|tester|database|secret|token/i);
 assert.throws(()=>stagingHealthResponse(request,{commandsEnabled:"true"}),/booleans/);
 assert.throws(()=>stagingHealthResponse(request,{configured:"true"}),/booleans/);
});
test("no commands, arbitrary methods or paths are intercepted",()=>{
 assert.equal(stagingHealthResponse(new Request("https://example.invalid/functions/v1/den-matchmaker/health",{method:"POST"}),{commandsEnabled:true}),null);
 assert.equal(stagingHealthResponse(new Request("https://example.invalid/functions/v1/den-matchmaker"),{commandsEnabled:true}),null);
 assert.equal(stagingHealthResponse(new Request("https://example.invalid/functions/v1/den-matchmaker/delete")),null);
});
