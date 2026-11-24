// Staging-only maintenance connection. No Discord transport or retention.
import {makeMaintenanceWorker} from "./maintenance-worker.mjs";
/** @param {{query:(sql:string,args:unknown[])=>Promise<any>,enabled?:boolean}} options */
export function makeStagingMaintenanceHandler({query,enabled=false}){
 const worker=makeMaintenanceWorker({query,enabled,transientRetentionEnabled:false});
 const respond=(body,status)=>Response.json(body,{status,headers:{"cache-control":"no-store"}});
 return async request=>{
  if(request.method!=="POST")return respond({status:"method_not_allowed"},405);
  if(!enabled)return respond({status:"disabled"},503);
  try{return respond(await worker.runOnce(),200);}
  catch{return respond({status:"maintenance_failed"},503);}
 };
}
