// DRAFT ONLY — independently authenticated, inert worker Edge entrypoint.
// NOT deployed. No database connection, no Discord credentials, no scheduler.
// This file remains deliberately self-contained for a safe auth-only smoke test.
// Never add worker calls until CI, key isolation and controlled release gates pass.
import {withSupabase} from "npm:@supabase/server@1.9.2";
const disabled=()=>Response.json({status:"disabled"},{
 status:503,headers:{"cache-control":"no-store"}
});
// Supabase's documented Edge wrapper uses the default exported fetch handler.
export default {
 fetch:withSupabase({auth:"secret:den-matchmaker-scheduler"},async()=>{
  return disabled();
 })
};
