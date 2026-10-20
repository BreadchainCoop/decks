#!/usr/bin/env node
const fs=require("node:fs"),path=require("node:path"),{pathToFileURL}=require("node:url"),assert=require("node:assert/strict"),vm=require("node:vm");
async function main(){
  const root=path.resolve(__dirname,"../../../decks-src"),{configureRuntime}=await import(pathToFileURL(path.join(root,"runtime-config.mjs")));
  const env={BREAD_SUITE_URL:"https://script.google.com/macros/s/synthetic/exec",BREAD_MEMBER_TOKEN:"synthetic-"+"x".repeat(40),BREAD_CRM_V2:"true",BREAD_CRM_FEED_ID:"synthetic-feed-copy",BREAD_CRM_SOURCE_ID:"synthetic-source-copy",BREAD_CRM_CAMPAIGNS_GID:"1",BREAD_CRM_CONTACTS_GID:"2",BREAD_CRM_LINKS_GID:"3",BREAD_CRM_HISTORY_GID:"4"};
  Object.assign(env,{BREAD_WORK_SOURCE_ID:"synthetic-work-copy",BREAD_WORK_TASKS_GID:"5",BREAD_WORK_HISTORY_GID:"6",BREAD_CONTRIB_SOURCE_ID:"synthetic-contributor-copy",BREAD_GRANTS_SOURCE_ID:"synthetic-grants-copy",BREAD_GRANTS_FEED_ID:"synthetic-grants-feed",BREAD_GRANTS_TARGETS_GID:"7",BREAD_GRANTS_STATS_GID:"8"});
  const files={"bread-hq":"bread-hq/app.js","work-tracker":"work-tracker/app.js","contributor-dashboard":"contributor-dashboard/app.js","grant-dashboard":"grant-dashboard/grant-dashboard.src.html","crm-dashboard":"crm-dashboard/crm-dashboard.src.html"};
  for(const [deck,file]of Object.entries(files)){
    const original=fs.readFileSync(path.join(root,file),"utf8"),configured=configureRuntime(original,deck,env);
    assert.equal(configureRuntime(original,deck,{}),original,"unconfigured source retains its original contract");
    assert.ok(configured.includes(env.BREAD_SUITE_URL));assert.ok(configured.includes(env.BREAD_MEMBER_TOKEN));
    if(deck==="work-tracker"||deck==="contributor-dashboard")assert.ok(configured.includes(env.BREAD_WORK_SOURCE_ID),"staging read and write source configured together");
    if(deck==="grant-dashboard")assert.ok(configured.includes(env.BREAD_GRANTS_SOURCE_ID));
    assert.equal(fs.readFileSync(path.join(root,file),"utf8"),original,"injection never persists secrets to source");
    if(file.endsWith(".js"))new vm.Script(configured);
    else for(const m of configured.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
  }
  assert.throws(()=>configureRuntime("","bread-hq",{BREAD_SUITE_URL:env.BREAD_SUITE_URL}),/both/);
  assert.throws(()=>configureRuntime("","bread-hq",{...env,BREAD_SUITE_URL:"javascript:alert(1)"}),/Invalid suite/);
  assert.throws(()=>configureRuntime("const CRM_V2 = {};","crm-dashboard",{...env,BREAD_CRM_SOURCE_ID:""}),/Missing/);
  const injection=configureRuntime("const HQ_CONFIG = {};","bread-hq",{...env,BREAD_MEMBER_TOKEN:"</script>"+"x".repeat(40)});
  assert.equal(injection.includes("</script>"),false,"runtime secret cannot terminate an inline script");
  new vm.Script(injection);
  console.log("In-memory five-surface runtime configuration harness: passed");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
