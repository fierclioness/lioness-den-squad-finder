// REVIEW ONLY — one-item private scheduler HTTP gateway, not deployed or enabled.
// Intended defense-in-depth with Supabase verify_jwt=true PLUS a separate server-side
// x-matchmaker-scheduler-key; never a Discord app token or account password.
// Individual workers already gate their own operations. No Discord credentials here.
// An enabled task must not report another worker\'s outcome or claim success\n// while its internal feature gate is disabled. Treat mismatches as faults.\nconst TASK_STATUSES=Object.freeze({\n  publish:new Set(["empty","posted","posted_cleanup_queued","unsent","uncertain"]),\n  cleanup:new Set(["empty","deleted","already_absent","quarantined","uncertain"]),\n  maintenance:new Set(["complete"])\n});
const HEADERS={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const respond=(status,data)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const enc=new TextEncoder();
const hash=async value=>new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(value)));
async function matchesSecret(given,expected){
 if(typeof given!=="string"||given.length<32||given.length>256)return false;
 const [a,b]=await Promise.all([hash(given),hash(expected)]);
 let diff=0;
 for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
 return diff===0;
}
export function makeScheduledWorkerGateway({
 schedulerSecret="",enabled=false,postingEnabled=false,cleanupEnabled=false,
 maintenanceEnabled=false,publisher,cleanup,maintenance
}={}){
 if([enabled,postingEnabled,cleanupEnabled,maintenanceEnabled].some(v=>typeof v!=="boolean"))
  throw Error("All worker gates must be booleans");
 if(!enabled&&(postingEnabled||cleanupEnabled||maintenanceEnabled))
  throw Error("A worker cannot be active while its scheduler is disabled");
 if(enabled&&(!/^[\x21-\x7e]{32,256}$/.test(schedulerSecret)))
  throw Error("A long server-only scheduler secret is required");
 const tasks={
  publish:{allow:postingEnabled,runner:publisher},
  cleanup:{allow:cleanupEnabled,runner:cleanup},
  maintenance:{allow:maintenanceEnabled,runner:maintenance}
 };
 if(enabled&&Object.values(tasks).some(t=>t.allow&&typeof t.runner?.runOnce!=="function"))
  throw Error("A trusted worker is missing");
 return async request=>{
  if(!enabled)return respond(503,{status:"disabled"});
  if(request.method!=="POST")return respond(405,{error:"Method not allowed"});
  if(!await matchesSecret(request.headers.get("x-matchmaker-scheduler-key"),schedulerSecret))
   return respond(401,{error:"Unauthorized"});
  // There is no user data to accept. Refuse even a small JSON payload.
  if(request.body!==null)return respond(400,{error:"Request body not allowed"});
  let taskName;
  try{taskName=new URL(request.url).pathname.split("/").filter(Boolean).at(-1);}
  catch{return respond(404,{error:"Not found"});}
  const task=tasks[taskName];
  if(!task)return respond(404,{error:"Not found"});
  if(!task.allow)return respond(403,{error:"Task disabled"});
  try{
   const outcome=await task.runner.runOnce();
   if(!TASK_STATUSES[taskName].has(outcome?.status))throw Error("Unexpected or disabled worker result");
   // Never return member IDs, message IDs, tokens or internal SQL errors.
   return respond(200,{task:taskName,status:outcome.status});
  }catch{return respond(503,{error:"Worker unavailable"});}
 };
}
