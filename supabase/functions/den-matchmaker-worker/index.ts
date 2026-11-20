// DRAFT ONLY — Den Matchmaker worker Edge entrypoint. NOT deployed.
// This scaffold deliberately has NO database connection and NO Discord credentials.
// Supabase named-secret authentication runs before the disabled worker response.
// Never replace this 503 response with real workers without passing release gates.
import {withSupabase} from "npm:@supabase/server@1";
import {makeSupabaseAuthenticatedScheduler} from "../../../matchmaker/supabase-authenticated-scheduler.mjs";
import {makeScheduledWorkerGateway} from "../../../matchmaker/scheduled-worker-gateway.mjs";
const gateway=makeScheduledWorkerGateway(); // disabled; no worker task enabled
const handler=makeSupabaseAuthenticatedScheduler({
 withSupabase,gateway,enabled:false
});
Deno.serve(handler);
