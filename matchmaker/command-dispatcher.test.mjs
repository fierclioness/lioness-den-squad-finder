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
 assert.deepEqual(p.buttons.map(x=>x.action),["confirm","cancel"]);
 assert.match((await dispatch(command(actor,"list"))).content,/No active/);
 const id="mm:confirm:"+p.buttons[0].token;
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
 assert.match((await dispatch(click(actor,"mm:cancel:"+token))).content,/cancelled/);
 await assert.rejects(dispatch(click(actor,"mm:confirm:"+token)),/not yours/);
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
 await assert.rejects(privateDispatch(click(actor,"mm:confirm:"+token)),/consent/);
 const publicDispatch=makeMatchmakerDispatcher({store,publishingEnabled:true});
 const opts=Object.entries(draft).map(([name,value])=>({name,value}));
 const preview=await publicDispatch(command(actor,"create",opts));
 assert.match(preview.content,/PUBLIC posting/);
 assert.equal(preview.buttons[0].label,"Post to #squad-up");
 assert.match((await publicDispatch(click(actor,"mm:confirm:"+token))).content,/queued for posting/);
});
