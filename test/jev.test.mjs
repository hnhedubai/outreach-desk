// Behavioural locks for Jev scoring (jev.mjs) and Jev_Scoring_Logic.md.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {jevInput,currentJevFit,scoreWithJev} from '../jev.mjs';

const realFetch=globalThis.fetch;
const realKey=process.env.TYPESAFE_API_KEY;

function fixture(overrides={}){
 const project={
  id:'p',name:'Nordic H2',
  targeting:{offer:'Partnership for 10-20 MW Nordic green hydrogen.',
   ideal:'Developers seeking a partner.',signals:[{text:'pre-FID',weight:10}]}
 };
 const lead={
  id:'l',name:'Fjord H2',domain:'fjordh2.example',country:'Norway',
  category:'Green hydrogen',description:overrides.description??'15 MW pre-FID project.',
  fitReview:overrides.fitReview
 };
 return {project,lead};
}

const componentAnswers=(values=[0.5,0.5,0.5,0.5],noul=0.8)=>({
 scaleGeography:{type:'score',score:values[0]},
 developmentStage:{type:'score',score:values[1]},
 permitsOfftake:{type:'score',score:values[2]},
 bankabilityCapitalNeed:{type:'score',score:values[3]},
 seekingInvestment:{type:'noul',noul}
});
const stageReview=stage=>({assets:[{name:'Fjord H2',site:'Norway',signals:[{label:'Development stage',status:'Documented',detail:stage}]}]});

async function withScore(body,run){
 process.env.TYPESAFE_API_KEY='test-key';
 globalThis.fetch=async()=>({ok:body.__ok!==false,status:body.__status||200,json:async()=>body.body});
 try{return await run();}finally{globalThis.fetch=realFetch;process.env.TYPESAFE_API_KEY=realKey;}
}

test('jevInput builds a stable basis hash from the inputs',()=>{
 const {project,lead}=fixture();
 const a=jevInput(project,lead),b=jevInput(project,structuredClone(lead));
 assert.equal(a.basis,b.basis);
 lead.description='Changed evidence.';
 assert.notEqual(jevInput(project,lead).basis,a.basis);
});

test('jevInput redacts emails from evidence before it leaves the app',()=>{
 const {project,lead}=fixture({description:'Reach ceo@fjordh2.example for the round.'});
 const json=JSON.stringify(jevInput(project,lead).request);
 assert.ok(json.includes('[email removed]'));
 assert.ok(!json.includes('ceo@fjordh2.example'));
});

test('currentJevFit is false until a matching-basis score exists',()=>{
 const {project,lead}=fixture();
 assert.equal(currentJevFit(project,lead),false);
 lead.jevFit={basis:jevInput(project,lead).basis,score:3};
 assert.equal(currentJevFit(project,lead),true);
 lead.description='Evidence changed.';
 assert.equal(currentJevFit(project,lead),false);
});

test('FitScore equals the rounded sum of C1 through C4',async()=>{
 const {project,lead}=fixture();
 const fit=await withScore({body:{model:'jev-latest',answers:componentAnswers([1,0.5,0,0.1],0.8)}},
  ()=>scoreWithJev(jevInput(project,lead)));
 assert.deepEqual(fit.components,{
  scaleGeography:1,developmentStage:0.5,permitsOfftake:0,bankabilityCapitalNeed:0.1
 });
 assert.equal(fit.score,1.6);
});

test('Funded requires seek <= 0.5 and structured stage in the funded set',async()=>{
 for(const stage of ['operating','FID-taken','fully-financed']){
  const {project,lead}=fixture({fitReview:stageReview(stage)});
  const fit=await withScore({body:{model:'jev-latest',answers:componentAnswers([0.5,0.5,0.5,0.5],0.4)}},
   ()=>scoreWithJev(jevInput(project,lead)));
  assert.equal(fit.tier,'Funded',stage);
 }
});

test('Construction and financing-toward-FID text do not create Funded stage',async()=>{
 for(const description of ['15 MW pre-FID project; construction planning mentioned.','15 MW pre-FID project; seeking financing toward FID.']){
  const {project,lead}=fixture({description,fitReview:stageReview('pre-FID')});
  const fit=await withScore({body:{model:'jev-latest',answers:componentAnswers([1,1,1,1],0.4)}},
   ()=>scoreWithJev(jevInput(project,lead)));
  assert.notEqual(fit.tier,'Funded',description);
 }
});

test('tier thresholds match the specification',async()=>{
 const cases=[
  {values:[1,1,0.5,0.5],noul:0.8,want:'Strong'},
  {values:[0.5,0.5,0.5,0.5],noul:0.7,want:'Partial'},
  {values:[0.5,0.5,0.5,0.5],noul:0.2,want:'Watch'}
 ];
 for(const c of cases){
  const {project,lead}=fixture();
  const fit=await withScore({body:{model:'jev-latest',answers:componentAnswers(c.values,c.noul)}},
   ()=>scoreWithJev(jevInput(project,lead)));
  assert.equal(fit.tier,c.want);
 }
});

test('an invalid or missing component is rejected',async()=>{
 const {project,lead}=fixture();
 const answers=componentAnswers();
 delete answers.permitsOfftake;
 await assert.rejects(
  withScore({body:{model:'jev-latest',answers}},()=>scoreWithJev(jevInput(project,lead))),
  e=>e.status===502
 );
});

test('a transport failure surfaces as an error, not a low score',async()=>{
 const {project,lead}=fixture();
 await assert.rejects(
  withScore({__ok:false,__status:500,body:{}},()=>scoreWithJev(jevInput(project,lead))),
  e=>e.status===502
 );
});
