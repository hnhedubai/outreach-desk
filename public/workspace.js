import {e,go,link,btn,header,card,empty,table,tr,blankRow,form,field,area,check,select,tabs,stat,bar,note,date,day,money,todayRows,icon,initialOf,glyphStyle,verifyBadge} from './ui.js';
const settingsTabs=[['General','settings'],['Team','team'],['Do-not-contact','dnc'],['Usage & limits','usage'],['Audit export','audit']];
const zones=['Asia/Dubai','Europe/London','Europe/Madrid','Europe/Warsaw','Europe/Berlin','America/New_York','America/Chicago','America/Los_Angeles','Asia/Singapore','Africa/Nairobi','UTC'];
const zoneField=current=>'<label>Time zone'+select('timezone',[...new Set([current,...zones])],current)+'</label>';
const memberAvatar=m=>'<span class="avatar"><span class="glyph" style="'+glyphStyle(initialOf(m.name))+'">'+e(initialOf(m.name))+'</span></span>';
function onboardingHome(ws){
 const projectDone=ws.projects.length>0, leadsDone=ws.projects.some(p=>p.leads.length>0), teamDone=ws.members.length>1;
 const steps=[
  {label:'Create workspace',sub:'Name, URL and settings',done:true},
  {label:'Create your first project',sub:'Who you sell to, and where',done:projectDone,href:go('new')},
  {label:'Import leads',sub:'CSV or paste a list',done:leadsDone,href:projectDone?go('import',ws.projects[0].id):null},
  {label:'Invite your team',sub:'Assign leads to agents',done:teamDone,href:go('team')}
 ];
 const doneCount=steps.filter(s=>s.done).length, current=steps.findIndex(s=>!s.done);
 const checklist='<div class="onboard-checklist"><div class="onboard-checklist-head"><strong>Get started</strong><span class="count muted">'+doneCount+'/4</span></div><ol class="onboard-steps">'+
  steps.map((s,i)=>'<li class="'+(s.done?'done':i===current?'current':'')+'">'+(s.done?'<span class="onboard-ck ok">'+icon('check')+'</span>':'<span class="onboard-ck">'+(i+1)+'</span>')+
   '<div class="onboard-step-text"><strong>'+e(s.label)+'</strong><small class="muted">'+e(s.sub)+'</small></div>'+
   (s.done?'<span class="onboard-step-tag">Done</span>':(i===current&&s.href?'<a class="onboard-step-cta" href="'+e(s.href)+'">Continue →</a>':''))+
  '</li>').join('')+'</ol></div>';
 const chooser='<div class="onboard-chooser">'+
  card('No — find leads for me','<p>Describe the companies you want and review the results before anything runs.</p><div class="row-gap">'+btn('Start searching →','onboard-start','primary',{'data-value':'find'})+'</div>')+
  card('Yes — I have a list','<p>Create the project, then upload an Excel or CSV file or paste domains.</p><div class="row-gap">'+btn('Create project →','onboard-start','',{'data-value':'import'})+'</div>')+'</div>';
 return header('Welcome to '+e(ws.name),'Either path creates a project with its own list, targeting and channels.',link('+ Create first project',go('new'),'btn primary'))+
  '<div class="onboard-grid">'+checklist+'<div class="onboard-main"><h2 class="onboard-q">Do you already have leads?</h2><p class="onboard-intro">Either way you end up with a project: what you offer, who it’s for, and a list we turn into who to contact today — per channel, per person.</p>'+chooser+'</div></div>';
}
export function threadTopnav(ui){
 const view=ui.threadView||'inbox';
 return '<span class="th-subnav-label">'+icon('thread')+' Thread</span>'+[['Inbox','inbox'],['Compose','compose'],['Campaigns','campaigns']].map(([label,key])=>'<button type="button" class="th-tab '+(view===key?'on':'')+'" data-action="thread-view" data-value="'+key+'">'+label+'</button>').join('');
}
const engClass={opened:'open',clicked:'click',replied:'reply',delivered:'ok',bounced:'bad',held:'warn'};
function threadDemo(ws){
 const emails=new Set(ws.members.flatMap(m=>[m.email,...(m.contacts||[])]).filter(Boolean).map(x=>String(x).toLowerCase()));
 const real=x=>emails.has(String(x||'').toLowerCase());
 const threads=[
  {id:'t1',folder:'inbox',from:'Qaisar Ahmed',email:'qaisar@vitalise.io',subj:'Re: Albania pipeline timeline',time:'09:14',unread:true,eng:[['opened','opened 3×'],['clicked','clicked'],['delivered','delivered']],
   meta:'Qaisar Ahmed <qaisar@vitalise.io> · to you · today 09:14',
   paras:['Thanks for the note. Before we move forward we need to confirm the interconnection dates for the Albanian side — the current timeline is tight against the Q3 window.','Can you send the revised schedule so I can take it to the team?'],
   quote:'On Nov 11, you wrote: …we can hold the offtake slot if the grid dates land by end of month…',
   crm:['Lead · Albania','Deal · ALB-04']},
  {id:'t2',folder:'inbox',from:'Laëtitia Bernigaud',email:'laetitia.bernigaud@tse.energy',subj:'TSE — press enquiry',time:'08:50',unread:false,eng:[['held','auto-reply']],
   meta:'Laëtitia Bernigaud <laetitia.bernigaud@tse.energy> · to you · today 08:50',
   paras:['Hello, thank you for your message. I am currently on leave and will be back on Thursday. For urgent press enquiries, contact Luc Derai (luc.derai@tse.energy).'],
   crm:['Lead · TSE']},
  {id:'t3',folder:'inbox',from:'Farhan Iqbal',email:'farhan@grynh2.com',subj:'Intro — e-SAF offtake',time:'Yest',unread:true,eng:[['replied','replied']],
   meta:'Farhan Iqbal <farhan@grynh2.com> · to you · yesterday 16:02',
   paras:['They replied — warm. Suggest we schedule a call this week before the pricing window moves.'],
   crm:['Deal · SAF-02']},
  {id:'t4',folder:'inbox',from:'Jan A. Ramos · DOE',email:'jramos@energy.gov',subj:'GH2-017 offshore wind',time:'Nov 2',unread:false,eng:[['bounced','bounced · org-policy']],
   meta:'Delivery status · Jan A. Ramos <jramos@energy.gov>',
   paras:['Your message to jramos@energy.gov was rejected by the recipient organisation’s mail policy (content filter). No reply is expected on this thread.'],
   crm:['Lead · DOE']},
  {id:'t5',folder:'inbox',from:'Saras Energia',email:'info@sarasenergia.com',subj:'Follow-up: hydrogen MoU',time:'Oct 30',unread:false,eng:[['held','catch-all']],
   meta:'Saras Energia <info@sarasenergia.com> · held from bulk',
   paras:['This address is on a catch-all domain. Single 1:1 sends are allowed with an explicit override; it stays out of bulk campaigns.'],
   crm:[]},
  {id:'t6',folder:'sent',from:'you → Qaisar Ahmed',email:'qaisar@vitalise.io',subj:'Grid dates — revised schedule attached',time:'Nov 11',unread:false,eng:[['opened','opened 2×'],['delivered','delivered']],
   meta:'You → Qaisar Ahmed <qaisar@vitalise.io> · Nov 11 10:31',
   paras:['Attaching the revised interconnection schedule for the Albanian side. Key dates are highlighted in the Gantt extract.'],
   crm:['Deal · ALB-04']},
  {id:'t7',folder:'drafts',from:'Draft',email:'',subj:'Nordic wind investors — intro',time:'Nov 10',unread:false,eng:[],
   meta:'Local draft · edited Nov 10',
   paras:['Draft body — never left this machine.'],
   crm:[]},
  {id:'t8',folder:'archive',from:'Farhan Iqbal',email:'farhan@grynh2.com',subj:'Re: portal feedback',time:'Nov 8',unread:false,eng:[['delivered','delivered']],
   meta:'Farhan Iqbal <farhan@grynh2.com> · Nov 8',
   paras:['Feedback round closed — archived.'],
   crm:[]}
 ].map(t=>({...t,real:real(t.email)}));
 const recipients=[
  {email:'luc.derai@tse.energy',status:'safe'},
  {email:'farhan@grynh2.com',status:'safe'},
  {email:'info@sarasenergia.com',status:'catch_all'},
  {email:'press@cmci-sa.com',status:'unknown'},
  {email:'old@defunct-grid.io',status:'invalid'}
 ];
 return {threads,recipients};
}
function threadPage(ws,ui){
 const d=threadDemo(ws),view=ui.threadView||'inbox';
 return '<div class="thread-wrap">'+(view==='compose'?threadCompose(ws,ui,d):view==='campaigns'?threadCampaigns(ws):threadInbox(ws,ui,d))+'</div>';
}
function threadInbox(ws,ui,d){
 const folder=ui.threadFolder||'inbox';
 const count=k=>k==='inbox'?d.threads.filter(t=>t.folder==='inbox'&&t.unread).length:k==='drafts'?d.threads.filter(t=>t.folder==='drafts').length:k==='all'?d.threads.length:0;
 const folders=[['inbox','▸ Inbox'],['starred','★ Starred'],['sent','⤴ Sent'],['drafts','✎ Drafts'],['important','⚑ Important'],['spam','⚠ Spam'],['all','▤ All Mail'],['archive','▤ Archive'],['trash','🗑 Trash']];
 const rows=d.threads.filter(t=>folder==='all'||t.folder===folder);
 const sel=rows.find(t=>t.id===ui.threadId)||rows.find(t=>t.unread)||rows[0];
 return '<div class="th-panes"><div class="th-folders"><div class="th-compose-row">'+btn('✎ Compose','thread-view','primary',{'data-value':'compose'})+'</div>'+folders.map(([k,label])=>'<a class="th-folder '+(folder===k?'active':'')+'" href="#" data-action="thread-folder" data-value="'+k+'">'+label+(count(k)?'<span class="n">'+count(k)+'</span>':'')+'</a>').join('')+'</div>'+
 '<div class="th-list"><div class="th-list-head">'+btn('All','thread-demo','subtle')+'<span class="count muted">'+rows.length+' shown</span></div>'+
 (rows.length?rows.map(t=>'<div class="th-row'+(t.unread?' unread':'')+(sel&&sel.id===t.id?' active':'')+'" data-action="thread-select" data-id="'+t.id+'"><span class="th-dot'+(t.unread?'':' clear')+'"></span><div class="th-col"><div class="th-row1"><span class="th-from">'+e(t.from)+'</span><span class="th-subj">'+e(t.subj)+'</span><span class="th-time">'+e(t.time)+'</span></div><div class="th-snip">'+e(t.meta)+'</div><div class="th-eng">'+t.eng.map(([k,label])=>'<span class="badge '+engClass[k]+'">'+e(label)+'</span>').join('')+(t.real?'<span class="badge real">workspace contact</span>':'')+'</div></div></div>').join('')
 :'<div class="th-empty">No messages in this folder.</div>')+'</div>'+
 '<div class="th-reader">'+(sel?'<div class="th-reader-head"><h2>'+e(sel.subj)+'</h2><div class="muted small">'+e(sel.meta)+'</div></div>'+
 (sel.crm.length?'<div class="th-crm"><b>CRM match:</b>'+sel.crm.map(x=>'<span class="th-tag">'+e(x)+'</span>').join('')+'<span class="muted small">linked automatically · preview</span></div>':'')+
 '<div class="th-reader-body">'+sel.paras.map(x=>'<p>'+e(x)+'</p>').join('')+(sel.quote?'<div class="th-quote">'+e(sel.quote)+'</div>':'')+'</div>'+
 '<div class="th-reader-actions">'+btn('Reply','thread-demo','primary')+btn('Reply all','thread-demo')+btn('Forward','thread-demo')+btn('✦ AI draft','thread-demo')+'<label class="th-nofollow">'+check('nofollow',ui.threadNoFollow,'',{'data-filter':'threadNoFollow'})+' No follow-up</label></div>'
 :'<div class="th-empty">Nothing to read in this folder.</div>')+'</div></div>';
}
function threadCompose(ws,ui,d){
 const mode=ui.threadMode||'normal';
 const gate={safe:0,catch_all:0,unknown:0,invalid:0};
 d.recipients.forEach(r=>gate[r.status]++);
 const seg=['normal','campaign'].map(k=>'<button type="button" class="'+(mode===k?'on':'')+'" data-action="thread-mode" data-value="'+k+'">'+(k==='normal'?'Normal':'Campaign')+'</button>').join('');
 return '<div class="th-compose-wrap"><div class="th-compose">'+
 '<div class="th-compose-top"><span class="th-compose-title">New message</span><div class="th-seg">'+seg+'</div></div>'+
 '<div class="th-field"><label>From</label><div class="th-val"><span class="th-chip">'+e(ws.members[0].name)+' &lt;'+e(ws.members[0].email||'you@vitalise.io')+'&gt;</span><span class="muted small">root domain · relay</span></div></div>'+
 '<div class="th-field"><label>To</label><div class="th-val"><div class="th-tochips">'+d.recipients.map(r=>'<span class="th-chip">'+verifyBadge(r.status)+' '+e(r.email)+'</span>').join('')+'<span class="th-chip dashed">+ add</span></div>'+
 '<div class="th-gate">Gate: <b class="ok">✓ '+gate.safe+' safe</b> · <b class="warn">⚠ '+gate.catch_all+' catch-all</b> · <b class="muted">? '+gate.unknown+' unknown</b> · <b class="bad">✕ '+gate.invalid+' invalid</b>'+
 btn('Verify all','thread-gate','subtle')+
 (ui.threadGateReveal&&mode==='normal'?'<span class="muted small"><b class="warn">Catch-all blocked by default.</b> Single email only → <b class="ok">send-anyway override</b> · unknown <b>held</b> · invalid <b>suppressed</b></span>':'')+
 (mode==='campaign'?'<span class="muted small"><b class="bad">Bulk stays strict — no catch-all override.</b></span>':'')+'</div></div></div>'+
 '<div class="th-field"><label>Subject</label><div class="th-val"><input class="th-subject" value="Revised interconnection dates — Albania (ALB-04)" readonly></div></div>'+
 '<div class="th-tools">'+btn('B','thread-demo','subtle')+btn('I','thread-demo','subtle')+btn('🔗','thread-demo','subtle')+btn('✦ AI','thread-demo','subtle')+'<span class="muted small">formal outreach voice</span></div>'+
 '<div class="th-editor">'+area('','body','Dear Qaisar,\n\nThank you for the note. Please find the revised interconnection schedule below…\n\n[ extract the key dates ]',{rows:7,readonly:true})+'</div>'+
 '<div class="th-firewall"><span>⚠</span><div><b>“extract (”</b> may be blocked by the DreamHost outbound firewall (rule 942151).<br><span class="muted">Suggested rewrite: “pull out the key dates”.</span></div></div>'+
 '<div class="th-compose-foot"><span class="th-opt">'+btn('📎 Attach','thread-demo','subtle')+'</span><span class="th-opt">'+check('track',true,'',{disabled:true})+' Track opens/clicks</span><span class="th-opt">'+check('followup',true,'',{disabled:true})+' Follow-up (3–5d)</span><span class="th-send">'+btn('Send','thread-demo','primary disabled',{'aria-disabled':'true'})+'</span></div>'+
 '</div></div>';
}
function threadCampaigns(ws){
 const camps=[
  {name:'Q4 e-SAF outreach',channel:'bulk sender',sent:312,total:1240,held:8,bounced:2,state:'review'},
  {name:'Wind investors — Nordic',channel:'bulk sender',sent:448,total:700,held:0,bounced:5,state:'running'},
  {name:'Iron & Steel offtake',channel:'draft',sent:0,total:0,held:0,bounced:0,state:'draft'}
 ];
 const steps=[['1 Audience','done'],['2 From','done'],['3 Content','on'],['4 Review',''],['5 Pacing','']];
 const board=[['Sent','312','muted'],['Delivered','288','ok'],['Opened','141','open'],['Clicked','37','click'],['Replied','9','reply'],['Held','8','warn']];
 return '<div class="th-camp"><div class="th-camp-head"><h2>Campaigns</h2><p class="muted">Bulk sends go through the workspace’s bulk sender subdomain. Review mode → Approve → booked. <span class="th-demo-tag">sample data</span></p></div>'+
 '<div class="th-camp-grid"><div>'+btn('+ New campaign','thread-demo','primary row-gap')+'</div></div>'+
 '<div class="th-camp-grid"><div class="stack">'+camps.map(c=>'<div class="th-crow"><div class="th-crow-meta"><b>'+e(c.name)+'</b><span class="muted small"> · '+e(c.channel)+'</span>'+
 (c.total?'<div class="bar">'+bar(c.sent/c.total*100)+'</div><div class="small muted">'+c.sent+' / '+c.total+' sent · <span class="warn">'+c.held+' held</span> · <span class="bad">'+c.bounced+' bounced</span></div>':'<div class="small muted">not booked</div>')+
 '</div>'+btn(c.state==='review'?'Review':c.state==='running'?'Open':'Continue','thread-demo','subtle')+'</div>').join('')+
 '</div><div class="th-wiz"><b>Builder — Q4 e-SAF outreach</b><span class="th-demo-tag">sample data</span>'+
 '<div class="th-wsteps">'+steps.map(([label,cls])=>'<span class="th-wstep '+cls+'">'+label+'</span>').join('')+'</div>'+
 '<div class="th-kv"><span class="muted">Audience segment</span><b>safe-to-contact · 1,240</b></div>'+
 '<div class="th-kv"><span class="muted">Gate breakdown</span><span><b class="ok">✓ 1,180</b> · <b class="bad">✕ 60 suppressed</b></span></div>'+
 '<div class="th-kv"><span class="muted">Sender / reputation</span><b>warmup 25%</b></div>'+
 '<div class="bar">'+bar(25)+'</div>'+
 '<div class="th-kv"><span class="muted">Daily cap</span><b>2,000 · gap auto</b></div>'+
 '<div class="small muted th-board-label">Live board</div>'+
 '<div class="th-board">'+board.map(([label,value,cls])=>'<div class="th-stat"><div class="big '+cls+'">'+value+'</div><div class="lbl">'+label+'</div></div>').join('')+'</div>'+
 '<div class="th-wiz-actions">'+btn('Save draft','thread-demo')+btn('Preview sample →','thread-demo','primary')+'</div>'+
 '</div></div></div>';
}
export function workspacePage(page,ws,ui,state,{webSearch,firecrawlAvailable,jevAvailable,perplexityAvailable,limaAvailable}={}){
 const member=ws.members[0];
 if(page==='home'){
  if(!ws.projects.length)return onboardingHome(ws);
  const leads=ws.projects.flatMap(p=>p.leads), todays=ws.projects.flatMap(p=>todayRows(ws,p)), all=ws.projects.flatMap(p=>p.assignments);
  const replied=all.filter(a=>a.marks.includes('Replied')).length, attempts=all.filter(a=>a.marks.includes('Attempted')).length;
  return header(e(ws.name),'Workspace dashboard',link('Analytics →',ws.projects[0]?go('analytics',ws.projects[0].id):go('usage'))+link('New project',go('new'),'btn primary'))+
   '<div class="cards">'+stat('Projects',ws.projects.length,'5 included')+stat('Leads',leads.length,'across all project lists')+stat('Worked today',todays.filter(a=>a.marks.length).length+'/'+todays.length,'assignments, all channels')+
   stat('Reply rate',attempts?Math.round(replied/attempts*100)+'%':'0%','replied ÷ attempted')+stat('Total LTV',money(leads.reduce((n,l)=>n+l.ltv,0)),'across all projects')+
   stat('Suppressed contacts',ws.suppressions.filter(x=>!x.removedAt).length,'workspace-wide')+'</div>'+
   '<div class="grid2">'+card('Projects','<p class="muted small">Each project has a lead list, channels, caps, and members.</p><div class="stack row-gap">'+ws.projects.map(p=>link(p.name+' · '+p.leads.length+' leads',go('overview',p.id))).join('')+link('+ New project',go('new'))+'</div>')+
   card('People '+ws.members.length,ws.members.map(m=>'<div class="activity">'+memberAvatar(m)+'<div><strong>'+e(m.name)+'</strong><div class="small muted">'+e(m.role)+' · '+e(m.status)+'</div></div></div>').join('')+link('Manage →',go('team'),'btn link'))+'</div>';
 }
 if(page==='account')return '<div class="narrow">'+header('Account settings','Edit your local profile and time zone.')+card('Profile',form('account',field('Full name','name',member.name,{required:true})+field('Email','email',member.email,{type:'email'})+field('Phone','phone',member.phone,{type:'tel'})+zoneField(member.timezone)))+'</div>';
 if(page==='apps'){
  const all=[
   ['Gmail','Email','Watch sender inboxes and mark replies or bounces.','External integration'],
   ['Slack alerts','Notifications','Send qualified lead updates and a morning digest.','Coming soon'],
   ['Google Postmaster','Email','See sender-domain reputation and spam rates.','Coming soon'],
   ['HubSpot push','CRM','Push a lead and its status into HubSpot.','Coming soon'],
   ['Google Sheets sync','Export','Keep a spreadsheet in sync with project leads.','Coming soon'],
   ['Scheduled CSV export','Export','Send a recurring CSV of project leads.','Coming soon'],
   ['Exa web search','Search','Use the optional web provider in Find leads and enrichment.',webSearch?'Configured':'Configure EXA_API_KEY'],
   ['Firecrawl v2','Search','Find candidates on the web or look for source snippets on a lead’s website.',firecrawlAvailable?'Configured':'Configure FIRECRAWL_API_KEY'],
   ['Perplexity','Search','Find candidates and research a lead’s website.',perplexityAvailable?'Configured':'Configure PERPLEXITY_API_KEY'],
   ['LimaData','Enrichment','Find a work email for a saved person.',limaAvailable?'Configured':'Configure LIMADATA_API_KEY'],
   ['TypeSafe / Jev','Scoring','Score a lead against saved project targeting.',jevAvailable?'Configured':'Configure TYPESAFE_API_KEY']
  ];
  const filter=ui.apps||'All';
  return header('Apps','Workspace and project integrations.')+'<div class="filters">'+['All','Notifications','Email','CRM','Export','Search','Enrichment','Scoring'].map(k=>btn(k,'apps-filter',filter===k?'active':'',{'data-value':k})).join('')+'</div><div class="grid2">'+all.filter(x=>filter==='All'||x[1]===filter).map(x=>card(x[0],'<p>'+e(x[2])+'</p><span class="pill row-gap">'+e(x[3])+'</span>')).join('')+'</div>';
 }
 if(page==='thread')return threadPage(ws,ui);
 let body='';
 if(page==='settings')body=header('Workspace','Name, slug, time zone and owner of this workspace.')+card('Workspace details',form('workspace-settings',field('Name','name',ws.name,{required:true})+field('Slug','slug',ws.id,{disabled:true})+zoneField(ws.timezone)))+
   '<div class="row-gap">'+card('Workspace owner','<strong>'+e(member.name)+'</strong> <span class="pill">Owner</span>')+'</div>';
 if(page==='team'){
  const people=ws.members.map(m=>tr([memberAvatar(m)+' <strong>'+e(m.name)+'</strong><small class="subline">'+e(m.email)+'</small>',
   m.role==='Owner'?'<span class="pill">Owner</span>':select('role',['Admin','Agent'],m.role,{'data-change':'member-role','data-member':m.id}),m.role==='Owner'?e(m.status):select('Status',['Pending','Active'],m.status,{'data-change':'member-status','data-member':m.id})]));
  body=header('Team','Manage workspace roles. Agent access to a project is set on its Agents page.')+
   '<div class="grid2">'+card('People '+people.length,table(['Person','Role','Status'],people))+
   card('Invite someone',form('invite',field('Invite email','email','',{type:'email',required:true})+'<label>Invite role'+select('role',['Agent','Admin'],'Agent')+'</label>'+note('Local mode records an invitation as pending.'),'Record invitation'))+'</div>';
 }
 if(page==='dnc'){
  const matching=ws.suppressions.filter(s=>(ui.removed||!s.removedAt)&&(!ui.dncType||s.kind===ui.dncType)&&(!ui.dncQuery||s.value.includes(ui.dncQuery.toLowerCase())));
  body=header('Do-not-contact list','These entries are excluded from new worklists and future imports.',btn('Export CSV','dnc-export')+btn('Add entries','dialog','primary',{'data-kind':'suppress'}))+
  '<div class="filters"><input type="search" placeholder="Search suppressions" aria-label="Search suppressions" value="'+e(ui.dncQuery)+'" data-input="dncQuery">'+select('Type filter',[['All types',''],'Email','Phone','Domain','Instagram','LinkedIn'],ui.dncType||'',{'data-filter':'dncType'})+
  '<label class="flex">'+check('removed',ui.removed,'',{'data-filter':'removed'})+' Show removed</label><span class="count muted">'+matching.length+' shown · '+ws.suppressions.filter(s=>!s.removedAt).length+' active</span></div>'+
  table(['Value','Reason','Type','Added',''],matching.length?matching.map(s=>tr([e(s.value),e(s.reason),e(s.kind),e(date(s.at,ws.timezone)),s.removedAt?'<span class="pill">Removed</span>':btn('Remove','unsuppress','subtle',{'data-id':s.id})])):[blankRow(5,'Nothing on the do-not-contact list yet.')]);
 }
 if(page==='usage'){
  const fullest=[...ws.projects].sort((a,b)=>b.leads.length-a.leads.length)[0];
  body=header('Usage & limits','Manage local project and lead capacity.')+'<div class="grid2">'+card('Projects','<strong>'+ws.projects.length+' / 5</strong><div class="row-gap">'+bar(ws.projects.length*20)+'</div>')+
  card('Fullest project',fullest?'<strong>'+e(fullest.name)+' · '+fullest.leads.length+' / '+fullest.maxLeads+'</strong><div class="row-gap">'+bar(fullest.leads.length/fullest.maxLeads*100)+'</div>':empty('No projects yet.'))+'</div>'+
  '<div class="row-gap">'+card('Leads per project',ws.projects.map(p=>'<div class="meter-row"><strong>'+e(p.name)+'</strong>'+bar(p.leads.length/p.maxLeads*100)+'<span>'+p.leads.length+'</span></div>').join('')||empty('No projects yet.'))+'</div>';
 }
 if(page==='audit')body=header('Audit export','Download outreach and suppression events for a date range. Contact identifiers are hashed.')+
  '<div class="narrow">'+card('New export',form('audit','<div class="field-row">'+field('From','from','',{type:'date'})+field('To','to',day(ws.timezone),{type:'date'})+'</div><label>Project'+select('project',[['All projects',''],...ws.projects.map(p=>[p.name,p.id])],'')+'</label><label>Format'+select('format',[['CSV','csv'],['JSONL','jsonl']],'csv')+'</label>','Download export'))+'</div>';
 return tabs(settingsTabs,page,k=>go(k))+body;
}


