#!/usr/bin/env node
const {spawnSync}=require("node:child_process"),path=require("node:path");
const backend=["automation-harness.cjs","crm-migration-harness.cjs","suite-harness.cjs","suite-jobs-harness.cjs"];
const frontend=["crm-dashboard-harness.cjs","hq-dashboard-harness.cjs","runtime-config-harness.cjs"];
const files=process.argv.includes("--backend-only")?backend:backend.concat(frontend);
for(const name of files){
  const result=spawnSync(process.execPath,[path.join(__dirname,name)],{stdio:"inherit"});
  if(result.status!==0)process.exit(result.status||1);
}
console.log("All "+files.length+" selected harnesses passed"+(process.argv.includes("--backend-only")?" (frontend checks explicitly excluded)":""));
