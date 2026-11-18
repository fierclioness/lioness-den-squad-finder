import test from "node:test";
import assert from "node:assert/strict";
import {makeDiscordTransport} from "./discord-transport.mjs";
const token="testonly-not-a-real-secret-123456789";
const channelId="1546529497925296199",botUserId="1546529501859815439";
test("transport disabled by default and cannot make HTTP request",async()=>{
 let calls=0;
 const t=makeDiscordTransport({fetchFn:async()=>{calls++;throw Error("Network prohibited")}});
 await assert.rejects(t.sendMessage({content:"test",allowed_mentions:{parse:[]}}),/disabled/);
 assert.equal(calls,0);
});
test("enabled transport uses fixed channel and forces zero allowed mentions",async()=>{
 const calls=[];
 const t=makeDiscordTransport({botToken:token,channelId,botUserId,enabled:true,
  fetchFn:async(url,init)=>{
   calls.push({url,init});
   return {ok:true,json:async()=>({id:"1546529501859815438",channel_id:channelId,author:{id:botUserId,bot:true}})};
  }});
 const result=await t.sendMessage({content:"🎮 Call of Duty — Casual",allowed_mentions:{parse:[]}});
 assert.deepEqual(result,{confirmed:true,messageId:"1546529501859815438",channelId,botUserId});
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,"https://discord.com/api/v10/channels/"+channelId+"/messages");
 const payload=JSON.parse(calls[0].init.body);
 assert.deepEqual(payload.allowed_mentions,{parse:[]});
 assert.equal(payload.content,"🎮 Call of Duty — Casual");
 assert.equal(calls[0].init.headers.authorization,"Bot "+token);
});
test("rejects invalid destination, mass mentions and fake receipts",async()=>{
 assert.throws(()=>makeDiscordTransport({enabled:true,botToken:token,channelId:"not-a-snowflake"}),/credentials/);
 const t=makeDiscordTransport({enabled:true,botToken:token,channelId,botUserId,
  fetchFn:async()=>({ok:true,json:async()=>({id:"1546529501859815438",channel_id:"999999999999999999"})})});
 await assert.rejects(t.sendMessage({content:"@everyone",allowed_mentions:{parse:[]}}),/mention/);
 await assert.rejects(t.sendMessage({content:"safe",allowed_mentions:{parse:["users"]}}),/Mentions/);
 await assert.rejects(t.sendMessage({content:"safe",allowed_mentions:{parse:[]}}),/receipt/);
});
test("ambiguous API failure is an error, never marked confirmed",async()=>{
 const t=makeDiscordTransport({enabled:true,botToken:token,channelId,botUserId,
  fetchFn:async()=>{throw Error("Network timeout")}});
 await assert.rejects(t.sendMessage({content:"safe",allowed_mentions:{parse:[]}}),/timeout/);
});
