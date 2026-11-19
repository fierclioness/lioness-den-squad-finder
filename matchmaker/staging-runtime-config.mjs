// Server-only staging config resolution. Never logs, serializes or exports
// secret values to a response. Supabase supplies SUPABASE_DB_URL in Edge by default.
// This branch is staging-only: deploying it accidentally to Den Missions production
// must not permit a database connection, even with an explicit override.
const STAGING_ORIGIN="https://tcxktyqywsqafnyxhpgy.supabase.co";
const DEN_MISSIONS_PRODUCTION_REF="cpjcjcxinhjusosaguyi";
function pointsAtDenMissions(databaseUrl){
 // Supabase direct hosts include the project ref in the hostname; pooler
 // connections ordinarily include it in the username (postgres.<ref>).
 // This check is defense-in-depth, not proof that a generic proxy is safe.
 try{
  const parsed=new URL(databaseUrl);
  const host=parsed.hostname.toLowerCase();
  const username=decodeURIComponent(parsed.username).toLowerCase();
  return host.includes(DEN_MISSIONS_PRODUCTION_REF) ||
    username.includes(DEN_MISSIONS_PRODUCTION_REF);
 }catch{return true;}
}
export function resolvePrivateDatabaseUrl(readEnv) {
 if(typeof readEnv!=="function")throw Error("Server environment reader required");
 const project=String(readEnv("SUPABASE_URL")||"").replace(/\/$/,"");
 // This DRAFT is explicitly limited to the isolated staging Edge project.
 // Production must require separate, reviewed code and user authorization.
 if(project!==STAGING_ORIGIN)return "";
 const explicit=readEnv("DEN_MATCHMAKER_DATABASE_URL");
 if(typeof explicit==="string" && /^(postgresql|postgres):\/\//.test(explicit)){
  if(pointsAtDenMissions(explicit))return "";
  return explicit;
 }
 const stagingUrl=readEnv("SUPABASE_DB_URL");
 if(typeof stagingUrl==="string"&&/^(postgresql|postgres):\/\//.test(stagingUrl)
    &&!pointsAtDenMissions(stagingUrl))
  return stagingUrl;
 return "";
}
