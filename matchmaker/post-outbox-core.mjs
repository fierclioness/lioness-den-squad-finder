// Offline, fail-closed Discord post/outbox state machine.
// This models persistence transitions; it does NOT call Discord or provide distributed locks.
// Production transitions must be atomic database operations with strict ownership checks.
export const POST_STATES = Object.freeze(["pending","sending","posted","uncertain","failed","cancelled"]);
export function newOutbox({listingId,ownerId,now=Date.now()}){
 if(typeof listingId!=="string"||!listingId || !/^\d{15,22}$/.test(ownerId))throw Error("Invalid listing identity");
 return {listingId,ownerId,state:"pending",attempts:0,createdAt:now,updatedAt:now,messageId:null,lastError:null};
}
export function claimPost(row,{workerId,now=Date.now(),maxAttempts=3}){
 if(!row || !workerId || !Number.isFinite(now))throw Error("Invalid claim");
 if(row.state!=="pending" && row.state!=="failed")throw Error("Not safe to claim post");
 if(row.attempts>=maxAttempts)throw Error("Manual review required");
 return {...row,state:"sending",workerId,attempts:row.attempts+1,updatedAt:now};
}
export function confirmPost(row,{workerId,messageId,now=Date.now()}){
 if(row.state!=="sending" || row.workerId!==workerId)throw Error("Not the owning worker");
 if(typeof messageId!=="string"||!/^\d{15,22}$/.test(messageId))throw Error("Invalid Discord message ID");
 return {...row,state:"posted",messageId,updatedAt:now,workerId:null,lastError:null};
}
export function markPostFailure(row,{workerId,now=Date.now(),definitelyNotPosted=false,reason="Discord delivery not confirmed"}){
 if(row.state!=="sending" || row.workerId!==workerId)throw Error("Not the owning worker");
 // A timeout or 5xx is ambiguous: do not automatically retry. Discord may have posted!
 return {...row,state:definitelyNotPosted?"failed":"uncertain",updatedAt:now,workerId:null,lastError:String(reason).slice(0,200)};
}
export function cancelOutbox(row,{now=Date.now()}={}){
 if(row.state==="posted"||row.state==="sending"||row.state==="uncertain")
  throw Error("May already be published; reconcile Discord before closing");
 if(row.state!=="pending"&&row.state!=="failed")throw Error("Cannot cancel");
 return {...row,state:"cancelled",updatedAt:now};
}
export function canAutoRetry(row){return row.state==="failed" && row.attempts<3;}
export function requiresManualReconciliation(row){return row.state==="uncertain";}
