import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../supabase/functions/den-matchmaker-worker/index.ts",import.meta.url),"utf8");
test("auth-only staging worker scaffold is fail-closed and named-secret gated",()=>{
 assert.match(source,/withSupabase\(\{auth:"secret:den_matchmaker_scheduler"\}/);
 assert.match(source,/export default\s*\{\s*fetch\s*:\s*withSupabase\(/);
 assert.doesNotMatch(source,/Deno\.serve\s*\(/);
 assert.match(source,/status:503/);
 assert.match(source,/status:"disabled"/);
 assert.match(source,/cache-control":"no-store"/);
});
test("staging maintenance worker requires opt-in and dedicated staging identity, with no Discord transport",()=>{
 assert.match(source,/DEN_MATCHMAKER_MAINTENANCE_ENABLED"\)!=="true"\)return disabled\(\)/);
 assert.match(source,/DEN_MATCHMAKER_MAINTENANCE_DATABASE_URL/);
 assert.match(source,/den_matchmaker_maintenance/);
 assert.match(source,/resolvePrivateDatabaseUrl/);
 assert.ok(source.indexOf('DEN_MATCHMAKER_MAINTENANCE_ENABLED')<source.indexOf("new pg.Pool"));
 assert.ok(source.indexOf('den_matchmaker_maintenance')<source.indexOf("new pg.Pool"));
 for(const unsafe of [/fetch\s*\(/,/execute_sql/,/supabaseAdmin/,/sendMessage/,/DELETE/,/makeScheduledWorkerComposition/,/makeDiscordTransport/,/makeOutboxWorker/,/makeCleanupOutboxWorker/]){
  assert.doesNotMatch(source,unsafe);
 }
});

test("Discord interaction webhook stays isolated from the scheduler and bot-owned workers",()=>{
 const webhook=readFileSync(new URL("../supabase/functions/den-matchmaker/index.ts",import.meta.url),"utf8");
 for(const unsafe of [
  /den-matchmaker-worker/,/den_matchmaker_scheduler/,/makeSupabaseAuthenticatedScheduler/,
  /makeScheduledWorkerComposition/,/makeScheduledWorkerGateway/,/npm:@supabase\/server/
 ])assert.doesNotMatch(webhook,unsafe,"Signed Discord ingress must never load privileged scheduler or bot worker code");
 assert.match(webhook,/makeMatchmakerServer/);
 assert.match(webhook,/DEN_MATCHMAKER_COMMANDS_ENABLED/);
});
test("JWT bypass is scoped only to the named-secret worker, never the Discord webhook",()=>{
 const config=readFileSync(new URL("../supabase/config.toml",import.meta.url),"utf8");
 assert.match(config,/\[functions\.den-matchmaker-worker\]\s*verify_jwt\s*=\s*false/);
 assert.doesNotMatch(config,/\[functions\.den-matchmaker\]/);
 assert.equal((config.match(/verify_jwt\s*=\s*false/g)||[]).length,1);
});

test("worker must not broaden authentication or silently gain privileged capabilities",()=>{
 assert.doesNotMatch(source,/auth\s*:\s*["'](?:none|secret|publishable|user)["']/);
 assert.doesNotMatch(source,/auth\s*:\s*\[/);
 assert.doesNotMatch(source,/supabaseAdmin|service_role|SUPABASE_SECRET_KEYS|SUPABASE_DB_URL/);
 assert.doesNotMatch(source,/x-matchmaker-scheduler-key|makeMaintenanceWorker|makeOutboxWorker|makeCleanupOutboxWorker/);
 assert.equal((source.match(/secret:den_matchmaker_scheduler/g)||[]).length,1);
});
