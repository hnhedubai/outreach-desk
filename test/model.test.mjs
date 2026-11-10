// Behavioural locks for the Outreach Desk reducer (model.mjs).
// Zero dependencies: runs on Node 24's built-in test runner (npm test).
// These encode invariants that are easy to regress when an agent edits the reducer.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanDomain, normalizeEmail, cleanHandle, createState, perform,
  CHANNELS, MARKS
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
  assert.throws(()=>perform(state,'erase',{workspace:WS,project:PROJECT,lead,confirm:'nope'}),
    ()=>true, 'erase must require the ERASE token');
  perform(state,'erase',{workspace:WS,project:PROJECT,lead,confirm:'ERASE'});
  const l=findLead(state,lead);
  assert.equal(l.contacts.length,0);
  assert.deepEqual(l.channels,{});
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

test('channel and mark vocabularies are stable', ()=>{
  assert.deepEqual(CHANNELS,['Call','Email','Instagram','LinkedIn','SMS','WhatsApp']);
  assert.deepEqual(MARKS,['Attempted','Replied','Opt-out','Bounce','Invalid handle']);
});
