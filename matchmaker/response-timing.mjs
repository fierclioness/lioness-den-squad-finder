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
   // Diagnostic clocks are untrusted too. A failed or non-monotonic clock
   // must never prevent a signed Discord ACK or mask a handler exception.
   const readClock=()=>{
     try{
       const value=clock();
       return Number.isFinite(value)?value:null;
     }catch{return null;}
   };
   const start=readClock();
   const elapsed=()=>{
     if(start===null)return null;
     const end=readClock();
     if(end===null||end<start)return null;
     return end-start;
   };
   // Telemetry must never delay, replace, or trigger retry of an interaction.
   const report=result=>{
     try{
       const pending=onResult(result);
       if(pending && typeof pending.then==="function")
         void Promise.resolve(pending).catch(()=>{});
     }catch{/* best-effort diagnostics only */}
   };
   let response;
   try{
     response=await handler(request);
   }catch(error){
     const elapsedMs=elapsed();
     if(elapsedMs!==null)report({elapsedMs,withinLocalBudget:false,
       withinDiscordDeadline:false,httpStatus:null});
     throw error;
   }
   const elapsedMs=elapsed();
   if(elapsedMs!==null)report({elapsedMs,withinLocalBudget:elapsedMs<budgetMs,
     withinDiscordDeadline:elapsedMs<DISCORD_DEADLINE_MS,
     httpStatus:response?.status??null});
   return response;
 };
}
export function evaluateTimingSamples(samples,{budgetMs=LOCAL_BUDGET_MS}={}){
 if(!Number.isFinite(budgetMs)||budgetMs<=0||budgetMs>=DISCORD_DEADLINE_MS)
  throw Error("Local budget must be below Discord's deadline");
 if(!Array.isArray(samples)||samples.length===0||samples.some(x=>!Number.isFinite(x)||x<0))
  throw Error("Valid timing samples required");
 const sorted=[...samples].sort((a,b)=>a-b);
 const p95=sorted[Math.ceil(.95*sorted.length)-1];
 const maxMs=sorted.at(-1);
 // A p95-only gate can hide a slow outlier: with 20 samples, a single
 // 2,450ms response leaves p95 at the fast value. Release review must not
 // report that all responses met the 2,000ms local headroom budget.
 // Even a true result here is only OFFLINE diagnostic evidence, never
 // proof of Discord-client/network acknowledgment within three seconds.
 return {count:samples.length,p95Ms:p95,maxMs,
   p95WithinLocalBudget:p95<budgetMs,
   allWithinDiscordDeadline:maxMs<DISCORD_DEADLINE_MS,
   withinLocalBudget:p95<budgetMs && maxMs<budgetMs};
}
