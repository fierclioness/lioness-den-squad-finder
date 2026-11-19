import test from "node:test";
import assert from "node:assert/strict";
import {makeRegistrationRequest,registerTestGuildCommand} from "./register-test-guild-command.mjs";
const token="t".repeat(40),app="1572772707542507580",guild="1546529497925296199";
test("registration is limited to exact test app and guild",()=>{
 const r=makeRegistrationRequest({token});
 assert.equal(r.options.method,"POST");
 assert.equal(r.url,"https://discord.com/api/v10/applications/"+app+"/guilds/"+guild+"/commands");
 assert.equal(JSON.parse(r.options.body).name,"squad");
 assert.throws(()=>makeRegistrationRequest({token,applicationId:"999999999999999999"}),/unexpected/);
 assert.throws(()=>makeRegistrationRequest({token,guildId:"999999999999999999"}),/unexpected/);
});
test("register requires trusted receipt and never calls global commands",async()=>{
 let calls=0;
 const fetchFn=async(url,options)=>{
  calls++;
  assert.match(url,/\/guilds\/1546529497925296199\/commands$/);
  assert.equal(options.headers.authorization,"Bot "+token);
  return {ok:true,json:async()=>({name:"squad",application_id:app,guild_id:guild})};
 };
 assert.equal((await registerTestGuildCommand({token,fetchFn})).registered,true);
 assert.equal(calls,1);
 await assert.rejects(registerTestGuildCommand({token,fetchFn:async()=>({ok:false,status:403})}),/HTTP 403/);
 await assert.rejects(registerTestGuildCommand({token,fetchFn:async()=>({ok:true,json:async()=>({name:"squad",application_id:"wrong",guild_id:guild})})}),/unexpected/);
});
