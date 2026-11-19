// End-to-end *offline* publisher test with disposable Postgres and mocked Discord.
// NO actual Discord API, public post, production database, or user credentials.
import assert from "node:assert/strict";
import pg from "pg";
import {makePostgresMatchmakerStore} from "../postgres-store-adapter.mjs";
import {makeDiscordTransport} from "../discord-transport.mjs";
import {makeOutboxWorker} from "../outbox-worker.mjs";
import {makeCleanupOutboxWorker} from "../cleanup-outbox-worker.mjs";
import {makeVerifiedBotCleanup} from "../verified-bot-cleanup.mjs";
if(process.env.PGHOST!=="localhost"||process.env.PGDATABASE!=="matchmaker_test")
 throw Error("Refusing non-ephemeral database");
const client=new pg.Client({host:process.env.PGHOST,port:Number(process.env.PGPORT||5432),
 database:process.env.PGDATABASE,user:process.env.PGUSER,password:process.env.PGPASSWORD});
await client.connect();
try {
 await client.query("SET ROLE service_role");
 const query=(sql,params)=>client.query(sql,params);
 const store=makePostgresMatchmakerStore({query});
 const actor={guildId:"1546529497925296199",memberId:"1418199180287148190"};
 const draft={game:"Call of Duty",platform:"Xbox",vibe:"Casual",mic:"Optional",timezone:"ET",availability:"Weekends"};
 const preview=await store.prepare(actor,draft);
 const listing=await store.confirm(actor,preview.token);
 assert.equal(listing.publicPostCreated,false);
 const queued=await query("select matchmaker_internal.enqueue_post($1::bigint) as queued",[listing.listingId]);
 assert.equal(queued.rows[0].queued,false); // Already queued in same confirmation transaction.
 const again=await query("select matchmaker_internal.enqueue_post($1::bigint) as queued",[listing.listingId]);
 assert.equal(again.rows[0].queued,false);
 const channelId="1546529497925296199",botUserId="1546529501859815439",messageId="1546529501859815438";
 let apiCalls=0;
 const transport=makeDiscordTransport({enabled:true,
  botToken:"testing-only-not-real-token-0123456",channelId,botUserId,
  fetchFn:async(url,options)=>{
    apiCalls++;
    assert.equal(url,"https://discord.com/api/v10/channels/"+channelId+"/messages");
    const payload=JSON.parse(options.body);
    assert.deepEqual(payload.allowed_mentions,{parse:[]});
    assert.match(payload.content,/Call of Duty/);
    const expected=(await query("select post_reference::text as ref from matchmaker_internal.squad_listings where id=$1::bigint",[listing.listingId])).rows[0].ref;
    assert.match(payload.content,new RegExp("🔎 Den ref: "+expected));
    return {ok:true,json:async()=>({id:messageId,channel_id:channelId,author:{id:botUserId,bot:true}})};
  }
 });
 const publisher=makeOutboxWorker({enabled:true,query,sendMessage:transport.sendMessage,channelId,botUserId,
  newWorkerId:()=>"11111111-1111-4111-8111-111111111111"});
 const done=await publisher.runOnce();
 assert.equal(done.status,"posted");
 assert.equal(done.listingId,listing.listingId);
 assert.equal(apiCalls,1);
 assert.equal((await publisher.runOnce()).status,"empty");
 assert.equal(apiCalls,1);
 const row=(await query("select state,posted_message_id,attempts from matchmaker_internal.post_outbox where listing_id=$1::bigint",[listing.listingId])).rows[0];
 assert.equal(row.state,"posted");assert.equal(row.posted_message_id,messageId);assert.equal(row.attempts,1);
 const original=(await query("select discord_message_id,channel_id,bot_user_id from matchmaker_internal.post_receipts where listing_id=$1",[listing.listingId])).rows[0];
 assert.deepEqual(original,{discord_message_id:messageId,channel_id:channelId,bot_user_id:botUserId});

 // Second listing: timeout goes UNCERTAIN; worker must not resend it.
 const p2=await store.prepare({guildId:actor.guildId,memberId:"1418199180287148191"},draft);
 const second=await store.confirm({guildId:actor.guildId,memberId:"1418199180287148191"},p2.token);
 const duplicateSecond=await query("select matchmaker_internal.enqueue_post($1::bigint) as queued",[second.listingId]);
 assert.equal(duplicateSecond.rows[0].queued,false);
 let attempts=0;
 const ambiguous=makeOutboxWorker({enabled:true,query,channelId,botUserId,
  newWorkerId:()=>"22222222-2222-4222-8222-222222222222",
  sendMessage:async()=>{attempts++;throw Error("Connection timed out after request sent");}
 });
 assert.equal((await ambiguous.runOnce()).status,"uncertain");
 assert.equal((await ambiguous.runOnce()).status,"empty");
 assert.equal(attempts,1);
 const unresolved=(await query("select state from matchmaker_internal.post_outbox where listing_id=$1",[second.listingId])).rows[0];
 assert.equal(unresolved.state,"uncertain");
 // Closed, already-posted listings must enter a DURABLE, bot-authorship-verified
 // cleanup outbox. These Discord requests are MOCKS; no real messages or users.
 assert.equal(await store.close(actor),true);
 const pendingCleanup=(await query(
  "select state,message_id,channel_id,bot_user_id from matchmaker_internal.cleanup_outbox where listing_id=$1",
  [listing.listingId])).rows[0];
 assert.deepEqual(pendingCleanup,{state:"pending",message_id:messageId,channel_id:channelId,bot_user_id:botUserId});
 const deleteMethods=[];
 const verifiedCleanup=makeVerifiedBotCleanup({
  enabled:true,botToken:"testing-only-not-real-token-0123456",channelId,botUserId,
  fetchFn:async(url,init)=>{
   assert.equal(url,"https://discord.com/api/v10/channels/"+channelId+"/messages/"+messageId);
   deleteMethods.push(init.method);
   return init.method==="GET"?
    {status:200,json:async()=>({id:messageId,channel_id:channelId,author:{id:botUserId,bot:true}})}:
    {status:204};
  }
 });
 const cleanupWorker=makeCleanupOutboxWorker({
  enabled:true,query,verifiedCleanup,channelId,botUserId,
  newWorkerId:()=>"33333333-3333-4333-8333-333333333333"
 });
 assert.deepEqual(await cleanupWorker.runOnce(),{status:"deleted",listingId:listing.listingId});
 assert.deepEqual(deleteMethods,["GET","DELETE"]);
 assert.equal((await cleanupWorker.runOnce()).status,"empty");
 assert.deepEqual(deleteMethods,["GET","DELETE"]);
 const cleanRecord=(await query(
  "select state,attempts from matchmaker_internal.cleanup_outbox where listing_id=$1",
  [listing.listingId])).rows[0];
 assert.deepEqual(cleanRecord,{state:"done",attempts:1});
 // Uncertain POST -> close cannot invent a receipt or guess a public message.
 assert.equal(await store.close({guildId:actor.guildId,memberId:"1418199180287148191"}),true);
 assert.equal((await query(
  "select count(*)::int as count from matchmaker_internal.cleanup_outbox where listing_id=$1",
  [second.listingId])).rows[0].count,0);
 console.log("Disposable Postgres + mocked Discord posting AND verified cleanup integration PASSED");
} finally {await client.end();}
