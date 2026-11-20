import test from "node:test";
import assert from "node:assert/strict";
import {auditMatchmakerConfig} from "./deployment-preflight.mjs";
const valid={commandsEnabled:false,publishEnabled:false,
 publicKeyHex:"a".repeat(64),
 databaseUrl:"postgresql://internal_server:test_only@pooler.example.internal:5432/matchmaker?sslmode=require",
 guildId:"1546529497925296199"};
test("disabled private config is syntactically sound but NOT cleared for deployment",()=>{
 const x=auditMatchmakerConfig(valid);
 assert.equal(x.ok,true);
 assert.equal(x.readyForControlledTest,false);
 assert.ok(x.warnings.some(x=>x.includes("Three-second")));
 assert.doesNotMatch(JSON.stringify(x),/test_only/);
});
test("opaque proxy or local database cannot inherit release readiness from checkboxes",()=>{
 const allEvidence={
  ...valid,gatewayDeadlineTested:true,persistenceRuntimeTested:true,
  guildTestAccountPassed:true,messageReconciliationTested:true,
  privateSchemaReviewed:true,releaseApproved:true
 };
 for(const databaseUrl of [
  "postgresql://proxy:placeholder@pooler.example.internal:5432/matchmaker?sslmode=require",
  "postgresql://proxy:placeholder@private.internal:5432/postgres?sslmode=require",
  "postgresql://proxy:placeholder@127.0.0.1:5432/postgres?sslmode=require",
  "postgresql://postgres:placeholder@unverified.example.invalid/postgres?sslmode=require"
 ]){
  const result=auditMatchmakerConfig({...allEvidence,databaseUrl});
  assert.equal(result.ok,true,"Opaque host may be syntactically valid for development");
  assert.equal(result.readyForControlledTest,false,"Checkboxes cannot certify unknown database identity");
  assert.ok(result.warnings.some(s=>s.includes("manual proxy/connection review")));
  assert.doesNotMatch(JSON.stringify(result),/placeholder|proxy:placeholder/,
   "Never leak DB credentials through preflight diagnostics");
 }
});

test("unsafe publishing and guessed channel fail closed",()=>{
 const x=auditMatchmakerConfig({...valid,publishEnabled:true,
 channelId:valid.guildId,botToken:"testing-only-bot-token-123456789"});
 assert.equal(x.ok,false);
 assert.ok(x.errors.some(x=>x.includes("independently identified")));
 assert.ok(x.errors.some(x=>x.includes("commands are disabled")));
});
test("missing keys, disabled TLS, malformed URLs and wrong guild rejected",()=>{
 const x=auditMatchmakerConfig({...valid,publicKeyHex:"bad",
 databaseUrl:"postgresql://user:pass@db.local/x?sslmode=disable",
 guildId:"999999999999999999"});
 assert.equal(x.ok,false);assert.ok(x.errors.length>=3);
 assert.equal(auditMatchmakerConfig(null).ok,false);
});
test("all gates are explicit, no assumed approval",()=>{
 const x=auditMatchmakerConfig({...valid,
 databaseUrl:"postgresql://postgres:placeholder@db.tcxktyqywsqafnyxhpgy.supabase.co/postgres?sslmode=require",
 gatewayDeadlineTested:true,
 persistenceRuntimeTested:true,guildTestAccountPassed:true,messageReconciliationTested:true,privateSchemaReviewed:true,releaseApproved:true});
 assert.equal(x.readyForControlledTest,true);
 assert.equal(x.warnings.some(t=>t.includes("active")),false);
});

test("preflight rejects downgrade, unknown and ambiguous PostgreSQL SSL modes",()=>{
 const base="postgresql://staging_role:placeholder@pooler.example.internal:5432/matchmaker";
 for(const suffix of [
  "?sslmode=disable","?sslmode=allow","?sslmode=prefer",
  "?sslmode=unknown","?sslmode=require&sslmode=disable",
  "?sslmode=require&SslMode=disable","?sslmode=require&sslmode=require"
 ]){
  const report=auditMatchmakerConfig({...valid,databaseUrl:base+suffix});
  assert.equal(report.ok,false,"must reject "+suffix);
  assert.ok(report.errors.some(message=>message.includes("TLS mode")));
 }
 for(const mode of ["require","verify-ca","verify-full"]){
  const report=auditMatchmakerConfig({...valid,databaseUrl:base+"?sslmode="+mode});
  assert.equal(report.ok,true,"secure mode should remain valid: "+mode);
 }
 const missing=auditMatchmakerConfig({...valid,databaseUrl:base});
 assert.ok(missing.warnings.some(message=>message.includes("omits sslmode")));
 assert.equal(missing.readyForControlledTest,false,"warnings are not launch approval");
});

test("preflight rejects connection-string shadowing of host, database identity and TLS",()=>{
 const base="postgresql://staging_role:placeholder@pooler.example.internal:5432/matchmaker";
 for(const fragment of [
  "host=other-project.invalid",
  "HOST=%2Fvar%2Frun%2Fpostgresql",
  "hostaddr=127.0.0.1",
  "user=other_role","password=other_password",
  "port=9876","database=production","dbname=production",
  "ssl=false","ssl=true","uselibpqcompat=true&sslmode=require"
 ]){
  const report=auditMatchmakerConfig({...valid,databaseUrl:base+"?"+fragment});
  assert.equal(report.ok,false,fragment);
  assert.equal(report.readyForControlledTest,false,fragment);
  assert.ok(report.errors.some(message=>message.includes("connection identity")||
    message.includes("TLS override")),fragment);
  assert.doesNotMatch(JSON.stringify(report),/other_password/,"No connection credentials in diagnostics");
 }
});


test("preflight cannot approve another Supabase project or disguised host even if all checkboxes are true",()=>{
 const approvedEvidence={
  ...valid,gatewayDeadlineTested:true,persistenceRuntimeTested:true,
  guildTestAccountPassed:true,messageReconciliationTested:true,
  privateSchemaReviewed:true,releaseApproved:true
 };
 const blocked=[
  "postgresql://postgres:placeholder@db.cpjcjcxinhjusosaguyi.supabase.co:5432/postgres?sslmode=require",
  "postgresql://postgres:placeholder@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?sslmode=require",
  "postgresql://postgres%2Ecpjcjcxinhjusosaguyi:placeholder@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=verify-full",
  "postgresql://postgres.abcdefghijklmnopqrst:placeholder@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require",
  "postgresql://postgres:placeholder@db.tcxktyqywsqafnyxhpgy.supabase.co.attacker.invalid/postgres?sslmode=require",
  "postgresql://postgres:placeholder@db.tcxktyqywsqafnyxhpgy.supabase.co/postgres?host=evil.invalid&sslmode=require"
 ];
 for(const databaseUrl of blocked){
  const result=auditMatchmakerConfig({...approvedEvidence,databaseUrl});
  assert.equal(result.ok,false,"Blocked database must fail preflight");
  assert.equal(result.readyForControlledTest,false,"Checklist cannot override isolation");
  assert.ok(result.errors.some(message=>message.includes("isolated Matchmaker staging")));
  assert.doesNotMatch(JSON.stringify(result),/placeholder|cpjcjcxinhjusosaguyi/,
    "Preflight errors must not reveal database credentials or production identifiers");
 }
 for(const databaseUrl of [
  "postgresql://postgres:placeholder@db.tcxktyqywsqafnyxhpgy.supabase.co:5432/postgres?sslmode=require",
  "postgresql://custom_role.tcxktyqywsqafnyxhpgy:placeholder@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=verify-full"
 ]){
  const result=auditMatchmakerConfig({...approvedEvidence,databaseUrl});
  assert.equal(result.ok,true,"Staging host should still pass: "+databaseUrl.split("@").at(-1));
  assert.equal(result.readyForControlledTest,true,"Only previously evidenced gates permit readiness");
 }
});


test("publishing preflight refuses imprecise channel and bot IDs before any rollout",()=>{
 const channelId="1546529501859815480";
 const botUserId="1546529501859815481";
 const approvedShape={...valid,commandsEnabled:true,publishEnabled:true,
   channelId,botUserId,botToken:"testing-only-bot-token-123456789"};
 const good=auditMatchmakerConfig(approvedShape);
 assert.equal(good.ok,true,"primitive exact-string identities remain acceptable");
 assert.equal(good.readyForControlledTest,false,"passing identity checks is not launch approval");
 for(const field of ["channelId","botUserId"]){
  for(const bad of [Number(approvedShape[field]),BigInt(approvedShape[field]),
    new String(approvedShape[field]),null,undefined,{"toString":()=>approvedShape[field]}]){
   const report=auditMatchmakerConfig({...approvedShape,[field]:bad});
   assert.equal(report.ok,false,field+" must reject non-string identities");
   assert.equal(report.readyForControlledTest,false);
   assert.ok(report.errors.some(message=>message.includes(
     field==="channelId"?"destination channel ID":"original bot user ID")));
  }
 }
 const missing=auditMatchmakerConfig({...approvedShape,botUserId:undefined});
 assert.equal(missing.ok,false,"publishing cannot pass preflight without verified bot identity");
 assert.equal(auditMatchmakerConfig({...approvedShape,channelId:botUserId}).ok,true,
   "valid distinct string snowflakes do not require a hardcoded destination");
});
