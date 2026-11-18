import test from "node:test";
import assert from "node:assert/strict";
import {makeTransactionalMock} from "./transactional-mock.mjs";
const member={memberId:"1418199180287148073",guildId:"1546529497925296199"};
const stranger={memberId:"1546529501859815438",guildId:member.guildId};
const draft={game:"Call of Duty",platform:"Xbox",vibe:"Casual",mic:"Optional",timezone:"ET",availability:"Saturday evening"};
test("parallel confirmations cannot create duplicate listings",async()=>{
 let t=1000000;const app=makeTransactionalMock({clock:()=>t});
 const p1=app.preview(member,draft),p2=app.preview(member,draft);
 const outcome=await Promise.allSettled([app.confirm(member,p1.token),app.confirm(member,p2.token)]);
 assert.equal(outcome.filter(x=>x.status==="fulfilled").length,1);
 assert.equal(app.list(member).length,1);
 assert.equal(app.mine(member).publishStatus,"not_published");
 assert.equal(outcome.find(x=>x.status==="fulfilled").value.publicPostCreated,false);
 assert.rejects(app.confirm(member,p1.token));
 assert.rejects(app.confirm(member,p2.token));
});
test("preview is one use and cannot be stolen or used after deadline",async()=>{
 let t=1000000;const app=makeTransactionalMock({clock:()=>t});
 const p=app.preview(member,draft);
 await assert.rejects(app.confirm(stranger,p.token),/not yours/);
 await app.confirm(member,p.token);
 await assert.rejects(app.confirm(member,p.token),/used/);
 await assert.rejects(app.close(stranger),/Only the listing owner/);
 const closed=await app.close(member);assert.equal(closed.status,"closed");
 assert.equal(app.list(member).length,0);
 const again=app.preview(member,draft);
 t+=60001;
 await app.confirm(member,again.token);
 const old=app.preview(stranger,draft);
 t+=600001;
 await assert.rejects(app.confirm(stranger,old.token),/expired/);
});
test("expired active listing can be replaced; current active listing cannot",async()=>{
 let t=1000000;const app=makeTransactionalMock({clock:()=>t});
 const p=app.preview(member,draft);await app.confirm(member,p.token);
 t+=61000;
 await assert.rejects(app.confirm(member,app.preview(member,draft).token),/existing listing/);
 t+=36*60*60*1000;
 const newP=app.preview(member,draft);
 const res=await app.confirm(member,newP.token);
 assert.equal(res.listing.status,"active");assert.equal(app.list(member).length,1);
});
test("parallel duplicate interaction ids accepted only once",async()=>{
 const app=makeTransactionalMock();
 const results=await Promise.all(Array.from({length:30},()=>app.acceptInteraction("1546529501859815438")));
 assert.equal(results.filter(Boolean).length,1);
 assert.equal(await app.acceptInteraction("1546529501859815438"),false);
});
