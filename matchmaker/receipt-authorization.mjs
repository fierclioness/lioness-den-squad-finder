// Pure offline cleanup authorization preflight; no Discord or DB operations.
const SNOWFLAKE=/^[0-9]{15,22}$/;
const exactId=value=>typeof value==='string'&&SNOWFLAKE.test(value);
// receipt MUST originate from trusted persisted receipt storage; observedMessage
// MUST originate from a fresh authenticated Discord GET, not user input.
export function authorizeReceiptCleanup({receipt,expected,observedMessage}={}){
 if(!receipt||!expected||!observedMessage||
    [receipt,expected,observedMessage].some(x=>typeof x!=='object'||Array.isArray(x)))return false;
 const ids=[receipt.messageId,receipt.channelId,receipt.botUserId,
  expected.channelId,expected.botUserId,
  observedMessage.id,observedMessage.channelId,observedMessage.authorId];
 if(!ids.every(exactId))return false;
 return receipt.channelId===expected.channelId&&
  receipt.botUserId===expected.botUserId&&
  receipt.messageId===observedMessage.id&&
  receipt.channelId===observedMessage.channelId&&
  receipt.botUserId===observedMessage.authorId;
}
