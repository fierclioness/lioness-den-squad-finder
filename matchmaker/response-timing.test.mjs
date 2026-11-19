import test from "node:test";
import assert from "node:assert/strict";
import {makeResponseTimingProbe,evaluateTimingSamples} from "./response-timing.mjs";
test("timing probe records a completed response with a safe budget",async()=>{
 let now=100,report=null;
 const handler=makeResponseTimingProbe({clock:()=>now,
  handler:async()=>{now+=180;return new Response("ok",{status:200});},
  onResult:x=>{report=x;}});
 const response=await handler(new Request("https://example.invalid"));
 assert.equal(response.status,200);
 assert.equal(report.elapsedMs,180);
 assert.equal(report.withinLocalBudget,true);
});
test("slow responses are flagged; probe does not suppress actual request result",async()=>{
 let now=0,report;
 const handler=makeResponseTimingProbe({clock:()=>now,
  handler:async()=>{now+=3100;return new Response("late");},
  onResult:x=>{report=x;}});
 assert.equal((await handler(new Request("https://example.invalid"))).status,200);
 assert.equal(report.withinDiscordDeadline,false);
 assert.equal(report.withinLocalBudget,false);
});
test("summary requires tail latency below budget and no >3s outliers",()=>{
 assert.equal(evaluateTimingSamples([20,40,90,150]).withinLocalBudget,true);
 assert.equal(evaluateTimingSamples([30,40,2100]).withinLocalBudget,false);
 assert.equal(evaluateTimingSamples([20,3100]).withinLocalBudget,false);
 assert.throws(()=>evaluateTimingSamples([]),/samples/);
 assert.throws(()=>makeResponseTimingProbe({handler:async()=>new Response(),budgetMs:3000}),/below/);
});
test("timing failures are reported but not hidden",async()=>{
 let result;
 const fn=makeResponseTimingProbe({handler:async()=>{throw Error("db failure");},
  onResult:x=>{result=x;}});
 await assert.rejects(fn(new Request("https://example.invalid")),/db failure/);
 assert.equal(result.httpStatus,null);
});

test("telemetry exception never turns a valid Discord acknowledgement into an error",async()=>{
 let calls=0,now=0;
 const probe=makeResponseTimingProbe({
  handler:async()=>{now+=45;return new Response(JSON.stringify({type:1}),{status:200});},
  clock:()=>now,onResult:()=>{calls++;throw Error("metrics unavailable");}
 });
 const response=await probe(new Request("https://example.invalid"));
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{type:1});
 assert.equal(calls,1,"Reporter must not be called twice or trigger retries");
});
test("broken telemetry cannot mask the original handler failure",async()=>{
 let calls=0;
 const probe=makeResponseTimingProbe({
  handler:async()=>{throw Error("Database unavailable");},
  onResult:()=>{calls++;throw Error("Metrics unavailable");}
 });
 await assert.rejects(probe(new Request("https://example.invalid")),/Database unavailable/);
 assert.equal(calls,1);
});
test("asynchronous telemetry is not awaited before an initial interaction response",async()=>{
 let release;
 const diagnostics=new Promise(resolve=>{release=resolve;});
 let completed=false;
 const probe=makeResponseTimingProbe({
  handler:async()=>new Response("ACK",{status:200}),
  onResult:async()=>{await diagnostics;completed=true;}
 });
 const response=await probe(new Request("https://example.invalid"));
 assert.equal(await response.text(),"ACK");
 assert.equal(completed,false,"Response must not wait for diagnostics");
 release();
 await diagnostics;
 await Promise.resolve();
 assert.equal(completed,true);
});
test("rejected asynchronous observer does not fail or retry the interaction",async()=>{
 const probe=makeResponseTimingProbe({
  handler:async()=>new Response("ACK",{status:200}),
  onResult:async()=>{throw Error("Diagnostic sink rejected");}
 });
 assert.equal((await probe(new Request("https://example.invalid"))).status,200);
 await Promise.resolve();
});
