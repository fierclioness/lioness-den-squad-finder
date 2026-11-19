// Server-only staging config resolution. Never logs, serializes or exports
// secret values to a response. Supabase supplies SUPABASE_DB_URL in Edge by default.
// This branch is staging-only: deploying it accidentally to Den Missions production
// must not permit a database connection, even with an explicit override.
const STAGING_REF="tcxktyqywsqafnyxhpgy";
const STAGING_ORIGIN="https://"+STAGING_REF+".supabase.co";
const DEN_MISSIONS_PRODUCTION_REF="cpjcjcxinhjusosaguyi";
function pointsAtWrongSupabaseProject(databaseUrl){
 // Deny Den Missions, plus any OTHER recognizable Supabase project ref.
 // Direct DB hosts carry the ref in db.<ref>.supabase.co; pooler users
 // ordinarily carry it in postgres.<ref>. Generic/private proxies cannot
 // be attributed by URL alone and still need independent credential review.
 try{
  const parsed=new URL(databaseUrl);
  const host=parsed.hostname.toLowerCase();
  const username=decodeURIComponent(parsed.username).toLowerCase();
  if(host.includes(DEN_MISSIONS_PRODUCTION_REF) ||
     username.includes(DEN_MISSIONS_PRODUCTION_REF))return true;
  const directRef=/^db\.([a-z0-9]{20})\.supabase\.co$/.exec(host)?.[1];
  // Supabase poolers are shared: the project ref must be present in the
  // database role (postgres.<ref> or a custom role.<ref>).
  const poolerRef=/^[a-z0-9_]+\.([a-z0-9]{20})$/.exec(username)?.[1];
  const canonicalPooler=/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host);
  // A URL that only resembles an official Supabase hostname (for example,
  // db.<ref>.supabase.co.evil.invalid) must never receive DB credentials.
  // Dedicated private proxy hosts remain possible but need separate review.
  const supabaseLikeHost=/(?:^|\.)supabase\.(?:co|com)(?:\.|$)/.test(host);
  if(supabaseLikeHost&&!directRef&&!canonicalPooler)return true;
  if(canonicalPooler&&!poolerRef)return true;
  return Boolean((directRef&&directRef!==STAGING_REF) ||
    (poolerRef&&poolerRef!==STAGING_REF));
 }catch{return true;}
}
export function resolvePrivateDatabaseUrl(readEnv) {
 if(typeof readEnv!=="function")throw Error("Server environment reader required");
 const project=String(readEnv("SUPABASE_URL")||"").replace(/\/$/,"");
 // This DRAFT is explicitly limited to the isolated staging Edge project.
 // Production must require separate, reviewed code and user authorization.
 if(project!==STAGING_ORIGIN)return "";
 const explicit=readEnv("DEN_MATCHMAKER_DATABASE_URL");
 // If an operator specified a private override, it must be usable and
 // staging-bound. Never silently fall back to the broader built-in URL after
 // a bad or cross-project override: that would change the intended identity.
 if(explicit!==undefined && explicit!==null){
  if(typeof explicit!=="string" || !/^(postgresql|postgres):\/\//.test(explicit)
     || pointsAtWrongSupabaseProject(explicit))return "";
  return explicit;
 }
 const stagingUrl=readEnv("SUPABASE_DB_URL");
 if(typeof stagingUrl==="string"&&/^(postgresql|postgres):\/\//.test(stagingUrl)
    &&!pointsAtWrongSupabaseProject(stagingUrl))
  return stagingUrl;
 return "";
}
