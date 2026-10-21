#!/usr/bin/env node
/* Local, synthetic-only browser preview. No Sheets reads or real writes.
 * node apps-script/tests/crm-preview-server.cjs   -> http://127.0.0.1:8766
 */
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const source = path.resolve(__dirname,"../../../decks-src/crm-dashboard/crm-dashboard.src.html");
const config = {enabled:true,feedId:"synthetic-feed",sourceId:"synthetic-source",campaignsGid:"campaigns",gids:{},writeUrl:"https://example.invalid/exec",writeToken:"synthetic-only"};
const fixtures = {
  contacts: {headers:["Campaign","Contact","Priority","Goal","Owner","Status","Action","Project","Deliverable","LastConnected","LocationMet","Row","GID","ContactID","CampaignID","Type"],rows:[
    ["Stacks","Synthetic Person / Coop","High","Meet the team","Josh","Contacted","Follow up","Stacks","","2026-09-01","Berlin","2","456","c_preview1","stacks",""],
    ["Stacks","Synthetic Partner","Low","Partner intro","Unai","Not contacted","Reach out","Stacks","","ongoing","","3","456","c_preview2","stacks",""],
    ["Past event","Archived Person","High","Retained contact","Josh","Blocked","Check in","","","2025-02-24","","4","456","c_archived","past","" ]
  ]},
  campaigns: {headers:["CampaignID","Campaign","Status","Owner","Description","Goal","Created","Archived","Sort"],rows:[
    ["stacks","Stacks","Active","Josh","Partner outreach","Meet","","",1],
    ["empty","Empty campaign","Active","Unai","No contacts yet","","","",2],
    ["past","Past event","Archived","Josh","Past event","","","",3]
  ]},
  links:{headers:["Timestamp","Type","LeftCampaign","LeftRow","LeftContact","RightCampaign","RightRow","RightContact","Note","By","LeftContactID","RightContactID"],rows:[]},
  history:{headers:["Timestamp","Op","Campaign","Contact","Detail","By","ContactID"],rows:[]}
};
const injection = `
const PREVIEW = ${JSON.stringify(fixtures)};
gviz = async gid => {
  const name = gid === GID_CONTACTS ? "contacts" : gid === GID_LINKS ? "links" : gid === GID_HISTORY ? "history" : gid === "campaigns" ? "campaigns" : "other";
  const t = PREVIEW[name] || {headers:[],rows:[]};
  return {table:{cols:t.headers.map(label=>({label})),rows:t.rows.map(row=>({c:row.map(v=>({v}))}))}};
};
window.fetch = async (url, options) => {
  if(url !== "https://example.invalid/exec") throw new Error("Preview blocks network writes");
  const body = JSON.parse(options.body), result = {ok:true,feedUpdated:true};
  if(body.op === "campaign.create") {
    result.campaignId = "preview-"+PREVIEW.campaigns.rows.length;
    PREVIEW.campaigns.rows.push([result.campaignId,body.name,"Active",body.owner,body.description,body.goal,"","",PREVIEW.campaigns.rows.length+1]);
  } else if(body.op === "campaign.archive" || body.op === "campaign.restore") {
    const c = PREVIEW.campaigns.rows.find(r=>r[0] === body.campaignId);
    c[2] = body.op === "campaign.archive" ? "Archived" : "Active";
  }
  return {json:async()=>result};
};
`;
http.createServer((req,res)=>{
  if(req.url !== "/") { res.writeHead(404);res.end();return; }
  const html = fs.readFileSync(source,"utf8")
    .replace(/const CRM_V2 = .*?;/,`const CRM_V2 = ${JSON.stringify(config)};`)
    .replace("/* ===== boot ===== */",injection+"\n/* ===== boot ===== */");
  res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
  res.end(html);
}).listen(8766,"127.0.0.1",()=>console.log("Synthetic CRM preview: http://127.0.0.1:8766 (no real Sheets/network writes)"));
