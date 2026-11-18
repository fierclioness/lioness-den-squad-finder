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
