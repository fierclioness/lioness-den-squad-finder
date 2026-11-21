// REVIEW ONLY. Authentication boundary for a future isolated scheduler Edge entrypoint.
// A trusted, independently authenticated Supabase server-to-server wrapper MUST call
// this adapter only after validating the dedicated named secret API key.
// Never use this adapter as a replacement for Supabase's auth:'secret:<name>' check.
const respond=(status,data)=>new Response(JSON.stringify(data),{
 status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
});
export function makeAuthenticatedSchedulerAdapter({gateway,expectedAuthMode="secret",enabled=false}={}){
 if(typeof gateway!=="function")throw Error("Trusted scheduler gateway required");
 if(typeof enabled!=="boolean")throw Error("Boolean deployment gate required");
 if(expectedAuthMode!=="secret")throw Error("Only server-to-server secret authentication supported");
 // Only call from within withSupabase({auth:'secret:<dedicated-name>'}, handler).
 return async (request,verifiedContext)=>{
  if(!enabled)return respond(503,{status:"disabled"});
  // The adapter checks the wrapper's reported mode; it CANNOT itself verify
  // the caller's API key. Missing/ambiguous contexts fail closed.
  if(!verifiedContext||verifiedContext.authMode!==expectedAuthMode)
   return respond(401,{error:"Unauthorized"});
  return gateway(request);
 };
}
