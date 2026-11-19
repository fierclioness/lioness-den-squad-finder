import {PLATFORMS,VIBES,MIC,ZONES} from "./matchmaker-core.mjs";
// Guild-scoped Discord application command definition (NOT registered).
// All commands default to ephemeral responses from a separately verified endpoint.
const choose = values => values.map(value => ({name:value,value}));
const field=(name,description,{required=true,choices,max_length}={})=>({
  type:3,name,description,required,
  ...(choices?{choices:choose(choices)}:{}),
  ...(max_length?{max_length}:{})
});
export const squadCommand={
  name:"squad",description:"Find your people in The Lioness Den",type:1,
  dm_permission:false,
  options:[
    {type:1,name:"create",description:"Preview an optional squad listing",options:[
      field("game","Which game are you playing?",{max_length:55}),
      field("platform","Which platform?",{choices:["Xbox","PlayStation","PC","Switch","Cross-play","Other"]}),
      field("vibe","Casual or competitive?",{choices:["Casual","Competitive","Either"]}),
      field("mic","Mic preference?",{choices:["Optional","Required","No mic"]}),
      field("timezone","Approximate time zone?",{choices:["ET","CT","MT","PT","AT","UK","CET/CEST","UTC","Other"]}),
      field("availability","When are you available?",{max_length:70})
    ]},
    {type:1,name:"mine",description:"See your active listing privately"},
    {type:1,name:"list",description:"See active opt-in listings privately"},
    {type:1,name:"close",description:"Close your current listing"}
  ]
};
export function validateManifest(){
 if(squadCommand.name!=="squad" || squadCommand.options.length!==4)
  throw new Error("Invalid command structure");
 const create=squadCommand.options[0];
 if(create.options.length!==6 || create.options.some(x=>!x.required))
  throw new Error("Incomplete create form");
 const expected=[PLATFORMS,VIBES,MIC,ZONES];
 for(let i=0;i<expected.length;i++){
  const choices=create.options[i+1].choices?.map(x=>x.value);
  if(JSON.stringify(choices)!==JSON.stringify(expected[i]))throw Error("Discord choices drifted from draft validation");
 }
 if(create.options[0].max_length!==55||create.options[5].max_length!==70)throw Error("Discord text limits drifted");
 if(create.options.some(x=>x.choices?.length>25))
  throw new Error("Discord choice cap exceeded");
 return true;
}
