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
 const x=auditMatchmakerConfig({...valid,gatewayDeadlineTested:true,
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
