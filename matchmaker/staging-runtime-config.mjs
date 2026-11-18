// Server-only staging config resolution. Never logs, serializes or exports
// secret values to a response. Supabase supplies SUPABASE_DB_URL in Edge by default.
const STAGING_ORIGIN="https://tcxktyqywsqafnyxhpgy.supabase.co";
export function resolvePrivateDatabaseUrl(readEnv) {
 if(typeof readEnv!=="function")throw Error("Server environment reader required");
 const project=String(readEnv("SUPABASE_URL")||"").replace(/\/$/,"");
 const explicit=readEnv("DEN_MATCHMAKER_DATABASE_URL");
 // Explicit role-scoped private URL is the preferred production configuration.
 if(typeof explicit==="string" && /^(postgresql|postgres):\/\//.test(explicit))
  return explicit;
 // Supabase's built-in database URL may be used only on the isolated staging
 // project, never in the production Den Missions project.
 if(project===STAGING_ORIGIN){
  const stagingUrl=readEnv("SUPABASE_DB_URL");
  if(typeof stagingUrl==="string"&&/^(postgresql|postgres):\/\//.test(stagingUrl))
   return stagingUrl;
 }
 return "";
}
