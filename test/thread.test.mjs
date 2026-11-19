// Behavioural locks for the Thread reducer (model.mjs) — app-internal conversations.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createState,perform} from '../model.mjs';

const WS='grynh2';
const fresh=()=>structuredClone(createState());
const wsOf=s=>s.workspaces.find(w=>w.id===WS);
const thread=(s,id)=>wsOf(s).threads.find(t=>t.id===id);

test('createState seeds lead-linked threads without external mail sync', ()=>{
  const s=fresh(),ws=wsOf(s);
  assert.ok(Array.isArray(ws.threads)&&ws.threads.length>0,'threads seeded');
  const inbox=ws.threads.filter(t=>t.folder==='inbox');
  assert.ok(inbox.some(t=>t.unread),'at least one unread inbox conversation');
  assert.ok(inbox.some(t=>t.leadId),'at least one conversation is linked to a real lead');
  const linked=inbox.find(t=>t.leadId);
  const lead=ws.projects.flatMap(p=>p.leads).find(l=>l.id===linked.leadId);
  assert.ok(lead,'linked lead exists in the project');
});

test('reply-all excludes self and targets the original sender', ()=>{
  const s=fresh(),ws=wsOf(s);
  const t=ws.threads.find(x=>x.folder==='inbox'&&x.messages.some(m=>m.direction==='in'));
  const inbound=t.messages.filter(m=>m.direction==='in').at(-1);
  const before=t.messages.length;
  perform(s,'thread-reply-all',{workspace:WS,threadId:t.id,messageId:inbound.id,bodyHtml:'<p>Thanks — 1.2 GW across DK/SE/NO.</p><script>steal()</script>'});
  const reply=thread(s,t.id).messages.at(-1);
  assert.equal(thread(s,t.id).messages.length,before+1,'one message appended to the same thread');
  assert.equal(reply.direction,'out');
  assert.ok(reply.to.some(p=>p.email===inbound.from.email),'reply goes to the sender');
  assert.ok(!reply.to.some(p=>String(p.email).toLowerCase()===''),'self (no email) is not a recipient');
  assert.ok(!/script/i.test(reply.bodyHtml),'body is sanitized on save');
  assert.ok(!/script/i.test(reply.bodyText),'plain text is sanitized too');
  assert.equal(thread(s,t.id).unread,false,'answering marks the thread read');
});

test('reply (single) sends only to the original sender', ()=>{
  const s=fresh(),ws=wsOf(s);
  const t=ws.threads.find(x=>x.folder==='inbox'&&x.messages.some(m=>m.direction==='in'));
  const inbound=t.messages.filter(m=>m.direction==='in').at(-1);
  perform(s,'thread-reply',{workspace:WS,threadId:t.id,messageId:inbound.id,bodyHtml:'<p>Noted.</p>'});
  const reply=thread(s,t.id).messages.at(-1);
  assert.deepEqual(reply.to.map(p=>p.email),[inbound.from.email]);
  assert.deepEqual(reply.cc,[]);
});

test('forward creates a new sent thread that quotes the original', ()=>{
  const s=fresh(),ws=wsOf(s);
  const t=ws.threads[0];
  const out=perform(s,'thread-forward',{workspace:WS,threadId:t.id,messageId:t.messages.at(-1).id,to:['colleague@vitalise.io'],bodyHtml:'<p>Sharing for visibility.</p>'});
  const fwd=thread(s,out.thread);
  assert.equal(fwd.folder,'sent');
  assert.match(fwd.subject,/^Fwd: /);
  assert.ok(/blockquote/.test(fwd.messages[0].bodyHtml),'quoted original included');
  assert.deepEqual(fwd.messages[0].to.map(p=>p.email),['colleague@vitalise.io']);
});

test('send requires a recipient and lands in Sent', ()=>{
  const s=fresh();
  assert.throws(()=>perform(s,'thread-send',{workspace:WS,subject:'x',to:[],bodyHtml:'y'}),/recipient/i);
  const out=perform(s,'thread-send',{workspace:WS,subject:'Hello there',to:['new@acme.com'],bodyHtml:'<b>Hi</b>'});
  const t=thread(s,out.thread);
  assert.equal(t.folder,'sent');
  assert.equal(t.messages[0].bodyHtml,'<b>Hi</b>');
});

test('folders, star, read and labels update the thread', ()=>{
  const s=fresh(),ws=wsOf(s);
  const id=ws.threads[0].id;
  perform(s,'thread-move',{workspace:WS,threadId:id,folder:'archive'});
  perform(s,'thread-star',{workspace:WS,threadId:id,starred:true});
  perform(s,'thread-read',{workspace:WS,threadId:id,unread:true});
  perform(s,'thread-label',{workspace:WS,threadId:id,labels:['Nordic','hot','hot']});
  const t=thread(s,id);
  assert.equal(t.folder,'archive');
  assert.equal(t.starred,true);
  assert.equal(t.unread,true);
  assert.deepEqual(t.labels,['Nordic','hot'],'labels deduped');
});

test('receive logs an inbound reply and marks unread', ()=>{
  const s=fresh(),ws=wsOf(s);
  const t=ws.threads.find(x=>x.folder!=='drafts');
  const sender=t.participants.find(p=>p.email)||{name:'Them',email:'them@example.com'};
  perform(s,'thread-receive',{workspace:WS,threadId:t.id,from:sender,bodyHtml:'<p>We are interested.</p>'});
  const updated=thread(s,t.id);
  assert.equal(updated.messages.at(-1).direction,'in');
  assert.equal(updated.unread,true);
});

test('draft save then send reuses the same thread', ()=>{
  const s=fresh();
  const draft=perform(s,'thread-save-draft',{workspace:WS,subject:'WIP',to:['a@acme.com'],bodyHtml:'<p>half-written</p>'});
  assert.equal(thread(s,draft.thread).folder,'drafts');
  const sent=perform(s,'thread-send',{workspace:WS,threadId:draft.thread,subject:'WIP',to:['a@acme.com'],bodyHtml:'<p>finished</p>'});
  assert.equal(sent.thread,draft.thread,'same thread id reused');
  const t=thread(s,draft.thread);
  assert.equal(t.folder,'sent');
  assert.equal(t.messages.at(-1).bodyHtml,'<p>finished</p>');
});

test('unknown thread id is rejected', ()=>{
  const s=fresh();
  assert.throws(()=>perform(s,'thread-read',{workspace:WS,threadId:'nope',unread:true}),/unavailable/i);
});

test('erasing a lead purges its linked conversations', ()=>{
  const s=fresh(),ws=wsOf(s);
  const linked=ws.threads.find(t=>t.leadId);
  assert.ok(linked,'a lead-linked thread exists');
  const project=ws.projects.find(p=>p.leads.some(l=>l.id===linked.leadId));
  perform(s,'erase',{workspace:WS,project:project.id,lead:linked.leadId,confirm:'ERASE'});
  assert.ok(!thread(s,linked.id),'thread removed when its lead is erased');
});

test('thread-ingest bounds stored threads so the document cannot grow without limit', ()=>{
  const s=fresh(),ws=wsOf(s);
  // Each ingest is capped at 100 messages by the reducer, so drive it over many rounds
  // to exceed the ceiling and confirm pruning kicks in.
  for(let round=0;round<25;round++){
    const messages=Array.from({length:100},(_,i)=>{const k=round*100+i;return {from:`x${k}@e.com`,to:'me@vitalise.io',subject:`m${k}`,html:'<p>body</p>',messageId:`<${k}@e.com>`,uid:k};});
    perform(s,'thread-ingest',{workspace:WS,messages});
  }
  assert.ok(ws.threads.length<=2000,`thread count is capped (got ${ws.threads.length})`);
  assert.ok(ws.threads.some(t=>t.folder==='sent'),'user-owned sent thread survives the prune');
  assert.ok(ws.threads.some(t=>t.starred),'starred thread survives the prune');
});
