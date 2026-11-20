import test from "node:test";
import assert from "node:assert/strict";
import {makeMatchmakerDispatcher} from "./command-dispatcher.mjs";
import {makeTransactionalMock} from "./transactional-mock.mjs";
const actor={guildId:"1546529497925296199",memberId:"1418199180287148073"};
const stranger={guildId:actor.guildId,memberId:"1546529501859815438"};
const draft={game:"Call of Duty",platform:"Xbox",vibe:"Casual",mic:"Optional",timezone:"ET",availability:"Saturday evening"};
const command=(a,name,options=[])=>({...a,type:2,data:{name:"squad",options:[{name,options}]}});
const click=(a,id)=>({...a,type:3,data:{custom_id:id}});
function setup(){
 const m=makeTransactionalMock({clock:()=>1000000});
 const store={prepare:(a,d)=>m.preview(a,d),confirm:(a,t)=>m.confirm(a,t),cancel:(a,t)=>m.cancel(a,t),
  mine:a=>m.mine(a),list:a=>m.list(a),close:async a=>{try{return (await m.close(a)).status==="closed";}catch{return false;}}};
 return makeMatchmakerDispatcher({store});
}
test("preview is private and confirms only when owner clicks",async()=>{
 const dispatch=setup(),opts=Object.entries(draft).map(([name,value])=>({name,value}));
 const p=await dispatch(command(actor,"create",opts));
 assert.match(p.content,/Nothing has been posted/);
 assert.match(p.content,/other Matchmaker users can see/);
 assert.match(p.content,/No #squad-up post or automatic DMs/);
 assert.doesNotMatch(p.content,/Reply in #squad-up/);
 assert.equal(p.buttons[0].label,"Save to /squad list");
 assert.deepEqual(p.buttons.map(x=>x.action),["confirm","cancel"]);
 assert.match((await dispatch(command(actor,"list"))).content,/No active/);
 const id="mm:confirm:"+p.buttons[0].token+":private";
 await assert.rejects(dispatch(click(stranger,id)),/not yours/);
 assert.match((await dispatch(click(actor,id))).content,/Nothing was posted/);
 await assert.rejects(dispatch(click(actor,id)),/used/);
 assert.match((await dispatch(command(actor,"list"))).content,/Call of Duty/);
 assert.doesNotMatch((await dispatch(command(actor,"list"))).content,/1418199180287148073/);
 assert.match((await dispatch(command(actor,"close"))).content,/closed/);
});
test("cancel invalidates token, no listing is created",async()=>{
 const dispatch=setup(),opts=Object.entries(draft).map(([name,value])=>({name,value}));
 const p=await dispatch(command(actor,"create",opts)),token=p.buttons[0].token;
 assert.match((await dispatch(click(actor,"mm:cancel:"+token+":private"))).content,/cancelled/);
 await assert.rejects(dispatch(click(actor,"mm:confirm:"+token+":private")),/not yours/);
 assert.match((await dispatch(command(actor,"list"))).content,/No active/);
});
test("reject bad guild, missing methods and unsafe draft",async()=>{
 assert.throws(()=>makeMatchmakerDispatcher({store:{}}),/storage adapter/);
 const dispatch=setup();
 await assert.rejects(dispatch(command({...actor,guildId:"999999999999999999"},"list")) ,/Invalid signed actor/);
 await assert.rejects(dispatch(command(actor,"create",[{name:"game",value:"@everyone"}])),/Invalid text|Mentions|Invalid selection/);
});

test("publication preview requires explicit consent and matching store flag",async()=>{
 const token="11111111-1111-4111-8111-111111111111";
 const store={
  prepare:async()=>({token}),confirm:async()=>({publicPostCreated:false,queuedForPublishing:true}),
  cancel:async()=>true,mine:async()=>null,list:async()=>[],close:async()=>false
 };
 assert.throws(()=>makeMatchmakerDispatcher({store,publishingEnabled:"true"}),/flag/);
 const privateDispatch=makeMatchmakerDispatcher({store});
 await assert.rejects(privateDispatch(click(actor,"mm:confirm:"+token+":private")),/consent/);
 const publicDispatch=makeMatchmakerDispatcher({store,publishingEnabled:true});
 const opts=Object.entries(draft).map(([name,value])=>({name,value}));
 const preview=await publicDispatch(command(actor,"create",opts));
 assert.match(preview.content,/PUBLIC posting/);
 assert.match(preview.content,/Only after you confirm/);
 assert.equal(preview.buttons[0].label,"Post to #squad-up");
 assert.match((await publicDispatch(click(actor,"mm:confirm:"+token+":public"))).content,/queued for posting/);
});

test("old private preview cannot be published after flag switches",async()=>{
 const token="11111111-1111-4111-8111-111111111111";
 let confirms=0;
 const store={prepare:async()=>({token}),confirm:async()=>{confirms++;return {publicPostCreated:false,queuedForPublishing:true};},cancel:async()=>true,mine:async()=>null,list:async()=>[],close:async()=>false};
 const published=makeMatchmakerDispatcher({store,publishingEnabled:true});
 const privatePreview="mm:confirm:"+token+":private";
 const result=await published(click(actor,privatePreview));
 assert.match(result.content,/settings changed/);
 assert.equal(confirms,0);
 const oldButton=await published(click(actor,"mm:confirm:"+token));
 assert.match(oldButton.content,/no longer available/);
 assert.equal(confirms,0);
});

test("old public preview cannot confirm after publishing is disabled",async()=>{
 const token="11111111-1111-4111-8111-111111111111";
 let confirms=0;
 const store={prepare:async()=>({token}),confirm:async()=>{confirms++;return {publicPostCreated:false,queuedForPublishing:false};},cancel:async()=>true,mine:async()=>null,list:async()=>[],close:async()=>false};
 const privateDispatcher=makeMatchmakerDispatcher({store,publishingEnabled:false});
 const result=await privateDispatcher(click(actor,"mm:confirm:"+token+":public"));
 assert.match(result.content,/settings changed/);
 assert.equal(confirms,0);
});

test("rejects numeric or boxed Discord actor IDs before any private storage access",async()=>{
 // Discord IDs such as this one exceed Number.MAX_SAFE_INTEGER.
 assert.notEqual(String(Number(actor.memberId)),actor.memberId);
 let reads=0;
 const store={
  prepare:async()=>{reads++;throw Error("must not prepare");},
  confirm:async()=>{reads++;throw Error("must not confirm");},
  cancel:async()=>{reads++;throw Error("must not cancel");},
  mine:async()=>{reads++;return null;},
  list:async()=>{reads++;return [];},
  close:async()=>{reads++;return false;}
 };
 const dispatch=makeMatchmakerDispatcher({store});
 for(const memberId of [
  Number(actor.memberId),BigInt(actor.memberId),new String(actor.memberId),null
 ]){
  await assert.rejects(
   dispatch(command({...actor,memberId},"mine")),
   /Invalid signed actor/,
   "Malformed actor identity must be rejected before touching member records"
  );
 }
 assert.equal(reads,0);
 assert.match((await dispatch(command(actor,"mine"))).content,/no active listing/);
 assert.equal(reads,1,"The original exact string identity remains accepted");
});

test("storage preview tokens must be primitive UUID strings before creating consent buttons",async()=>{
 const valid="11111111-1111-4111-8111-111111111111";
 let stores=0;
 const store={
  prepare:async()=>{stores++;return {token:nextToken};},
  confirm:async()=>{throw Error("must not confirm");},
  cancel:async()=>false,mine:async()=>null,list:async()=>[],close:async()=>false
 };
 const dispatch=makeMatchmakerDispatcher({store});
 const opts=Object.entries(draft).map(([name,value])=>({name,value}));
 let nextToken;
 for(const bad of [new String(valid),{toString:()=>valid},[valid],null,12345,valid+"x"]){
  nextToken=bad;
  await assert.rejects(dispatch(command(actor,"create",opts)),/Invalid preview token/);
 }
 nextToken=valid;
 const accepted=await dispatch(command(actor,"create",opts));
 assert.deepEqual(accepted.buttons.map(b=>b.token),[valid,valid]);
 assert.equal(stores,7);
});
