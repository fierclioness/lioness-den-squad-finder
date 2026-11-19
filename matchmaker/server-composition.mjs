// Review-only server composition. No credentials and NO network side effects.
// A deployment must pass a trustworthy private DB query(sql, params) function.
// Live member posting is intentionally NOT implemented here.
import {makePostgresMatchmakerStore} from "./postgres-store-adapter.mjs";
import {makeMatchmakerDispatcher} from "./command-dispatcher.mjs";
import {makeMatchmakerHttpHandler} from "./http-handler.mjs";
import {makeResponseTimingProbe} from "./response-timing.mjs";

/** @param {{publicKeyHex:string,query:Function,enabled?:boolean,publishingEnabled?:boolean,allowedTesterIds?:Set<string>|null,clock?:()=>number,onTiming?:(result:any)=>void}} config */
export function makeMatchmakerServer({publicKeyHex,query,enabled=false,publishingEnabled=false,allowedTesterIds=null,clock=()=>Date.now(),onTiming=()=>{}}){
  if (typeof query !== "function") throw Error("Private database query connector required");
  if (enabled !== true && enabled !== false) throw Error("Feature gate must be a boolean");
  if (typeof publishingEnabled !== "boolean" || (publishingEnabled && !enabled))
    throw Error("Publishing requires an explicitly enabled, reviewed command flow");
  const store=makePostgresMatchmakerStore({query,publishingEnabled});
  const handler=makeMatchmakerHttpHandler({
    publicKeyHex,
    clock,
    claimReplay:store.claimReplay, // Postgres primary key, persistent across workers
    dispatch:makeMatchmakerDispatcher({store,publishingEnabled}),
    enabled,
    allowedTesterIds
  });
  return makeResponseTimingProbe({handler,onResult:onTiming});
}
