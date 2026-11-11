import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {jevInput,scoreWithJev} from './jev.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const db=new DatabaseSync(join(root,'data','outreach.sqlite'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
const get=db.prepare('SELECT revision,document FROM workspace_state WHERE id=1');
const current=get.get();
if(!current)throw Error('Outreach Desk state is unavailable.');
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
 const update=db.prepare('UPDATE workspace_state SET revision=?,document=? WHERE id=1 AND revision=?');
 if(update.run(state.revision,JSON.stringify(state),current.revision).changes!==1)throw Error('The workspace changed during JEV scoring; no update was committed.');
}
console.log(JSON.stringify({scored:results.length,errors:errors.length,total:project.leads.length,results,errors},null,2));
