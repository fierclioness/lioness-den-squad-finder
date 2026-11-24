import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeReceiptCleanup} from './receipt-authorization.mjs';
const a='123456789012345678',b='234567890123456789',c='345678901234567890',d='456789012345678901';
const valid=()=>({receipt:{messageId:a,channelId:b,botUserId:c},expected:{channelId:b,botUserId:c},observedMessage:{id:a,channelId:b,authorId:c}});
test('verified original bot',()=>assert.equal(authorizeReceiptCleanup(valid()),true));
for(const [name,change] of [
 ['wrong message',x=>x.observedMessage.id=d],['wrong channel',x=>x.observedMessage.channelId=d],
 ['wrong author',x=>x.observedMessage.authorId=d],['wrong destination',x=>x.expected.channelId=d],
 ['wrong expected bot',x=>x.expected.botUserId=d],['boxed id',x=>x.receipt.messageId=new String(a)],
 ['numeric id',x=>x.receipt.messageId=Number(a)],['array id',x=>x.observedMessage.id=[a]],
 ['missing author',x=>delete x.observedMessage.authorId],['malformed id',x=>x.receipt.channelId='bad']]){
 test('reject '+name,()=>{const x=valid();change(x);assert.equal(authorizeReceiptCleanup(x),false)});
}
test('reject missing objects',()=>assert.equal(authorizeReceiptCleanup({}),false));
