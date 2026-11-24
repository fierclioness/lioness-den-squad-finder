// Public read-only diagnostic for the isolated Matchmaker STAGING endpoint.
// No secrets, database queries, member lookups, or command execution occur here.
// The status reflects trusted server-side configuration, never request parameters.
// This endpoint reports ROUTING/CONFIG state, not database availability or E2E readiness.
export function stagingHealthResponse(request,{commandsEnabled=false,configured=true,postingEnabled=false}={}){
 if(typeof commandsEnabled!=="boolean"||typeof configured!=="boolean"||typeof postingEnabled!=="boolean")
   throw Error("Health feature flags must be booleans");
 const url=new URL(request.url);
 const isHealth=url.pathname==="/health" || url.pathname==="/den-matchmaker/health" ||
   url.pathname==="/functions/v1/den-matchmaker/health";
 if(request.method!=="GET"||!isHealth)
   return null;
 const status=!commandsEnabled?"commands_disabled":
   configured?"commands_enabled":"configuration_incomplete";
 return new Response(JSON.stringify({
   service:"den-matchmaker",
   environment:"staging",
   status,
   posting_enabled:configured&&commandsEnabled&&postingEnabled,
   member_data_access:false // The health endpoint itself never queries member data.
 }),{
   status:200,
   headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
 });
}
