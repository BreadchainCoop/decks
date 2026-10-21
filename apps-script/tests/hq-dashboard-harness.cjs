#!/usr/bin/env node
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm"),assert=require("node:assert/strict");
const src=path.resolve(__dirname,"../../../decks-src/bread-hq/app.js"),app=fs.readFileSync(src,"utf8");
new vm.Script(app);
const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{id,value:"",hidden:false,disabled:false,checked:false,innerHTML:"",textContent:""});return elements.get(id);};
const requests=[];
const ctx=vm.createContext({Date,console,Shell:{sync(){},toast(){}},document:{getElementById:element},fetch:async(url,opts)=>{requests.push({url,body:JSON.parse(opts.body),method:opts.method});return {json:async()=>({ok:true,resources:[],directives:[],timeOff:[],committee:false})};}});
vm.runInContext(app.slice(0,app.indexOf("Shell.init(")),ctx);
const run=code=>vm.runInContext(code,ctx);
assert.equal(run("hq.demo"),true);
run("demoData();renderHq();");
assert.match(element("hq-connection").textContent,/LOCAL DEMO/);
assert.equal(element("resource-add").disabled,true);assert.equal(element("timeoff-add").disabled,true);
assert.match(element("hq-resources").innerHTML,/Strategic directives master document/);
assert.match(element("hq-resources").innerHTML,/Budget &amp; runway calculator/);
assert.match(element("hq-budget").innerHTML,/Live financial figures are not fetched in demo mode/);
assert.equal(run("validHqUrl('javascript:alert(1)')"),false);
assert.equal(run("escapeHq('<img onerror=alert(1)>')"),"&lt;img onerror=alert(1)&gt;");
run("hq.demo=false;hq.loaded=true;HQ_CONFIG.writeUrl='https://example.invalid/exec';HQ_CONFIG.token='synthetic-only';");
const day=new Date().toISOString().slice(0,10);
ctx.testDay=day;
run("hq.directives=[{DirectiveID:'one',Title:'Published',Body:'<script>unsafe</script>',Status:'Published',Start:testDay,End:testDay},{DirectiveID:'two',Title:'Draft',Body:'draft',Status:'Draft',Start:'',End:''}];hq.timeOff=[{TimeOffID:'t1',Person:'Synthetic member',Status:'Active',Start:testDay,End:testDay},{TimeOffID:'t2',Person:'Cancelled',Status:'Cancelled',Start:testDay,End:testDay}];renderHq();");
assert.equal(run("currentDirectives().length"),1);assert.equal(run("awayToday().length"),1);
assert.match(element("hq-current").innerHTML,/&lt;script&gt;unsafe&lt;\/script&gt;/);
assert.equal(element("hq-current").innerHTML.includes("<script>"),false);
run("hq.budget={ok:true,period:'Q3 2026 (Aug-Oct)',treasury:'$12,000.00',outstandingIncome:'$2,500.00',runway:'4.2',readAt:'2026-10-21'};renderHq();");
assert.match(element("hq-budget").innerHTML,/calculator scenario/);assert.match(element("hq-budget").innerHTML,/not verified current balances/);
assert.match(element("hq-budget").innerHTML,/Outstanding income input/);
async function main(){
  await run("hqRequest('hq.read')");assert.equal(requests[0].body.op,"hq.read");assert.equal(requests[0].method,"POST");
  assert.equal("committeeToken" in requests[0].body,false);
  await run("committeeToken='synthetic-committee';hqRequest('hq.read')");assert.equal(requests[1].body.committeeToken,"synthetic-committee");
  assert.equal(app.includes("localStorage"),true,"comments document no secret persistence");
  assert.equal(/localStorage\.(setItem|getItem)/.test(app),false,"committee secret never persisted");
  console.log("HQ dashboard demo/privacy/directives/budget harness: passed");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
