// Public diagnostic for the isolated Matchmaker STAGING endpoint only.
// Does not read secrets, query databases or accept commands.
export function stagingHealthResponse(request){
 const url=new URL(request.url);
 const isHealth=url.pathname==="/health" || url.pathname==="/den-matchmaker/health" ||
   url.pathname==="/functions/v1/den-matchmaker/health";
 if(request.method!=="GET"||!isHealth)
   return null;
 return new Response(JSON.stringify({
   service:"den-matchmaker",
   environment:"staging",
   status:"commands_disabled",
   posting_enabled:false,
   member_data_access:false
 }),{
   status:200,
   headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
 });
}
