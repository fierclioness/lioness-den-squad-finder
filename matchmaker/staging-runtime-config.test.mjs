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
