// Response timing diagnostic for Discord's 3-second interaction deadline.
// Non-invasive, offline verification only: it does NOT cancel underlying
// database writes or pretend a Promise.race timeout is a safe transaction abort.
export const DISCORD_DEADLINE_MS=3000;
export const LOCAL_BUDGET_MS=2000; // headroom for cold start/network, not a guarantee.
export function makeResponseTimingProbe({handler,clock=()=>performance.now(),budgetMs=LOCAL_BUDGET_MS,onResult=()=>{}}){
 if(typeof handler!=="function"||typeof clock!=="function"||typeof onResult!=="function")
   throw Error("Valid handler, clock and reporter required");
 if(!Number.isFinite(budgetMs)||budgetMs<=0||budgetMs>=DISCORD_DEADLINE_MS)
   throw Error("Local budget must be below Discord's deadline");
 return async request=>{
   // Telemetry must never delay, replace, or cause a second attempt at a
   // signed interaction. A failing observer is not a Discord request failure.
   const report=result=>{
     try{
       const pending=onResult(result);
       if(pending && typeof pending.then==="function")
         void Promise.resolve(pending).catch(()=>{});
     }catch{/* best-effort diagnostics only */}
   };
   const start=clock();
   let response;
   try{
     response=await handler(request);
   }catch(error){
     report({elapsedMs:clock()-start,withinLocalBudget:false,
       withinDiscordDeadline:false,httpStatus:null});
     throw error;
   }
   const elapsedMs=clock()-start;
   report({elapsedMs,withinLocalBudget:elapsedMs>=0 && elapsedMs<budgetMs,
     withinDiscordDeadline:elapsedMs>=0 && elapsedMs<DISCORD_DEADLINE_MS,
     httpStatus:response?.status??null});
   return response;
 };
}
export function evaluateTimingSamples(samples,{budgetMs=LOCAL_BUDGET_MS}={}){
 if(!Array.isArray(samples)||samples.length===0||samples.some(x=>!Number.isFinite(x)||x<0))
  throw Error("Valid timing samples required");
 const sorted=[...samples].sort((a,b)=>a-b);
 const p95=sorted[Math.ceil(.95*sorted.length)-1];
 return {count:samples.length,p95Ms:p95,maxMs:sorted.at(-1),
   withinLocalBudget:p95<budgetMs && sorted.at(-1)<DISCORD_DEADLINE_MS};
}
