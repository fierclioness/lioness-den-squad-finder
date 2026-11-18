// End-to-end *offline* publisher test with disposable Postgres and mocked Discord.
// NO actual Discord API, public post, production database, or user credentials.
import assert from "node:assert/strict";
import pg from "pg";
import {makePostgresMatchmakerStore} from "../postgres-store-adapter.mjs";
import {makeDiscordTransport} from "../discord-transport.mjs";
import {makeOutboxWorker} from "../outbox-worker.mjs";
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
 assert.equal(queued.rows[0].queued,true);
 const again=await query("select matchmaker_internal.enqueue_post($1::bigint) as queued",[listing.listingId]);
 assert.equal(again.rows[0].queued,false);
 const channelId="1546529497925296199",messageId="1546529501859815438";
 let apiCalls=0;
 const transport=makeDiscordTransport({enabled:true,
  botToken:"testing-only-not-real-token-0123456",channelId,
  fetchFn:async(url,options)=>{
    apiCalls++;
    assert.equal(url,"https://discord.com/api/v10/channels/"+channelId+"/messages");
    const payload=JSON.parse(options.body);
    assert.deepEqual(payload.allowed_mentions,{parse:[]});
    assert.match(payload.content,/Call of Duty/);
    const expected=(await query("select post_reference::text as ref from matchmaker_internal.squad_listings where id=$1::bigint",[listing.listingId])).rows[0].ref;
    assert.match(payload.content,new RegExp("🔎 Den ref: "+expected));
    return {ok:true,json:async()=>({id:messageId,channel_id:channelId})};
  }
 });
 const publisher=makeOutboxWorker({enabled:true,query,sendMessage:transport.sendMessage,
  newWorkerId:()=>"11111111-1111-4111-8111-111111111111"});
 const done=await publisher.runOnce();
 assert.equal(done.status,"posted");
 assert.equal(done.listingId,listing.listingId);
 assert.equal(apiCalls,1);
 assert.equal((await publisher.runOnce()).status,"empty");
 assert.equal(apiCalls,1);
 const row=(await query("select state,posted_message_id,attempts from matchmaker_internal.post_outbox where listing_id=$1::bigint",[listing.listingId])).rows[0];
 assert.equal(row.state,"posted");assert.equal(row.posted_message_id,messageId);assert.equal(row.attempts,1);

 // Second listing: timeout goes UNCERTAIN; worker must not resend it.
 const p2=await store.prepare({guildId:actor.guildId,memberId:"1418199180287148191"},draft);
 const second=await store.confirm({guildId:actor.guildId,memberId:"1418199180287148191"},p2.token);
 await query("select matchmaker_internal.enqueue_post($1::bigint)",[second.listingId]);
 let attempts=0;
 const ambiguous=makeOutboxWorker({enabled:true,query,
  newWorkerId:()=>"22222222-2222-4222-8222-222222222222",
  sendMessage:async()=>{attempts++;throw Error("Connection timed out after request sent");}
 });
 assert.equal((await ambiguous.runOnce()).status,"uncertain");
 assert.equal((await ambiguous.runOnce()).status,"empty");
 assert.equal(attempts,1);
 const unresolved=(await query("select state from matchmaker_internal.post_outbox where listing_id=$1",[second.listingId])).rows[0];
 assert.equal(unresolved.state,"uncertain");
 console.log("Disposable Postgres + mocked Discord transport outbox integration PASSED");
} finally {await client.end();}
