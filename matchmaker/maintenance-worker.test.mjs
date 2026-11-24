import test from "node:test";
import assert from "node:assert/strict";
import {makeMaintenanceWorker} from "./maintenance-worker.mjs";
test("maintenance is completely inert when disabled; no DB or Discord access",async()=>{
 let calls=0;
 const runner=makeMaintenanceWorker({query:async()=>{calls++;throw Error("Network prohibited");}});
 assert.deepEqual(await runner.runOnce(),{status:"disabled"});
 assert.equal(calls,0);
});
test("authorized private maintenance runs bounded expiry and quarantine only",async()=>{
 const seen=[];
 const responses=[{affected:2},{affected:1},{affected:0}];
 const runner=makeMaintenanceWorker({enabled:true,batchSize:12,staleMinutes:15,
  query:async(sql,params)=>{
   seen.push({sql,params});
   return {rows:[responses[seen.length-1]]};
  }});
 assert.deepEqual(await runner.runOnce(),
  {status:"complete",expired:2,stalePost:1,staleCleanup:0});
 assert.equal(seen.length,3);
 assert.match(seen[0].sql,/expire_due_listings/);
 assert.deepEqual(seen[0].params,[12]);
 assert.match(seen[1].sql,/quarantine_stale_post_claims/);
 assert.deepEqual(seen[1].params,["15 minutes",12]);
 assert.match(seen[2].sql,/quarantine_stale_cleanup_claims/);
 assert.deepEqual(seen[2].params,["15 minutes",12]);
 assert.ok(seen.every(x=>!x.sql.includes("discord.com")));
});
test("invalid maintenance configuration and tampered DB results fail closed",async()=>{
 for(const batchSize of [0,501,-1,1.5]){
  assert.throws(()=>makeMaintenanceWorker({query:async()=>{},batchSize}),/Unsafe/);
 }
 for(const staleMinutes of [0,4,10081,2.5]){
  assert.throws(()=>makeMaintenanceWorker({query:async()=>{},staleMinutes}),/Unsafe/);
 }
 let queries=0;
 const runner=makeMaintenanceWorker({enabled:true,batchSize:1,
  query:async()=>{queries++;return {rows:[{affected:1000}]};}});
 await assert.rejects(runner.runOnce(),/Unexpected private maintenance/);
 assert.equal(queries,1);
 const bad=makeMaintenanceWorker({enabled:true,
  query:async()=>({rows:[{affected:"1.0"}]})});
 await assert.rejects(bad.runOnce(),/Unexpected private maintenance/);
});
test("failed SQL never proceeds to later maintenance steps",async()=>{
 let count=0;
 const runner=makeMaintenanceWorker({enabled:true,
  query:async()=>{count++;throw Error("Database unavailable");}});
 await assert.rejects(runner.runOnce(),/Database unavailable/);
 assert.equal(count,1);
});

test("transient retention is separately opt-in, bounded, and never sends Discord messages",async()=>{
 const observed=[];
 const runner=makeMaintenanceWorker({
  enabled:true,transientRetentionEnabled:true,batchSize:2,staleMinutes:15,
  query:async(sql,params)=>{
   observed.push({sql,params});
   if(sql.includes("purge_expired_transient_rows"))
    return {rows:[{replays_purged:"2",previews_purged:1}]};
   return {rows:[{affected:0}]};
  }
 });
 assert.deepEqual(await runner.runOnce(),{
  status:"complete",expired:0,stalePost:0,staleCleanup:0,
  replaysPurged:2,previewsPurged:1
 });
 assert.equal(observed.length,4);
 assert.deepEqual(observed[3].params,[2]);
 assert.match(observed[3].sql,/^select replays_purged,previews_purged from matchmaker_internal.purge_expired_transient_rows\(\$1::integer\)$/);
 assert.ok(observed.every(entry=>!entry.sql.includes("discord.com")));
});
test("transient retention rejects non-boolean opt-in and invalid private database counts",async()=>{
 assert.throws(()=>makeMaintenanceWorker({
  query:async()=>({rows:[]}),transientRetentionEnabled:"true"
 }),/feature gate required/);
 let calls=0;
 const runner=makeMaintenanceWorker({
  query:async(sql)=>{
   calls++;
   return sql.includes("purge_expired_transient_rows")
    ? {rows:[{replays_purged:1,previews_purged:501}]}
    : {rows:[{affected:0}]};
  },enabled:true,transientRetentionEnabled:true,batchSize:2
 });
 await assert.rejects(runner.runOnce(),/Unexpected private maintenance operation count/);
 assert.equal(calls,4);
 const safeDefault=makeMaintenanceWorker({
  query:async(sql)=>{
   assert.doesNotMatch(sql,/purge_expired_transient_rows/);
   return {rows:[{affected:0}]};
  },enabled:true,batchSize:2
 });
 assert.deepEqual(await safeDefault.runOnce(),{
  status:"complete",expired:0,stalePost:0,staleCleanup:0
 });
});
