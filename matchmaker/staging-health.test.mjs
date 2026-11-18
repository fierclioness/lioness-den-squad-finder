import test from "node:test";
import assert from "node:assert/strict";
import {stagingHealthResponse} from "./staging-health.mjs";
test("health endpoint returns only static staging state",async()=>{
 const r=stagingHealthResponse(new Request("https://example.invalid/functions/v1/den-matchmaker/health"));
 assert.equal(r.status,200);
 for(const path of ["/health","/den-matchmaker/health"]){
  assert.equal(stagingHealthResponse(new Request("https://example.invalid"+path))?.status,200);
 }
 assert.equal(r.headers.get("cache-control"),"no-store");
 assert.deepEqual(await r.json(),{service:"den-matchmaker",environment:"staging",status:"commands_disabled",posting_enabled:false,member_data_access:false});
});
test("no commands, arbitrary methods or paths are intercepted",()=>{
 assert.equal(stagingHealthResponse(new Request("https://example.invalid/functions/v1/den-matchmaker/health",{method:"POST"})),null);
 assert.equal(stagingHealthResponse(new Request("https://example.invalid/functions/v1/den-matchmaker")),null);
 assert.equal(stagingHealthResponse(new Request("https://example.invalid/functions/v1/den-matchmaker/delete")),null);
});
