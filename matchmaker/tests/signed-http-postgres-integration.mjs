// Run ONLY against disposable PostgreSQL 17 in GitHub Actions.
// End-to-end signed HTTP -> trusted dispatcher -> actual PostgreSQL functions.
// No Discord network connection, bot token, public posting, or user data.
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import pg from "pg";
import {makeMatchmakerHttpHandler} from "../http-handler.mjs";
import {makeMatchmakerDispatcher} from "../command-dispatcher.mjs";
import {makePostgresMatchmakerStore} from "../postgres-store-adapter.mjs";
if(process.env.PGDATABASE!=="matchmaker_test"||process.env.PGHOST!=="localhost")
 throw Error("Refusing to run outside disposable local CI database");
const client=new pg.Client({host:process.env.PGHOST,port:Number(process.env.PGPORT||5432),
 database:process.env.PGDATABASE,user:process.env.PGUSER,password:process.env.PGPASSWORD});
await client.connect();
try {
 await client.query("SET ROLE service_role");
 const store=makePostgresMatchmakerStore({query:(sql,params)=>client.query(sql,params)});
 const keys=generateKeyPairSync("ed25519");
 const publicKeyHex=keys.publicKey.export({format:"der",type:"spki"}).subarray(-32).toString("hex");
 const now=1795032000000,ts=String(now/1000);
 let sequence=1572091972217215000n;
 function signed(data){
  const raw=Buffer.from(JSON.stringify({id:String(++sequence),...data}));
  return new Request("https://example.invalid/den-matchmaker",{
   method:"POST",
   headers:{"x-signature-ed25519":sign(null,Buffer.concat([Buffer.from(ts),raw]),keys.privateKey).toString("hex"),
      "x-signature-timestamp":ts,"content-type":"application/json"},
   body:raw
  });
 }
 const guild_id="1546529497925296199";
 const member={user:{id:"1418199180287148081"}};
 const stranger={user:{id:"1418199180287148082"}};
 // Two explicit test actors preserve the cross-owner token isolation test.
 const allowedTesterIds=new Set([member.user.id,stranger.user.id]);
 const values={game:"Call of Duty",platform:"Xbox",vibe:"Casual",mic:"Optional",timezone:"ET",availability:"Friday evening"};
 const cmd=(who,name,options=[])=>({type:2,guild_id,member:who,data:{name:"squad",options:[{name,options}]}});
 const click=(who,custom_id)=>({type:3,guild_id,member:who,data:{custom_id}});
 const handle=makeMatchmakerHttpHandler({
  publicKeyHex,clock:()=>now,enabled:true,allowedTesterIds,
  claimReplay:store.claimReplay,
  dispatch:makeMatchmakerDispatcher({store})
 });
 const createOptions=Object.entries(values).map(([name,value])=>({name,value}));
 let body=await (await handle(signed(cmd(member,"create",createOptions)))).json();
 assert.equal(body.data.flags,64);assert.deepEqual(body.data.allowed_mentions,{parse:[]});
 assert.equal(body.data.components?.[0]?.components?.length,2);
 const confirm=body.data.components[0].components[0].custom_id;
 const forged=await (await handle(signed(click(stranger,confirm)))).json();
 assert.match(forged.data.content,/could not complete/i);
 assert.match((await (await handle(signed(click(member,confirm)))).json()).data.content,/Nothing was posted or queued/);
 const ownerQueue=(await client.query("select count(*)::int as n from matchmaker_internal.post_outbox o join matchmaker_internal.squad_listings s on o.listing_id=s.id where s.owner_discord_id=$1",[member.user.id])).rows[0];
 assert.equal(ownerQueue.n,0,"Signed private confirmation must not enqueue a future public post");
 assert.match((await (await handle(signed(click(member,confirm)))).json()).data.content,/could not complete/i);
 body=await (await handle(signed(cmd(member,"mine")))).json();
 assert.match(body.data.content,/Call of Duty/);
 body=await (await handle(signed(cmd(member,"list")))).json();
 assert.match(body.data.content,/Call of Duty/);
 assert.doesNotMatch(body.data.content,/1418199180287148081/);
 assert.match((await (await handle(signed(cmd(member,"close")))).json()).data.content,/closed/);
 assert.match((await (await handle(signed(cmd(member,"mine")))).json()).data.content,/no active/i);
 const cancelPreview=await (await handle(signed(cmd(stranger,"create",createOptions)))).json();
 const tokenConfirm=cancelPreview.data.components[0].components[0].custom_id;
 const tokenCancel=cancelPreview.data.components[0].components[1].custom_id;
 assert.match((await (await handle(signed(click(stranger,tokenCancel)))).json()).data.content,/cancelled/);
 assert.match((await (await handle(signed(click(stranger,tokenConfirm)))).json()).data.content,/could not complete/i);
 // Fail closed if DB is unavailable and a signed request can't claim its interaction ID.
 const broken=makeMatchmakerHttpHandler({
  publicKeyHex,clock:()=>now,enabled:true,allowedTesterIds,
  claimReplay:async()=>{throw Error("DB unavailable");},
  dispatch:makeMatchmakerDispatcher({store})
 });
 assert.equal((await broken(signed({type:1}))).status,401);
 // A genuine cross-connection replay race: unlike the in-memory Set tests,
 // these requests use distinct PostgreSQL sessions and the real primary-key
 // claimant. Only one signed command may dispatch across concurrent workers.
 // All identities, signatures and messages below are synthetic; local CI only.
 const concurrentClients=[];
 try{
  for(let i=0;i<6;i++){
   const contender=new pg.Client({host:process.env.PGHOST,port:Number(process.env.PGPORT||5432),
    database:process.env.PGDATABASE,user:process.env.PGUSER,password:process.env.PGPASSWORD});
   await contender.connect();
   concurrentClients.push(contender);
   await contender.query("SET ROLE service_role");
  }
  let concurrentDispatches=0;
  const contestedId="1572091972217215999";
  const attempts=concurrentClients.map(contender=>{
   const claimantStore=makePostgresMatchmakerStore({query:(sql,params)=>contender.query(sql,params)});
   const contenderHandler=makeMatchmakerHttpHandler({
    publicKeyHex,clock:()=>now,enabled:true,allowedTesterIds,
    claimReplay:claimantStore.claimReplay,
    dispatch:async()=>{concurrentDispatches++;return {content:"private race winner"};}
   });
   // A fresh body stream and authentic signature per delivery, but one
   // Discord interaction ID; alternate payloads must not bypass deduplication.
   return contenderHandler(signed({...cmd(member,"list"),id:contestedId}));
  });
  const race=await Promise.all(attempts);
  assert.equal(race.filter(x=>x.status===200).length,1,
   "Only one real PostgreSQL claimant may accept the signed interaction");
  assert.equal(race.filter(x=>x.status===401).length,concurrentClients.length-1);
  assert.equal(concurrentDispatches,1,"No duplicate effects after replay race");
  const replayRows=(await client.query(
   "select count(*)::int as n from matchmaker_internal.discord_interaction_replays where interaction_id=$1",
   [contestedId])).rows[0];
  assert.equal(replayRows.n,1,"Durable primary key must record exactly one claim");
 }finally{
  await Promise.all(concurrentClients.map(c=>c.end()));
 }
 // Ordinary authenticated role still has no direct access to private tables.
 await client.query("RESET ROLE");
 await client.query("SET ROLE authenticated");
 await assert.rejects(client.query("select * from matchmaker_internal.squad_listings"),/permission denied/);
 await client.query("RESET ROLE");
 console.log("Signed HTTP to real disposable PostgreSQL roundtrip PASSED; no Discord posts created.");
}finally{await client.end();}
