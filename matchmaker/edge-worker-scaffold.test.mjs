import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../supabase/functions/den-matchmaker-worker/index.ts",import.meta.url),"utf8");
test("auth-only staging worker scaffold is fail-closed and named-secret gated",()=>{
 assert.match(source,/withSupabase\(\{auth:"secret:den-matchmaker-scheduler"\}/);
 assert.match(source,/status:503/);
 assert.match(source,/status:"disabled"/);
 assert.match(source,/cache-control":"no-store"/);
});
test("inert worker scaffold cannot touch private database or Discord",()=>{
 for(const unsafe of [/fetch\s*\(/,/execute_sql/,/supabaseAdmin/,/query\s*\(/,/sendMessage/,/DELETE/,/POST/,/makeScheduledWorkerComposition/,/Deno\.env\.get/]){
  assert.doesNotMatch(source,unsafe);
 }
});
