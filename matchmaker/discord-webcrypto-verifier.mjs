// Runtime-neutral Ed25519 verifier for a future Discord interaction gateway.
// No HTTP server or production integration. Requires a DURABLE claimReplay callback.
// Unlike the Node mock signature gate, never relies on an in-process replay Map.
function fromHex(input,bytes){
 if(typeof input!=="string" || input.length!==bytes*2 || !/^[0-9a-f]+$/i.test(input))
   throw new Error("Invalid signature encoding");
 return Uint8Array.from(input.match(/../g),h=>parseInt(h,16));
}
export function makeDiscordVerifier({publicKeyHex,claimReplay,clock=()=>Date.now(),maxAgeMs=300000}){
 if(typeof claimReplay!=="function")throw new Error("Durable replay claimant required");
 const encoder=new TextEncoder();
 const keyPromise=crypto.subtle.importKey("raw",fromHex(publicKeyHex,32),{name:"Ed25519"},false,["verify"]);
 async function authenticate({rawBody,timestamp,signature}){
   if(!(rawBody instanceof Uint8Array)||rawBody.byteLength===0||rawBody.byteLength>1048576)
     throw new Error("Invalid request body");
   if(typeof timestamp!=="string"||!/^\d{10}$/.test(timestamp))
     throw new Error("Invalid interaction timestamp");
   const now=clock(),sent=Number(timestamp)*1000;
   if(!Number.isFinite(now)||!Number.isFinite(sent)||Math.abs(now-sent)>maxAgeMs)
     throw new Error("Request outside allowed time window");
   const bytes=encoder.encode(timestamp);
   const message=new Uint8Array(bytes.length+rawBody.byteLength);
   message.set(bytes,0);message.set(rawBody,bytes.length);
   const key=await keyPromise;
   if(!await crypto.subtle.verify({name:"Ed25519"},key,fromHex(signature,64),message))
     throw new Error("Invalid Discord signature");
   let interaction;
   try{interaction=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(rawBody));}
   catch{throw new Error("Invalid JSON payload");}
   const id=interaction?.id;
   if(typeof id!=="string"||!/^\d{15,22}$/.test(id))
     throw new Error("Invalid interaction ID");
   // Caller's durable claimant MUST atomically insert and commit the ID.
   // Fails closed when storage cannot be reached. Never continue on error.
   if(await claimReplay(id)!==true)throw new Error("Interaction already handled");
   return interaction;
 }
 return Object.freeze({authenticate});
}
