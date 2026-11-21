// REVIEW ONLY — isolated scheduler's Supabase authentication composition.
// No Edge function is deployed by importing this module. Never import into
// the existing Discord interaction webhook.
// Supabase Edge must be deployed with verify_jwt=false ONLY for this separate
// function, and withSupabase performs named-secret authentication instead.
// Reference: https://supabase.com/docs/guides/functions/auth
import {makeAuthenticatedSchedulerAdapter} from "./authenticated-scheduler-adapter.mjs";
const NAME="den_matchmaker_scheduler";
export const SCHEDULER_AUTH_MODE="secret:"+NAME;
export function makeSupabaseAuthenticatedScheduler({withSupabase,gateway,enabled=false}={}){
 if(typeof withSupabase!=="function")throw Error("Trusted Supabase auth wrapper required");
 const adapter=makeAuthenticatedSchedulerAdapter({gateway,enabled});
 // The SDK validates the dedicated named API key on the 'apikey' header.
 // A generic secret, user JWT, publishable key, or missing key is not accepted.
 return withSupabase({auth:SCHEDULER_AUTH_MODE},async(request,ctx)=>{
  // ctx.authMode may be reported as the generic 'secret' class by the SDK.
  // The wrapper is configured to accept only the named key above.
  return adapter(request,ctx);
 });
}
