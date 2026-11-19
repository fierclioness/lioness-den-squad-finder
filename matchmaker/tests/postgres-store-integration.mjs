// Runs ONLY against disposable CI PostgreSQL 17 (not the user's Supabase).
// Execute after postgres-smoke.sql and outbox-postgres.sql.
import assert from "node:assert/strict";
import pg from "pg";
import {makePostgresMatchmakerStore} from "../postgres-store-adapter.mjs";
const {Client}=pg;

if (process.env.PGDATABASE!=="matchmaker_test" || process.env.PGHOST!=="localhost") {
  throw new Error("Refusing to run against non-disposable PostgreSQL database");
}
const client=new Client({
  host:process.env.PGHOST,
  port:Number(process.env.PGPORT||5432),
  database:process.env.PGDATABASE,
  user:process.env.PGUSER,
  password:process.env.PGPASSWORD
});
await client.connect();
try {
  // Fixture role models the private service-only SQL boundary.
  await client.query("SET ROLE service_role");
  const store=makePostgresMatchmakerStore({query:(sql,params)=>client.query(sql,params)});
  const actor={guildId:"1546529497925296199",memberId:"1418199180287148074"};
  const other={guildId:actor.guildId,memberId:"1418199180287148075"};
  const draft={game:"Call of Duty",platform:"Xbox",vibe:"Casual",mic:"Optional",timezone:"ET",availability:"Sunday afternoon"};
  const preview=await store.prepare(actor,draft);
  assert.match(preview.token,/^[0-9a-f-]{36}$/i);
  await assert.rejects(store.confirm(other,preview.token),/Preview unavailable/);
  assert.equal(await store.mine(actor),null);
  const confirmed=await store.confirm(actor,preview.token);
  assert.equal(confirmed.publicPostCreated,false);
  assert.equal(confirmed.queuedForPublishing,false);
  const postQueue=(await client.query("select count(*)::int as n from matchmaker_internal.post_outbox where listing_id=$1",[confirmed.listingId])).rows[0];
  assert.equal(postQueue.n,0,"A privately saved request must never enter the public queue");
  assert.match(confirmed.listingId,/^\d+$/);
  const mine=await store.mine(actor);
  assert.equal(mine.game,"Call of Duty");
  assert.equal(mine.vibe,"Casual");
  const list=await store.list(actor);
  assert.ok(list.some(item=>item.game==="Call of Duty"&&item.platform==="Xbox"));
  assert.ok(list.every(item=>!Object.hasOwn(item,"owner_discord_id")));
  await assert.rejects(store.confirm(actor,preview.token),/Preview unavailable/);
  assert.equal(await store.close(actor),true);
  assert.equal(await store.mine(actor),null);
  const cancel=await store.prepare(other,draft);
  assert.equal(await store.cancel(other,cancel.token),true);
  await assert.rejects(store.confirm(other,cancel.token),/Preview unavailable/);
  assert.equal(await store.claimReplay("1572091972217212970"),true);
  assert.equal(await store.claimReplay("1572091972217212970"),false);

  // The ordinary authenticated role must not access the private schema.
  await client.query("RESET ROLE");
  await client.query("SET ROLE authenticated");
  await assert.rejects(client.query(
    "select * from matchmaker_internal.squad_listings limit 1"
  ),/permission denied/);
  await client.query("RESET ROLE");
  console.log("Disposable PostgreSQL storage adapter integration PASSED");
} finally {
  await client.end();
}
