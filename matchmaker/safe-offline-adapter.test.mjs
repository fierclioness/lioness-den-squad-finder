import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {makeSafeOfflineAdapter} from "./safe-offline-adapter.mjs";
const key=generateKeyPairSync("ed25519");
const publicKeyHex=key.publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("hex");
const now=1795032000000;
const app=makeSafeOfflineAdapter({publicKeyHex,clock:()=>now});
let sequence=1546529501859815438n;
const guild_id="1546529497925296199";
const member={user:{id:"1418199180287148073"}};
const other={user:{id:"1546529501859815438"}};
const draft={game:"Call of Duty",platform:"Xbox",vibe:"Casual",mic:"Optional",timezone:"ET",availability:"Saturday"};
function signed(data){
 const rawBody=Buffer.from(JSON.stringify({id:String(++sequence),...data}));
 const timestamp=String(now/1000);
 const signature=sign(null,Buffer.concat([Buffer.from(timestamp),rawBody]),key.privateKey).toString("hex");
 return {rawBody,timestamp,signature};
}
const command=(who,sub,fields=[])=>signed({type:2,guild_id,member:who,data:{name:"squad",options:[{name:sub,options:fields}]}});
const click=(who,custom_id)=>signed({type:3,guild_id,member:who,data:{custom_id}});
test("signed PING, privacy and no public posts",async()=>{
 assert.deepEqual((await app.handleSigned(signed({type:1}))).body,{type:1});
 const p=await app.handleSigned(command(member,"create",Object.entries(draft).map(([name,value])=>({name,value}))));
 assert.equal(p.body.data.flags,64);
 assert.deepEqual(p.body.data.allowed_mentions,{parse:[]});
 assert.match(p.body.data.content,/Nothing has been posted/);
 const button=p.body.data.components[0].components[0].custom_id;
 const stolen=await app.handleSigned(click(other,button));
 assert.match(stolen.body.data.content,/not yours/);
 const [first,second]=await Promise.all([app.handleSigned(click(member,button)),app.handleSigned(click(member,button))]);
 assert.equal([first,second].filter(x=>/Saved to the test model/.test(x.body.data.content)).length,1);
 const list=await app.handleSigned(command(member,"list"));
 assert.match(list.body.data.content,/Call of Duty/);
 assert.equal(list.body.data.flags,64);
 assert.equal((await app.handleSigned(command(member,"close"))).body.data.flags,64);
 assert.match((await app.handleSigned(command(member,"list"))).body.data.content,/No active/);
});
test("tampering, wrong guild and invalid inputs fail closed",async()=>{
 const bad=signed({type:1});bad.signature="0".repeat(128);
 assert.equal((await app.handleSigned(bad)).httpStatus,401);
 const wrong=await app.handleSigned(signed({type:2,guild_id:"999999999999999999",member,data:{name:"squad",options:[{name:"list"}]}}));
 assert.match(wrong.body.data.content,/Only Lioness Den/);
 const badFields=await app.handleSigned(command(member,"create",[{name:"game",value:"@everyone"}]));
 assert.equal(badFields.body.data.flags,64);
 assert.match(badFields.body.data.content,/Unable/);
});
