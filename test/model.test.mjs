// Behavioural locks for the Outreach Desk reducer (model.mjs).
// Zero dependencies: runs on Node 24's built-in test runner (npm test).
// These encode invariants that are easy to regress when an agent edits the reducer.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanDomain, normalizeEmail, cleanHandle, createState, perform,
  CHANNELS, MARKS, runDaily
} from '../model.mjs';

const WS='grynh2', PROJECT='wind-solar-outreach';

// Fresh state per test so mutations never leak between cases.
const fresh=()=>structuredClone(createState());
const findLead=(state,id)=>state.workspaces.find(w=>w.id===WS).projects
  .find(p=>p.id===PROJECT).leads.find(l=>l.id===id);

test('cleanDomain normalises and rejects unsafe input', ()=>{
  assert.equal(cleanDomain('https://www.Example.com/'), 'example.com');
  assert.equal(cleanDomain('sub.example.co.uk'), 'sub.example.co.uk');
  assert.equal(cleanDomain('http://user:pass@evil.com'), '', 'credentials must be rejected');
  assert.equal(cleanDomain('ftp://example.com'), '', 'non-http protocol must be rejected');
  assert.equal(cleanDomain('example'), '', 'single-label host must be rejected');
  assert.equal(cleanDomain('not a url'), '');
  assert.equal(cleanDomain(''), '');
});

test('normalizeEmail and cleanHandle validate per channel', ()=>{
  assert.equal(normalizeEmail('  CEO@Acme.COM '), 'ceo@acme.com');
  assert.equal(normalizeEmail('nope'), '');
  assert.equal(cleanHandle('Email','a@b.com'), 'a@b.com');
  assert.equal(cleanHandle('Call','+1 (555) 123-4567'), '+1 (555) 123-4567');
  assert.equal(cleanHandle('Call','12ab'), '', 'non-phone must be rejected');
  assert.equal(cleanHandle('LinkedIn','https://linkedin.com/in/jane'), 'https://linkedin.com/in/jane');
  assert.equal(cleanHandle('LinkedIn','https://evil.com/in/jane'), '', 'off-host LinkedIn must be rejected');
});

test('createState seeds the grynh2 workspace and one project', ()=>{
  const state=fresh();
  const ws=state.workspaces.find(w=>w.id===WS);
  assert.ok(ws, 'workspace present');
  assert.equal(ws.projects.length, 1);
  assert.ok(ws.projects[0].leads.length > 0, 'starter leads seeded');
});

test('lead-add inserts, rejects duplicate domain (409) and bad domain (400)', ()=>{
  const state=fresh();
  const {lead}=perform(state,'lead-add',{workspace:WS,project:PROJECT,name:'Test Co',domain:'testco.com'});
  assert.ok(lead);
  assert.equal(findLead(state,lead).domain,'testco.com');
  assert.throws(()=>perform(state,'lead-add',{workspace:WS,project:PROJECT,domain:'testco.com'}),
    e=>e.status===409, 'duplicate domain must be rejected');
  assert.throws(()=>perform(state,'lead-add',{workspace:WS,project:PROJECT,domain:'bad domain'}),
    e=>e.status===400, 'invalid domain must be rejected');
});

test('suppressed domain blocks a new lead', ()=>{
  const state=fresh();
  perform(state,'suppress',{workspace:WS,value:'blocked.com',kind:'Domain',reason:'test'});
  assert.throws(()=>perform(state,'lead-add',{workspace:WS,project:PROJECT,domain:'blocked.com'}),
    ()=>true, 'do-not-contact domain must be blocked');
});

test('a Replied mark promotes a Prospect lead to Engaged', ()=>{
  const state=fresh();
  const {lead}=perform(state,'lead-add',{workspace:WS,project:PROJECT,
    name:'Acme',domain:'acme.com',email:'boss@acme.com'});
  perform(state,'lead-mark',{workspace:WS,project:PROJECT,lead,channel:'Email',mark:'Replied'});
  assert.equal(findLead(state,lead).lifecycle,'Engaged');
});

test('erase requires confirmation and wipes personal data', ()=>{
  const state=fresh();
  const {lead}=perform(state,'lead-add',{workspace:WS,project:PROJECT,
    name:'Wiped Co',domain:'wiped.com',email:'ceo@wiped.com'});
  const l=findLead(state,lead);
  l.description='private brief';l.source='private source';l.notes=[{text:'private note'}];l.drafts={Email:{body:'private draft'}};
  l.fitReview={reviewedOn:'2026-01-01',assets:[{name:'site',site:'https://wiped.com',signals:[{label:'stage',status:'Documented',detail:'private'}]}]};
  l.jevFit={score:3,basis:'private',model:'jev-latest'};
  assert.throws(()=>perform(state,'erase',{workspace:WS,project:PROJECT,lead,confirm:'nope'}),
    ()=>true, 'erase must require the ERASE token');
  perform(state,'erase',{workspace:WS,project:PROJECT,lead,confirm:'ERASE'});
  assert.equal(l.contacts.length,0);
  assert.deepEqual(l.channels,{});
  assert.deepEqual(l.notes,[]);assert.deepEqual(l.drafts,{});
  assert.equal(l.description,'');assert.equal(l.source,'');
  assert.equal(l.fitReview,undefined);assert.equal(l.jevFit,undefined);
  assert.equal(l.notFit,true);
  assert.ok(l.erasedAt);
});

test('worklist top-up is idempotent for the same day', ()=>{
  const state=fresh();
  const project=state.workspaces.find(w=>w.id===WS).projects.find(p=>p.id===PROJECT);
  const before=project.assignments.length;
  perform(state,'worklist',{workspace:WS,project:PROJECT,replace:false});
  const after=project.assignments.length;
  assert.equal(after,before,'re-topping-up the same day must not duplicate assignments');
});

test('worklist enforces channel caps, suppressions and recent-touch cooldowns',()=>{
 const state=fresh(),ws=state.workspaces[0],project=ws.projects[0];
 project.assignments=[];
 for(const channel of CHANNELS)project.configs[channel].enabled=channel==='LinkedIn';
 project.configs.LinkedIn.cap=1;
 const blocked=project.leads.find(l=>l.contacts.some(c=>c.linkedin));
 const blockedHandle=blocked.contacts.find(c=>c.linkedin).linkedin;
 perform(state,'suppress',{workspace:WS,kind:'LinkedIn',value:blockedHandle,reason:'test'});
 perform(state,'worklist',{workspace:WS,project:PROJECT,replace:true});
 const freshRows=project.assignments.filter(a=>a.day===project.assignments[0]?.day);
 assert.ok(freshRows.length<=1,'the channel cap must be enforced');
 assert.equal(freshRows.some(a=>a.leadId===blocked.id),false,'suppressed handles must not be assigned');

 project.assignments=[];
 const cooled=project.leads.find(l=>l.contacts.some(c=>c.linkedin&&!isSuppressedForTest(ws,c.linkedin)));
 const cooledHandle=cooled.contacts.find(c=>c.linkedin&&!isSuppressedForTest(ws,c.linkedin)).linkedin;
 project.assignments.push({id:'old-touch',leadId:cooled.id,day:'2000-01-01',channel:'LinkedIn',handle:cooledHandle,person:cooled.name,mailbox:'',marks:['Attempted'],at:new Date().toISOString(),assignee:''});
 perform(state,'worklist',{workspace:WS,project:PROJECT,replace:true});
 assert.equal(project.assignments.filter(a=>a.leadId===cooled.id&&a.id!=='old-touch').length,0,'recent attempted touches must respect cooldown');
});

function isSuppressedForTest(ws,value){return ws.suppressions.some(x=>!x.removedAt&&x.kind==='LinkedIn'&&x.value===value);}

test('fixed quotas distribute generated assignments across eligible agents',()=>{
 const state=fresh(),ws=state.workspaces[0],project=ws.projects[0];
 project.assignments=[];
 for(const channel of CHANNELS)project.configs[channel].enabled=channel==='LinkedIn';
 project.configs.LinkedIn.cap=2;
 perform(state,'invite',{workspace:WS,email:'agent@example.com',role:'Agent'});
 const agent=ws.members.find(m=>m.email==='agent@example.com');
 perform(state,'member-status',{workspace:WS,member:agent.id,status:'Active'});
 perform(state,'agents',{workspace:WS,project:PROJECT,agents:['owner',agent.id],autoAssign:true,split:'Fixed quotas',quotas:{owner:{LinkedIn:1},[agent.id]:{LinkedIn:1}}});
 perform(state,'worklist',{workspace:WS,project:PROJECT,replace:true});
 const rows=project.assignments.filter(a=>a.channel==='LinkedIn');
 assert.equal(rows.length,2);
 assert.deepEqual(new Set(rows.map(a=>a.assignee)),new Set(['owner',agent.id]));
});

test('daily generation waits until 06:00 in the workspace timezone',()=>{
 const state=fresh(),project=state.workspaces[0].projects[0];
 project.assignments=[];project.lastGeneratedDay=null;
 for(const channel of CHANNELS)project.configs[channel].enabled=channel==='LinkedIn';
 const RealDate=Date;
 const at=iso=>class extends RealDate{
   constructor(...args){super(...(args.length?args:[iso]));}
   static now(){return new RealDate(iso).getTime();}
 };
 try{
  globalThis.Date=at('2026-01-01T01:00:00.000Z');
  assert.equal(runDaily(state),false);assert.equal(project.lastGeneratedDay,null);assert.equal(project.assignments.length,0);
  globalThis.Date=at('2026-01-01T02:00:00.000Z');
  assert.equal(runDaily(state),true);assert.ok(project.lastGeneratedDay);assert.ok(project.assignments.length>0);
 }finally{globalThis.Date=RealDate;}
});

test('import preview and import count duplicate domains consistently',()=>{
 const state=fresh(),rows=[{name:'Duplicate One',domain:'duplicate.example'},{name:'Duplicate Two',domain:'duplicate.example'}];
 const preview=perform(state,'import-preview',{workspace:WS,project:PROJECT,rows});
 assert.equal(preview.added,1);assert.equal(preview.duplicates,1);assert.deepEqual(preview.rows.map(r=>r.status),['added','duplicate']);
 const result=perform(state,'import',{workspace:WS,project:PROJECT,rows});
 assert.equal(result.added,1);assert.equal(result.duplicates,1);
 assert.equal(state.workspaces[0].projects[0].leads.filter(l=>l.domain==='duplicate.example').length,1);
});

test('audit records the reducer action and project history entry',()=>{
 const state=fresh(),ws=state.workspaces[0],project=ws.projects[0];
 const beforeAudit=ws.audit.length,beforeHistory=project.history.length;
 perform(state,'lead-add',{workspace:WS,project:PROJECT,name:'Audited Co',domain:'audited.example'});
 assert.equal(ws.audit.length,beforeAudit+1);
 assert.equal(project.history.length,beforeHistory+1);
 assert.equal(ws.audit[0].type,'Lead added');
 assert.equal(project.history[0].type,'Lead added');
});

test('channel and mark vocabularies are stable', ()=>{
  assert.deepEqual(CHANNELS,['Call','Email','Instagram','LinkedIn','SMS','WhatsApp']);
  assert.deepEqual(MARKS,['Attempted','Replied','Opt-out','Bounce','Invalid handle']);
});
