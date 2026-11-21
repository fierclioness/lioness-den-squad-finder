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
   return {ok:true,status:200,json:async()=>({id:"1546529501859815438",channel_id:channelId,author:{id:botUserId,bot:true}})};
  }});
 const result=await t.sendMessage({content:"🎮 Call of Duty — Casual",allowed_mentions:{parse:[]}});
 assert.deepEqual(result,{confirmed:true,messageId:"1546529501859815438",channelId,botUserId});
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,"https://discord.com/api/v10/channels/"+channelId+"/messages");
 const payload=JSON.parse(calls[0].init.body);
 assert.deepEqual(payload.allowed_mentions,{parse:[]});
 assert.equal(payload.content,"🎮 Call of Duty — Casual");
 assert.equal(calls[0].init.headers.authorization,"Bot "+token);
 assert.equal(calls[0].init.redirect,"error","Never follow an authenticated Discord request");
});
test("rejects invalid destination, mass mentions and fake receipts",async()=>{
 assert.throws(()=>makeDiscordTransport({enabled:true,botToken:token,channelId:"not-a-snowflake"}),/credentials/);
 const t=makeDiscordTransport({enabled:true,botToken:token,channelId,botUserId,
  fetchFn:async()=>({ok:true,status:200,json:async()=>({id:"1546529501859815438",channel_id:"999999999999999999"})})});
 await assert.rejects(t.sendMessage({content:"@everyone",allowed_mentions:{parse:[]}}),/mention/);
 await assert.rejects(t.sendMessage({content:"safe",allowed_mentions:{parse:["users"]}}),/Mentions/);
 await assert.rejects(t.sendMessage({content:"safe",allowed_mentions:{parse:[]}}),/receipt/);
});
test("ambiguous API failure is an error, never marked confirmed",async()=>{
 const t=makeDiscordTransport({enabled:true,botToken:token,channelId,botUserId,
  fetchFn:async()=>{throw Error("Network timeout")}});
 await assert.rejects(t.sendMessage({content:"safe",allowed_mentions:{parse:[]}}),/timeout/);
});

test("posting transport exposes bounded abort signal and treats timeout as unconfirmed",async()=>{
 // Native fetch keeps the event loop alive; our mock intentionally does not.
 const hold=setTimeout(()=>{},400);
 try {
 const t=makeDiscordTransport({enabled:true,botToken:token,channelId,botUserId,requestTimeoutMs:20,
  fetchFn:async(_url,options)=>{
    assert.equal(options.signal instanceof AbortSignal,true);
    return new Promise((_resolve,reject)=>{
      if(options.signal.aborted)return reject(options.signal.reason);
      options.signal.addEventListener("abort",()=>reject(options.signal.reason),{once:true});
    });
  }});
 await assert.rejects(t.sendMessage({content:"safe",allowed_mentions:{parse:[]}}),e=>e?.name==="TimeoutError");
 assert.throws(()=>makeDiscordTransport({enabled:true,botToken:token,channelId,botUserId,requestTimeoutMs:0}),/timeout/);
 assert.throws(()=>makeDiscordTransport({enabled:true,botToken:token,channelId,botUserId,requestTimeoutMs:16000}),/timeout/);
 } finally {clearTimeout(hold);}
});

test("redirected Discord REST reply cannot confirm a public post",async()=>{
 let calls=0;
 const t=makeDiscordTransport({botToken:token,channelId,botUserId,enabled:true,
  fetchFn:async(_url,init)=>{
   calls++;
   assert.equal(init.redirect,"error");
   return {ok:true,status:200,redirected:true,json:async()=>({
    id:"1546529501859815438",channel_id:channelId,author:{id:botUserId,bot:true}
   })};
  }});
 await assert.rejects(t.sendMessage({content:"safe",allowed_mentions:{parse:[]}}),/Redirected delivery is untrusted/);
 assert.equal(calls,1,"No retries after a redirected or ambiguous delivery");
});

test("numeric Discord snowflakes and non-string receipts fail closed before trusted publication",async()=>{
 // 19-digit Discord IDs cannot be represented precisely as JS numbers.
 assert.notEqual(String(Number(channelId)),channelId);
 assert.throws(()=>makeDiscordTransport({
  enabled:true,botToken:token,channelId:Number(channelId),botUserId
 }),/credentials/);
 assert.throws(()=>makeDiscordTransport({
  enabled:true,botToken:token,channelId,botUserId:Number(botUserId)
 }),/credentials/);
 for(const fakeReceipt of [
  {id:Number("1546529501859815438"),channel_id:channelId,author:{id:botUserId,bot:true}},
  {id:"1546529501859815438",channel_id:Number(channelId),author:{id:botUserId,bot:true}},
  {id:"1546529501859815438",channel_id:channelId,author:{id:Number(botUserId),bot:true}}
 ]){
  let attempts=0;
  const transport=makeDiscordTransport({
   enabled:true,botToken:token,channelId,botUserId,
   fetchFn:async()=>{attempts++;return {ok:true,status:200,json:async()=>fakeReceipt};}
  });
  await assert.rejects(transport.sendMessage({content:"safe",allowed_mentions:{parse:[]}}),/Untrusted delivery receipt/);
  assert.equal(attempts,1,"Do not retry when the receipt identity is ambiguous");
 }
});

test("only HTTP 200 with a verified receipt confirms publication; other 2xx responses are uncertain",async()=>{
 const message={id:"1546529501859815438",channel_id:channelId,author:{id:botUserId,bot:true}};
 for(const status of [201,202,204,206]){
  let attempts=0;
  const transport=makeDiscordTransport({botToken:token,channelId,botUserId,enabled:true,
   fetchFn:async()=>{attempts++;return {ok:true,status,json:async()=>message};}
  });
  await assert.rejects(
   transport.sendMessage({content:"Test-only squad message",allowed_mentions:{parse:[]}}),
   /Delivery not confirmed/);
  assert.equal(attempts,1,"Ambiguous success codes must not trigger retries");
 }
});
