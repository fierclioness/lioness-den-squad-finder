import test from "node:test";
import assert from "node:assert/strict";
import {resolvePrivateDatabaseUrl} from "./staging-runtime-config.mjs";
const read=values=>key=>values[key];
test("staging uses Supabase's automatic server-only DB URL",()=>{
 const url="postgresql://postgres:placeholder@db.tcxktyqywsqafnyxhpgy.supabase.co/postgres";
 assert.equal(resolvePrivateDatabaseUrl(read({
  SUPABASE_URL:"https://tcxktyqywsqafnyxhpgy.supabase.co",
  SUPABASE_DB_URL:url
 })),url);
});

test("unattributed automatic Supabase database URLs fail closed, while scoped staging remains usable",()=>{
 const origin="https://tcxktyqywsqafnyxhpgy.supabase.co";
 for(const url of [
  "postgresql://postgres:placeholder@staging.internal/postgres",
  "postgresql://postgres:placeholder@production.internal/postgres",
  "postgresql://proxy:placeholder@private.internal/postgres?sslmode=require",
  "postgresql://proxy:placeholder@localhost:5432/postgres",
  "postgresql://postgres:placeholder@db.abcdefghijklmnopqrst.supabase.co/postgres"
 ]){
  assert.equal(resolvePrivateDatabaseUrl(read({SUPABASE_URL:origin,SUPABASE_DB_URL:url})),"",
   "Implicit fallback must not trust an opaque host or another project");
 }
 const scoped="postgresql://postgres.tcxktyqywsqafnyxhpgy:placeholder@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require";
 assert.equal(resolvePrivateDatabaseUrl(read({SUPABASE_URL:origin,SUPABASE_DB_URL:scoped})),scoped);
});

test("the production Den Missions project must not inherit default privileged DB URL",()=>{
 const url="postgresql://not-a-real-user:placeholder@production.internal/postgres";
 assert.equal(resolvePrivateDatabaseUrl(read({
  SUPABASE_URL:"https://cpjcjcxinhjusosaguyi.supabase.co",
  SUPABASE_DB_URL:url
 })),"");
});
test("a private, explicitly provisioned connection overrides staging fallback",()=>{
 const url="postgresql://dedicated-role:placeholder@private.internal/postgres";
 assert.equal(resolvePrivateDatabaseUrl(read({
  SUPABASE_URL:"https://tcxktyqywsqafnyxhpgy.supabase.co",
  DEN_MATCHMAKER_DATABASE_URL:url,
  SUPABASE_DB_URL:"postgresql://postgres:wrong@db/postgres"
 })),url);
});
test("missing, malformed, or unexpected environments fail closed",()=>{
 assert.equal(resolvePrivateDatabaseUrl(read({SUPABASE_URL:"https://unknown.supabase.co",SUPABASE_DB_URL:"postgresql://secret:x@db/db"})),"");
 assert.equal(resolvePrivateDatabaseUrl(read({SUPABASE_URL:"https://tcxktyqywsqafnyxhpgy.supabase.co",SUPABASE_DB_URL:"https://wrong"})),"");
 assert.throws(()=>resolvePrivateDatabaseUrl(null),/reader/);
});


test("draft Edge must never connect when running on Den Missions production or an unknown project",()=>{
 const stagingUrl="postgresql://staging:placeholder@private.internal/postgres?sslmode=require";
 for(const project of [
  "https://cpjcjcxinhjusosaguyi.supabase.co",
  "https://other-project.supabase.co",
  "",
  "https://tcxktyqywsqafnyxhpgy.supabase.co.evil.example"
 ]){
  assert.equal(resolvePrivateDatabaseUrl(read({
   SUPABASE_URL:project,DEN_MATCHMAKER_DATABASE_URL:stagingUrl,
   SUPABASE_DB_URL:stagingUrl
  })),"","No draft database connection outside isolated Matchmaker staging");
 }
});
test("miswired Den Missions direct and pooler connections are refused even on staging",()=>{
 const productionUrls=[
  "postgresql://postgres:placeholder@db.cpjcjcxinhjusosaguyi.supabase.co:5432/postgres",
  "postgresql://postgres.cpjcjcxinhjusosaguyi:placeholder@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
  "postgresql://postgres%2Ecpjcjcxinhjusosaguyi:placeholder@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
 ];
 for(const databaseUrl of productionUrls){
  const env={SUPABASE_URL:"https://tcxktyqywsqafnyxhpgy.supabase.co",
   DEN_MATCHMAKER_DATABASE_URL:databaseUrl};
  assert.equal(resolvePrivateDatabaseUrl(read(env)),"","Explicit production connection must be denied");
  delete env.DEN_MATCHMAKER_DATABASE_URL;
  env.SUPABASE_DB_URL=databaseUrl;
  assert.equal(resolvePrivateDatabaseUrl(read(env)),"","Built-in production connection must be denied");
 }
});
test("staging project pooler and dedicated private database configuration remain permitted",()=>{
 const pooler="postgresql://postgres.tcxktyqywsqafnyxhpgy:placeholder@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require";
 assert.equal(resolvePrivateDatabaseUrl(read({
  SUPABASE_URL:"https://tcxktyqywsqafnyxhpgy.supabase.co",
  DEN_MATCHMAKER_DATABASE_URL:pooler
 })),pooler);
});

test("cross-project Supabase direct database addresses are rejected even when not Den Missions",()=>{
 const other="postgresql://postgres:placeholder@db.abcdefghijklmnopqrst.supabase.co:5432/postgres";
 for(const configKey of ["DEN_MATCHMAKER_DATABASE_URL","SUPABASE_DB_URL"]){
  assert.equal(resolvePrivateDatabaseUrl(read({
   SUPABASE_URL:"https://tcxktyqywsqafnyxhpgy.supabase.co",
   [configKey]:other
  })),"",configKey+" must not route to another recognizable Supabase project");
 }
});
test("cross-project pooler and encoded pooler username cannot bypass staging isolation",()=>{
 const urls=[
  "postgresql://postgres.abcdefghijklmnopqrst:placeholder@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
  "postgresql://postgres%2Eabcdefghijklmnopqrst:placeholder@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
  "postgresql://postgres.tcxktyqywsqafnyxhpgy:placeholder@db.abcdefghijklmnopqrst.supabase.co:5432/postgres"
 ];
 for(const databaseUrl of urls)
  assert.equal(resolvePrivateDatabaseUrl(read({
   SUPABASE_URL:"https://tcxktyqywsqafnyxhpgy.supabase.co",
   DEN_MATCHMAKER_DATABASE_URL:databaseUrl
  })),"","Any recognized mismatched project ref must fail closed");
});
test("recognized staging direct-host database remains allowed",()=>{
 const db="postgresql://postgres:placeholder@db.tcxktyqywsqafnyxhpgy.supabase.co:5432/postgres?sslmode=require";
 assert.equal(resolvePrivateDatabaseUrl(read({
  SUPABASE_URL:"https://tcxktyqywsqafnyxhpgy.supabase.co",
  SUPABASE_DB_URL:db
 })),db);
});

test("invalid explicit private override must not silently use privileged staging fallback",()=>{
 const fallback="postgresql://postgres:placeholder@db.tcxktyqywsqafnyxhpgy.supabase.co/postgres";
 for(const bad of ["", "https://example.test", "not-a-url", 23, true]){
  assert.equal(resolvePrivateDatabaseUrl(read({
   SUPABASE_URL:"https://tcxktyqywsqafnyxhpgy.supabase.co",
   DEN_MATCHMAKER_DATABASE_URL:bad,
   SUPABASE_DB_URL:fallback
  })),"","Invalid explicit override must deny, never fall back");
 }
});
test("cross-project explicit override must not silently use otherwise valid built-in URL",()=>{
 const fallback="postgresql://postgres:placeholder@db.tcxktyqywsqafnyxhpgy.supabase.co/postgres";
 for(const bad of [
  "postgresql://postgres.abcdefghijklmnopqrst:placeholder@aws-0-us-east-1.pooler.supabase.com/postgres",
  "postgresql://postgres:placeholder@db.abcdefghijklmnopqrst.supabase.co/postgres"
 ]){
  assert.equal(resolvePrivateDatabaseUrl(read({
   SUPABASE_URL:"https://tcxktyqywsqafnyxhpgy.supabase.co",
   DEN_MATCHMAKER_DATABASE_URL:bad,
   SUPABASE_DB_URL:fallback
  })),"","Cross-project explicit override must deny, never fall back");
 }
});

test("Supabase-looking DNS suffixes must never receive staging database credentials",()=>{
 const impostors=[
  "postgresql://postgres:placeholder@db.tcxktyqywsqafnyxhpgy.supabase.co.evil.invalid/postgres",
  "postgresql://postgres:placeholder@db.abcdefghijklmnopqrst.supabase.co.evil.invalid/postgres",
  "postgresql://postgres.tcxktyqywsqafnyxhpgy:placeholder@aws-0-us-east-1.pooler.supabase.com.evil.invalid/postgres",
  "postgresql://postgres.tcxktyqywsqafnyxhpgy:placeholder@not-the-pooler.supabase.com/postgres"
 ];
 for(const url of impostors){
  for(const key of ["DEN_MATCHMAKER_DATABASE_URL","SUPABASE_DB_URL"]){
   assert.equal(resolvePrivateDatabaseUrl(read({
    SUPABASE_URL:"https://tcxktyqywsqafnyxhpgy.supabase.co",
    [key]:url
   })),"",key+" must reject disguised Supabase host "+url.split("@").at(-1));
  }
 }
});
test("Supabase shared pooler requires a project-scoped role for staging",()=>{
 const hostname="aws-0-us-east-1.pooler.supabase.com:6543";
 for(const username of ["postgres","custom_role","postgres.short","postgres.abcdefghijklmnopqrst"]){
  assert.equal(resolvePrivateDatabaseUrl(read({
   SUPABASE_URL:"https://tcxktyqywsqafnyxhpgy.supabase.co",
   DEN_MATCHMAKER_DATABASE_URL:"postgresql://"+username+":placeholder@"+hostname+"/postgres"
  })),"","Shared pooler must identify the correct project");
 }
 const custom="postgresql://custom_role.tcxktyqywsqafnyxhpgy:placeholder@"+hostname+"/postgres";
 assert.equal(resolvePrivateDatabaseUrl(read({
  SUPABASE_URL:"https://tcxktyqywsqafnyxhpgy.supabase.co",
  DEN_MATCHMAKER_DATABASE_URL:custom
 })),custom);
});

test("query parameters cannot silently reroute a staging DB connection or downgrade TLS",()=>{
 const direct="postgresql://postgres:placeholder@db.tcxktyqywsqafnyxhpgy.supabase.co:5432/postgres";
 const disguised=[
  "host=db.cpjcjcxinhjusosaguyi.supabase.co",
  "HOST=evil.example.invalid",
  "host=%2Ftmp%2Fpostgres.sock",
  "hostaddr=127.0.0.1",
  "user=postgres.cpjcjcxinhjusosaguyi",
  "username=other_role",
  "password=override",
  "port=7654",
  "database=otherdb",
  "dbname=otherdb",
  "db=otherdb",
  "sslmode=disable",
  "sslmode=prefer",
  "sslmode=no-verify",
  "sslmode=require&sslmode=disable",
  "ssl=false",
  "uselibpqcompat=true&sslmode=require"
 ];
 const fallback=direct+"?sslmode=require";
 for(const params of disguised){
  for(const key of ["DEN_MATCHMAKER_DATABASE_URL","SUPABASE_DB_URL"]){
   assert.equal(resolvePrivateDatabaseUrl(read({
    SUPABASE_URL:"https://tcxktyqywsqafnyxhpgy.supabase.co",
    [key]:direct+"?"+params,
    ...(key==="DEN_MATCHMAKER_DATABASE_URL"?{SUPABASE_DB_URL:fallback}:{})
   })),"","Unsafe connection query override must be rejected: "+key+" "+params);
  }
 }
 for(const mode of ["require","verify-ca","verify-full"]){
  assert.equal(resolvePrivateDatabaseUrl(read({
   SUPABASE_URL:"https://tcxktyqywsqafnyxhpgy.supabase.co",
   DEN_MATCHMAKER_DATABASE_URL:direct+"?sslmode="+mode
  })),direct+"?sslmode="+mode);
 }
});
