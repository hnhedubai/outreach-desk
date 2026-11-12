import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openStore} from './db.mjs';
import {jevInput,scoreWithJev} from './jev.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const store=await openStore({dataDir:join(root,'data')});
const current=await store.getState();
if(!current)throw Error('Vitalise state is unavailable.');
const state={...JSON.parse(current.document),revision:current.revision};
const ws=state.workspaces.find(x=>x.id==='grynh2');
const project=ws?.projects.find(x=>x.name==='Nordic Hydrogen Production (10–20 MW)');
if(!ws||!project)throw Error('Nordic Hydrogen Production project is unavailable.');
const results=[],errors=[];
for(const lead of project.leads){
 try{
  const result=await scoreWithJev(jevInput(project,lead));
  lead.jevFit={...result,procedure:'Jev_Scoring_Logic.md'};
  results.push({name:lead.name,score:result.score,seekingInvestment:result.seekingInvestment,tier:result.tier});
  console.log(JSON.stringify({name:lead.name,score:result.score,seekingInvestment:result.seekingInvestment,tier:result.tier}));
 }catch(error){
  errors.push({name:lead.name,error:error.message});
  console.error(JSON.stringify({name:lead.name,error:error.message}));
 }
}
if(results.length){
 state.revision++;
 if(!(await store.save(state.revision,JSON.stringify(state),current.revision)))throw Error('The workspace changed during JEV scoring; no update was committed.');
}
await store.close();
console.log(JSON.stringify({scored:results.length,errors:errors.length,total:project.leads.length,results,errors},null,2));
