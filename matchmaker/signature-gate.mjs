// Node-only offline Discord Ed25519 request gate. Not a deployed HTTP handler.
// Verify signature over exact timestamp + raw body bytes BEFORE JSON.parse.
import {createPublicKey, verify as verifySignature} from "node:crypto";

const SPKI_ED25519_PREFIX="302a300506032b6570032100";
const HEX=/^[0-9a-f]+$/i;
function decodeHex(value,expectedBytes) {
  if(typeof value!=="string" || value.length!==expectedBytes*2 || !HEX.test(value))
    throw new Error("Invalid hex");
  return Buffer.from(value,"hex");
}
export function makeSignatureGate({
  publicKeyHex,
  clock=()=>Date.now(),
  toleranceMs=5*60*1000
}) {
  const publicKey=createPublicKey({
    key:Buffer.concat([Buffer.from(SPKI_ED25519_PREFIX,"hex"),decodeHex(publicKeyHex,32)]),
    format:"der",type:"spki"
  });
  const seen=new Map();
  function authenticate({rawBody,timestamp,signature}) {
    if(!Buffer.isBuffer(rawBody)||rawBody.length===0||rawBody.length>1024*1024)
      throw new Error("Invalid body");
    if(typeof timestamp!=="string"||!/^\d{10}$/.test(timestamp))throw new Error("Invalid timestamp");
    const now=clock(),milliseconds=Number(timestamp)*1000;
    if(!Number.isFinite(now)||Math.abs(now-milliseconds)>toleranceMs)
      throw new Error("Stale or future interaction");
    const sig=decodeHex(signature,64);
    const signed=Buffer.concat([Buffer.from(timestamp,"utf8"),rawBody]);
    if(!verifySignature(null,signed,publicKey,sig))throw new Error("Invalid request signature");
    const data=JSON.parse(rawBody.toString("utf8"));
    if(!data||typeof data!=="object"||!/^\d{15,22}$/.test(String(data.id||"")))
      throw new Error("Invalid interaction ID");
    // In-memory replay protection is sufficient for tests ONLY, not multi-instance prod.
    for(const [id,expiresAt] of seen)if(expiresAt<=now)seen.delete(id);
    const id=String(data.id);
    if(seen.has(id))throw new Error("Replay detected");
    seen.set(id,now+toleranceMs);
    return data;
  }
  return Object.freeze({authenticate});
}
