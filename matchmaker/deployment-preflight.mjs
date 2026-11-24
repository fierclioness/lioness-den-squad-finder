// Read-only deployment preflight: never connects, deploys or prints secrets.
// 'readyForControlledTest' is NOT permission to enable a bot or migrate production.
import {pointsAtWrongSupabaseProject} from "./staging-runtime-config.mjs";
const SNOW=/^\d{15,22}$/;
const KEY=/^[a-f0-9]{64}$/i;
// A syntactically valid proxy/localhost URL is not proof the connection is
// isolated to the approved staging project. This conservative launch check
// does NOT change runtime's separately reviewed private-proxy compatibility.
const STAGING_REF="tcxktyqywsqafnyxhpgy";
function attributableToStaging(url){
 const host=url.hostname.toLowerCase();
 if(host==="db."+STAGING_REF+".supabase.co")return true;
 if(!/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host))return false;
 const username=decodeURIComponent(url.username).toLowerCase();
 return new RegExp("^[a-z0-9_]+\\."+STAGING_REF+"$").test(username);
}
export function auditMatchmakerConfig(config) {
  const errors=[],warnings=[];
  if(!config || typeof config!=="object")return {ok:false,readyForControlledTest:false,errors:["Missing configuration"],warnings:[]};
  const flag=config.commandsEnabled;
  if(flag!==false&&flag!==true)errors.push("Command flag must be a boolean");
  const publish=config.publishEnabled;
  if(publish!==false&&publish!==true)errors.push("Publishing flag must be a boolean");
  if(typeof config.publicKeyHex!=="string"||!KEY.test(config.publicKeyHex))
    errors.push("Discord public key is missing or invalid");
  let attributableDatabase=false;
  if(typeof config.databaseUrl!=="string"||!/^postgres(?:ql)?:\/\//i.test(config.databaseUrl))
    errors.push("A private PostgreSQL URL is not configured");
  else{
    let url;
    try{url=new URL(config.databaseUrl);}catch{errors.push("Database URL is malformed");}
    if(url){
      // Share the runtime staging-isolation guard with the human-facing launch
      // checklist: syntactically valid Den Missions/cross-project DB URLs must
      // never produce a green read-only Matchmaker deployment preflight.
      if(pointsAtWrongSupabaseProject(config.databaseUrl))
        errors.push("Database URL is outside approved isolated Matchmaker staging routing");
      attributableDatabase=!pointsAtWrongSupabaseProject(config.databaseUrl)&&attributableToStaging(url);
      if(!attributableDatabase)
        warnings.push("Database endpoint cannot be independently attributed to approved Supabase staging; manual proxy/connection review required before controlled release");
      if(url.username===""||url.password==="")errors.push("Database credentials are missing");
      // pg-connection-string query parameters can shadow URL authority values,
      // e.g. ?host=other-project overrides the reviewed hostname. Never clear
      // a staging preflight with such a hidden connection-target override.
      const params=[...url.searchParams];
      const shadow=new Set(["host","hostaddr","user","username","password","port","database","dbname","db"]);
      if(params.some(([name])=>shadow.has(name.toLowerCase())))
        errors.push("Database URL query parameters can override the reviewed connection identity");
      if(params.some(([name])=>["ssl","uselibpqcompat"].includes(name.toLowerCase())))
        errors.push("Database TLS override parameters are not permitted");
      // node-postgres interprets sslmode as a connection security hint.
      // Never approve downgrade modes, unknown modes, or duplicate/ambiguous
      // parameters where the client and reviewer could select different values.
      const sslModes=[...url.searchParams].filter(([name])=>name.toLowerCase()==="sslmode").map(([,value])=>value);
      if(sslModes.length>1 || sslModes.some(mode=>!["require","verify-ca","verify-full"].includes(mode)))
        errors.push("Database TLS mode is insecure or ambiguous");
      else if(sslModes.length===0 && url.hostname!=="localhost" && url.hostname!=="127.0.0.1")
        warnings.push("Database URL omits sslmode; verify TLS and certificate checks in the runtime driver");
      if(url.hostname==="localhost"||url.hostname==="127.0.0.1")
        warnings.push("Local PostgreSQL URL is not a hosted production connection");
    }
  }
  if(config.guildId!=="1546529497925296199")errors.push("Unexpected Discord guild");
  if(publish){
    // Discord snowflakes are exact identifiers, not JavaScript numbers. The
    // preview checklist must enforce the same trusted identities as the live
    // publish and original-bot cleanup workers; do not coerce numeric IDs.
    if(typeof config.channelId!=="string"||!SNOW.test(config.channelId))
      errors.push("Exact-string Discord destination channel ID required");
    if(typeof config.botUserId!=="string"||!SNOW.test(config.botUserId))
      errors.push("Exact-string original bot user ID required for verified cleanup");
    if(config.channelId===config.guildId)errors.push("Destination channel has not been independently identified");
    if(typeof config.botToken!=="string"||config.botToken.length<20)
      errors.push("Server-only Discord bot token required");
    if(flag!==true)errors.push("Do not publish when user commands are disabled");
  }
  if(flag===true)warnings.push("User commands would be active; authorized test window required");
  if(publish===true)warnings.push("Public posting would be active; verify channel permissions and rollback");
  if(config.gatewayDeadlineTested!==true)
    warnings.push("Three-second initial Discord response timing not verified in hosted environment");
  if(config.persistenceRuntimeTested!==true)
    warnings.push("Private PostgreSQL connection not verified in hosted Edge runtime");
  if(config.guildTestAccountPassed!==true)
    warnings.push("End-to-end authorized secondary account test not verified");
  if(config.messageReconciliationTested!==true)
    warnings.push("Timed-out post recovery and close/expiry message lifecycle not verified");
  if(config.privateSchemaReviewed!==true)
    warnings.push("Private schema permissions and production migration not approved");
  if(config.releaseApproved!==true)
    warnings.push("No explicit controlled release approval recorded");
  const operationalRequirements=[
    config.gatewayDeadlineTested===true,
    config.persistenceRuntimeTested===true,
    config.guildTestAccountPassed===true,
    config.messageReconciliationTested===true,
    config.privateSchemaReviewed===true,
    config.releaseApproved===true
  ];
  return {ok:errors.length===0,readyForControlledTest:errors.length===0&&attributableDatabase&&operationalRequirements.every(Boolean),errors,warnings};
}
