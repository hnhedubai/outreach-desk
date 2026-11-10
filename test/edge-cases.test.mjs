// Edge-case locks for the boundaries most likely to drift: Jev tier/rounding thresholds
// and model validation/dedup/state-clearing. Node 24 built-in runner; no dependencies.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanDomain, createState, perform} from '../model.mjs';
import {jevInput, scoreWithJev} from '../jev.mjs';

const WS='grynh2', PROJECT='wind-solar-outreach';
const fresh=()=>structuredClone(createState());
const findLead=(state,id)=>state.workspaces.find(w=>w.id===WS).projects
  .find(p=>p.id===PROJECT).leads.find(l=>l.id===id);

// ---------- Jev: tier + rounding boundaries ----------
const realFetch=globalThis.fetch, realKey=process.env.TYPESAFE_API_KEY;
const componentAnswers=(values,noul)=>({
  scaleGeography:{type:'score',score:values[0]},
  developmentStage:{type:'score',score:values[1]},
  permitsOfftake:{type:'score',score:values[2]},
  bankabilityCapitalNeed:{type:'score',score:values[3]},
  seekingInvestment:{type:'noul',noul}
});
const stageReview=stage=>({assets:[{name:'S',site:'Norway',signals:[{label:'Development stage',status:'Documented',detail:stage}]}]});
function jevFixture(overrides={}){
  const project={id:'p',name:'Nordic H2',targeting:{offer:'10-20 MW Nordic green hydrogen.',ideal:'Developers seeking a partner.',signals:[]}};
  const lead={id:'l',name:'Fjord H2',domain:'fjordh2.example',country:'Norway',category:'Green hydrogen',
    description:'15 MW pre-FID.',fitReview:overrides.fitReview};
  return {project,lead};
}
async function withScore(body,run){
  process.env.TYPESAFE_API_KEY='test-key';
  globalThis.fetch=async()=>({ok:body.__ok!==false,status:body.__status||200,json:async()=>body.body});
  try{return await run();}finally{globalThis.fetch=realFetch;process.env.TYPESAFE_API_KEY=realKey;}
}

test('Jev: component sum hits the exact 0 and 4 extremes',async()=>{
  const lo=jevFixture(), hi=jevFixture();
  const zero=await withScore({body:{model:'jev-latest',answers:componentAnswers([0,0,0,0],0.2)}},()=>scoreWithJev(jevInput(lo.project,lo.lead)));
  assert.equal(zero.score,0); assert.equal(zero.tier,'Watch');
  const full=await withScore({body:{model:'jev-latest',answers:componentAnswers([1,1,1,1],0.6)}},()=>scoreWithJev(jevInput(hi.project,hi.lead)));
  assert.equal(full.score,4); assert.equal(full.tier,'Strong');
});

test('Jev: FitScore boundary at 2.5 is Strong, 2.49 is Partial',async()=>{
  const strong=await withScore({body:{model:'jev-latest',answers:componentAnswers([1,0.5,1,0],0.6)}},()=>scoreWithJev(jevInput(...Object.values(jevFixture()))));
  assert.equal(strong.score,2.5); assert.equal(strong.tier,'Strong');
  const partial=await withScore({body:{model:'jev-latest',answers:componentAnswers([1,0.5,0.99,0],0.6)}},()=>scoreWithJev(jevInput(...Object.values(jevFixture()))));
  assert.equal(partial.score,2.49); assert.equal(partial.tier,'Partial');
});

test('Jev: seek-investment boundary at 0.6 includes Strong, 0.55 falls to Watch',async()=>{
  const at=await withScore({body:{model:'jev-latest',answers:componentAnswers([1,1,0.5,0.5],0.6)}},()=>scoreWithJev(jevInput(...Object.values(jevFixture()))));
  assert.equal(at.tier,'Strong');
  const dead=await withScore({body:{model:'jev-latest',answers:componentAnswers([1,1,0.5,0.5],0.55)}},()=>scoreWithJev(jevInput(...Object.values(jevFixture()))));
  assert.equal(dead.seekingInvestment,0.55); assert.equal(dead.tier,'Watch');
});

test('Jev: Funded fires at the seek<=0.5 edge only with a structured funded stage',async()=>{
  const {project,lead}=jevFixture({fitReview:stageReview('operating')});
  const fit=await withScore({body:{model:'jev-latest',answers:componentAnswers([1,1,1,1],0.5)}},()=>scoreWithJev(jevInput(project,lead)));
  assert.equal(fit.seekingInvestment,0.5); assert.equal(fit.tier,'Funded');
});

test('Jev: out-of-range component is rejected, not clamped',async ()=>{
  await assert.rejects(
    withScore({body:{model:'jev-latest',answers:componentAnswers([1,1.2,0,0],0.8)}},()=>scoreWithJev(jevInput(...Object.values(jevFixture())))),
    e=>e.status===502);
});

test('Jev: a batch/array payload is rejected outright',async()=>{
  await assert.rejects(scoreWithJev({leads:[{id:'a'},{id:'b'}]}), e=>e.status===400);
  await assert.rejects(scoreWithJev({records:[]}), e=>e.status===400);
});

// ---------- Model: validation, dedup, state-clearing ----------
test('cleanDomain edge cases: ports, trailing dot, uppercase, credentials, length',()=>{
  assert.equal(cleanDomain('https://example.com:8080/path'), 'example.com');
  assert.equal(cleanDomain('EXAMPLE.com.'), 'example.com');
  assert.equal(cleanDomain('https://user@x.com'), '');
  assert.equal(cleanDomain('https://exämple.com').length > 0, true, 'IDN should normalise to punycode');
  assert.equal(cleanDomain('https://' + 'a'.repeat(63) + '.'.repeat(1) + 'b'.repeat(63) + '.c'.repeat(63) + '.d'.repeat(63) + '.e'.repeat(63) + '.com'), '', 'over-long host rejected');
});

test('domain suppression is de-duplicated (added only once)',()=>{
  const state=fresh();
  const first=perform(state,'suppress',{workspace:WS,value:'dup.com',kind:'Domain',reason:'x'});
  const second=perform(state,'suppress',{workspace:WS,value:'dup.com',kind:'Domain',reason:'x'});
  assert.equal(first.added,true);
  assert.equal(second.added,false);
});

test('changing a lead domain clears its stale Jev fit',()=>{
  const state=fresh();
  const {lead}=perform(state,'lead-add',{workspace:WS,project:PROJECT,name:'Edge Co',domain:'edge-a.com'});
  const l=findLead(state,lead);
  l.jevFit={score:3,basis:'stale',model:'jev-latest'};
  perform(state,'lead-edit',{workspace:WS,project:PROJECT,lead,name:'Edge Co',domain:'edge-b.com'});
  assert.equal(findLead(state,lead).jevFit,undefined,'fit must be dropped when the domain changes');
});

test('an invalid lifecycle value is ignored, not applied',()=>{
  const state=fresh();
  const {lead}=perform(state,'lead-add',{workspace:WS,project:PROJECT,name:'LC Co',domain:'lc.com'});
  perform(state,'lifecycle',{workspace:WS,project:PROJECT,lead,value:'NotAState'});
  assert.equal(findLead(state,lead).lifecycle,'Prospect');
});
