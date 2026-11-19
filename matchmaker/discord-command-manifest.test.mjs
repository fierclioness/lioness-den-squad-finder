import test from "node:test";
import assert from "node:assert/strict";
import {squadCommand,validateManifest} from "./discord-command-manifest.mjs";
test("slash commands are correctly defined but not registered",()=>{
 assert.equal(validateManifest(),true);
 assert.equal(squadCommand.dm_permission,false);
 assert.deepEqual(squadCommand.options.map(o=>o.name),["create","mine","list","close"]);
 const fields=squadCommand.options[0].options;
 assert.deepEqual(fields.map(f=>f.name),["game","platform","vibe","mic","timezone","availability"]);
 assert.equal(fields.find(f=>f.name==="game").max_length,55);
 assert.equal(fields.find(f=>f.name==="availability").max_length,70);
});

test("command manifest has safe guild-only options and no elevated permissions",()=>{
 const create=squadCommand.options[0];
 assert.equal(squadCommand.name,"squad");
 assert.equal(squadCommand.dm_permission,false);
 assert.equal(squadCommand.default_member_permissions,undefined);
 assert.equal(create.options.every(f=>f.type===3&&f.required===true),true);
 assert.equal(create.options.filter(f=>f.choices).every(f=>f.choices.length<=25),true);
});
