import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {makeOfflineDiscordAdapter} from "./discord-adapter-offline.mjs";
const key=generateKeyPairSync("ed25519");
const publicKeyHex=key.publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("hex");
const now=1795032000000;
const app=makeOfflineDiscordAdapter({publicKeyHex,clock:()=>now});
let seq=1546529501859815400n;
function signed(data){
 const rawBody=Buffer.from(JSON.stringify({id:String(++seq),...data}));
 const timestamp=String(now/1000);
 const signature=sign(null,Buffer.concat([Buffer.from(timestamp),rawBody]),key.privateKey).toString("hex");
 return {rawBody,timestamp,signature};
}
const guild_id="1546529497925296199",member={user:{id:"1418199180287148073"}};
const fields={game:"Call of Duty",platform:"Xbox",vibe:"Casual",mic:"Optional",timezone:"ET",availability:"Saturday evening"};
const create={type:2,guild_id,member,data:{name:"squad",options:[{name:"create",options:Object.entries(fields).map(([name,value])=>({name,value}))}]}};
const action=(custom_id)=>({type:3,guild_id,member,data:{custom_id}});
test("signed ping succeeds and unsigned ping rejected",()=>{
 assert.deepEqual(app.handleSigned(signed({type:1})).body,{type:1});
 const unsigned=signed({type:1});unsigned.signature="0".repeat(128);
 assert.equal(app.handleSigned(unsigned).httpStatus,401);
});
test("only signed verified-guild actor can preview then confirm privately",()=>{
 const bad=app.handleSigned(signed({...create,guild_id:"999999999999999999"}));
 assert.equal(bad.body.data.flags,64);
 assert.match(bad.body.data.content,/Only members/);
 const preview=app.handleSigned(signed(create));
 assert.equal(preview.body.data.flags,64);
 assert.equal(preview.body.data.components[0].components.length,2);
 assert.equal(preview.body.data.allowed_mentions.parse.length,0);
 const confirm=app.handleSigned(signed(action("matchmaker:confirm")));
 assert.equal(confirm.body.data.flags,64);
 assert.match(confirm.body.data.content,/No Discord message was posted/);
 assert.equal(confirm.body.data.components,undefined);
 const mine=app.handleSigned(signed({type:2,guild_id,member,data:{name:"squad",options:[{name:"mine"}]}}));
 assert.match(mine.body.data.content,/active squad listing/i);
 const close=app.handleSigned(signed({type:2,guild_id,member,data:{name:"squad",options:[{name:"close"}]}}));
 assert.match(close.body.data.content,/closed/);
});
test("rejects request replay, forged member ID, and unsupported command",()=>{
 const message=signed({type:2,guild_id,member,data:{name:"squad",options:[{name:"list"}]}});
 assert.equal(app.handleSigned(message).httpStatus,200);
 assert.equal(app.handleSigned(message).httpStatus,401);
 const forged=signed({...create,member:{user:{id:"not-a-snowflake"}}});
 assert.match(app.handleSigned(forged).body.data.content,/Only members/);
 assert.match(app.handleSigned(signed({type:2,guild_id,member,data:{name:"squad",options:[{name:"secret"}]}})).body.data.content,/Use \/squad/);
});

test("offline signed adapter refuses imprecise numeric and array-coerced actor IDs",()=>{
 const isolated=makeOfflineDiscordAdapter({publicKeyHex,clock:()=>now});
 const exact=member.user.id;
 assert.notEqual(String(Number(exact)),exact,"synthetic Discord ID demonstrates JS precision loss");
 for(const id of [Number(exact),[exact],null,123456789012345,{},["1234567890123456789"]]){
  const attempt=isolated.handleSigned(signed({
   ...create,member:{user:{id}}
  }));
  assert.equal(attempt.httpStatus,200);
  assert.equal(attempt.body.data.flags,64);
  assert.match(attempt.body.data.content,/Only members/);
  assert.equal(attempt.body.data.components,undefined,"invalid actor cannot create a preview");
 }
 const valid=isolated.handleSigned(signed(create));
 assert.equal(valid.httpStatus,200);
 assert.equal(valid.body.data.flags,64);
 assert.equal(valid.body.data.components?.[0]?.components?.length,2,
  "genuine primitive string actor still reaches the offline preview");
});
