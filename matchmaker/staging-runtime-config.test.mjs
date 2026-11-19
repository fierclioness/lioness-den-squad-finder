import test from "node:test";
import assert from "node:assert/strict";
import {resolvePrivateDatabaseUrl} from "./staging-runtime-config.mjs";
const read=values=>key=>values[key];
test("staging uses Supabase's automatic server-only DB URL",()=>{
 const url="postgresql://not-a-real-user:placeholder@staging.internal/postgres";
 assert.equal(resolvePrivateDatabaseUrl(read({
  SUPABASE_URL:"https://tcxktyqywsqafnyxhpgy.supabase.co",
  SUPABASE_DB_URL:url
 })),url);
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
