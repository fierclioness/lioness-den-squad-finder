// Review-only server composition. No credentials and NO network side effects.
// A deployment must pass a trustworthy private DB query(sql, params) function.
// Live member posting is intentionally NOT implemented here.
import {makePostgresMatchmakerStore} from "./postgres-store-adapter.mjs";
import {makeMatchmakerDispatcher} from "./command-dispatcher.mjs";
import {makeMatchmakerHttpHandler} from "./http-handler.mjs";

export function makeMatchmakerServer({publicKeyHex,query,enabled=false,clock=()=>Date.now()}){
  if (typeof query !== "function") throw Error("Private database query connector required");
  if (enabled !== true && enabled !== false) throw Error("Feature gate must be a boolean");
  const store=makePostgresMatchmakerStore({query});
  return makeMatchmakerHttpHandler({
    publicKeyHex,
    clock,
    claimReplay:store.claimReplay, // Postgres primary key, persistent across workers
    dispatch:makeMatchmakerDispatcher({store}),
    enabled
  });
}
