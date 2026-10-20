#!/usr/bin/env node
/* CRM app logic only: never executes boot, JSONP or real network requests. */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const source = process.argv[2] || path.resolve(__dirname,"../../../decks-src/crm-dashboard/crm-dashboard.src.html");
const html = fs.readFileSync(source,"utf8");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
scripts.forEach(script=>new vm.Script(script));
const app = scripts.find(s=>s.includes("const CRM_V2 ="));
assert.ok(app,"CRM app script exists");
const core = app.slice(0,app.indexOf("/* static icon slots"));
const contactHeaders = ["Campaign","Contact","Priority","Goal","Owner","Status","Action","Project","Deliverable","LastConnected","LocationMet","Row","GID","ContactID","CampaignID","Type"];
const campaignHeaders = ["CampaignID","Campaign","Status","Owner","Description","Goal","Created","Archived","Sort"];
const linkHeaders = ["Timestamp","Type","LeftCampaign","LeftRow","LeftContact","RightCampaign","RightRow","RightContact","Note","By","LeftContactID","RightContactID"];
const historyHeaders = ["Timestamp","Op","Campaign","Contact","Detail","By","ContactID"];
const table = (headers, rows) => ({table:{cols:headers.map(label=>({label})),rows:rows.map(r=>({c:r.map(v=>({v}))}))}});
const sample = ["Stacks","Example Person","High","Goal","Josh","Contacted","Call","Project","","2026-10-01","Berlin","25","456","c_one","stacks",""];
const archived = ["Old campaign","Other Person","Low","Goal","Unai","Not contacted","Call","Project","","2 Apr","","30","456","c_two","old",""];
function context(v2){
  const sent = [], copied = [];
  const ctx = {console,setTimeout,clearTimeout,
    Shell:{store:{get:(_,d)=>d},toast(){},copy:t=>copied.push(t)},
    document:{},
    fetch: async (url,opts)=>{ sent.push({url,body:JSON.parse(opts.body)}); return {json:async()=>({ok:true,feedUpdated:true})}; }
  };
  vm.createContext(ctx);
  const config = {enabled:true,feedId:"feed-copy",sourceId:"source-copy",campaignsGid:"999",gids:{},writeUrl:"https://example.invalid/exec",writeToken:"synthetic-test-token"};
  vm.runInContext(v2 ? core.replace(/const CRM_V2 = .*?;/,`const CRM_V2 = ${JSON.stringify(config)};`) : core,ctx);
  const run = code=>vm.runInContext(code,ctx);
  ctx.fixture = table(contactHeaders,[sample,archived]);
  ctx.registry = table(campaignHeaders,[["stacks","Stacks","Active","Josh","","","","",1],["old","Old campaign","Archived","Unai","","","","",2],["empty","Empty campaign","Active","","","","","",3]]);
  run("state.contacts=parseContacts(fixture);state.campaigns=parseCampaigns(registry);ui.loaded=true;rebuildIndex();refreshAll=()=>{};loadLive=()=>Promise.resolve();");
  return {ctx,run,sent,copied};
}
async function main(){
  const {ctx,run,sent} = context(true);
  assert.equal(run("state.contacts[0].id"),"c_one");
  assert.equal(run("state.contacts[0].lastDate.toISOString().slice(0,10)"),"2026-10-01");
  assert.equal(run("state.contacts[1].lastDate"),null,"yearless raw dates not guessed");
  assert.equal(run("visibleContacts().length"),1);
  assert.equal(run("campaignList().length"),2,"empty active campaign appears");
  assert.equal(run("campaignList(false).some(c=>c.id==='old')"),false);
  assert.equal(run("state.includeArchived=true;visibleContacts().length"),2);
  assert.equal(run("campaignList().length"),3);
  assert.equal(run("rowLink(state.contacts[0])"),"https://docs.google.com/spreadsheets/d/source-copy/edit#gid=456&range=A25");
  ctx.bad = table(contactHeaders.slice(0,13),[sample.slice(0,13)]);
  assert.throws(()=>run("parseContacts(bad)"),/headers/);
  ctx.bad = table(contactHeaders,[[...sample.slice(0,13),"","stacks",""]]);
  assert.throws(()=>run("parseContacts(bad)"),/identity missing/);
  ctx.linkFixture=table(linkHeaders,[["now","person","Stacks","25","Example Person","Old campaign","30","Other Person","","dashboard","c_one","c_two"]]);
  run("state.links=parseLinks(linkFixture);rebuildIdentities();");
  assert.equal(run("state.contacts[0].bridged"),1,"union-find uses stable IDs");
  assert.equal(run("state.contacts[1].identityMembers.length"),2);
  ctx.historyFixture=table(historyHeaders,[["now","contact.update","Stacks","Example Person","Owner","dashboard","c_one"]]);
  assert.equal(run("parseHistory(historyFixture)[0].contactId"),"c_one");
  assert.equal(run("statusOptions(state.contacts[0]).includes('Declined')"),true);
  run("saveField(state.contacts[0],'priority','Immediate')");
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sent.at(-1).body.op,"contact.update");
  assert.equal(sent.at(-1).body.contactId,"c_one");
  assert.deepEqual(sent.at(-1).body.patch,{Priority:"Immediate"});
  assert.equal("row" in sent.at(-1).body,false,"v2 writes never send row identity");
  run("doMark(state.contacts[0])");
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sent.at(-1).body.op,"contact.mark");
  run("linkBridge('person','c_one','c_two')");
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sent.at(-1).body.leftId,"c_one");
  assert.equal(sent.at(-1).body.rightId,"c_two");
  assert.equal(sent.at(-1).body.op,"contact.link");
  run("unlinkBridge('Stacks','25','Old campaign','30','c_one','c_two','person')");
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sent.at(-1).body.op,"contact.unlink");
  assert.equal(sent.at(-1).body.type,"person");
  ctx.fetch=async()=>{throw new Error("synthetic failure");};
  run("saveField(state.contacts[0],'goal','Changed goal')");
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(run("state.contacts[0].goal"),"Goal","failed goal edit rolls back");
  const legacy = context(false);
  assert.equal(legacy.run("state.contacts[0].id"),"Stacks|25");
  legacy.run("saveField(state.contacts[0],'owner','Unai')");
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(legacy.sent.at(-1).body.op,"update");
  assert.equal(legacy.sent.at(-1).body.row,"25");
  assert.equal(legacy.run("visibleContacts().length"),2,"legacy view unaffected by registry");
  console.log("CRM dashboard legacy + consolidated logic harness: passed");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
