import {e,go,link,btn,header,card,empty,table,tr,blankRow,form,field,area,check,select,tabs,stat,bar,note,date,day,money,todayRows,icon,initialOf,glyphStyle,verifyBadge} from './ui.js';
import {sanitizeHtml,htmlToText} from './sanitize.js';
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
const selfEmail=ws=>String(ws.members[0]?.email||'').toLowerCase();
const thTime=stamp=>{const d=new Date(stamp),n=new Date();return d.toDateString()===n.toDateString()?d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'});};
const findLead=(ws,id)=>{for(const p of ws.projects){const l=p.leads.find(x=>x.id===id);if(l)return{l,p};}return null;};
const otherParty=(ws,thread)=>{const se=selfEmail(ws);return thread.participants.find(p=>p.email&&String(p.email).toLowerCase()!==se)||thread.participants.find(p=>p.email)||thread.participants[0]||{name:'Unknown',email:''};};
const threadSnippet=thread=>htmlToText(thread.messages.at(-1)?.bodyHtml||'').slice(0,90);
const peopleEmails=list=>(list||[]).map(p=>typeof p==='string'?p:p.email).filter(Boolean);
// Build a quoted trail for reply/reply-all so the original message is visible and editable.
// Forward is intentionally excluded — the server quotes it (model.mjs thread-forward).
export const quoteTrail=message=>{
 const body=message?.bodyHtml;if(!body)return '';
 const who=String(message.from?.name||message.from?.email||'').trim();
 const stamp=new Date(message.at);const when=isNaN(+stamp)?'':stamp.toLocaleString('en-CA');
 const head=when?('On '+e(when)+(who?', '+e(who):'')):e(who||'The sender');
 return '<p>'+head+' wrote:</p><blockquote>'+sanitizeHtml(body)+'</blockquote>';
};
  const fmt=(cmd,label,value,title)=>'<button type="button" class="btn subtle th-fmt" data-action="fmt" data-cmd="'+cmd+'"'+(value?' data-value="'+value+'"':'')+(title?' title="'+e(title)+'" aria-label="'+e(title)+'"':'')+'>'+label+'</button>';
  // Dropdown command: a leading disabled placeholder keeps it acting as a one-shot button,
  // and the change handler resets it to the placeholder after applying.
  const fmtSel=(cmd,title,options)=>'<select class="th-fmt th-fmt-sel" data-action="fmt-change" data-cmd="'+cmd+'" title="'+e(title)+'" aria-label="'+e(title)+'"><option value="" disabled selected>'+e(title)+'</option>'+options.map(([v,l])=>'<option value="'+e(v)+'">'+e(l)+'</option>').join('')+'</select>';
  const fmtColor=(cmd,label,title,def)=>'<label class="th-fmt th-fmt-color" title="'+e(title)+'" aria-label="'+e(title)+'">'+label+'<input type="color" data-action="fmt-change" data-cmd="'+cmd+'" value="'+e(def||'#000000')+'"></label>';
  // Signature editor uses the same execCommand engine but a separate action so it never
  // touches the compose draft. Buttons carry .th-fmt so mousedown keeps the selection alive.
  const sigFmt=(cmd,label,title)=>'<button type="button" class="btn subtle th-fmt" data-action="sig-fmt" data-cmd="'+cmd+'" title="'+e(title)+'" aria-label="'+e(title)+'">'+label+'</button>';
function threadPage(ws,ui){
 const view=ui.threadView||'inbox';
 return '<div class="thread-wrap">'+(view==='compose'?threadCompose(ws,ui):threadInbox(ws,ui))+'</div>';
}
 // Read a persisted thread-pane width, clamped to [min,max]; falls back to def.
 const thW=(key,def,min,max)=>{const n=parseInt(localStorage.getItem('vitalise.'+key),10);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):def;};
 function threadInbox(ws,ui){
  const folder=ui.threadFolder||'inbox',se=selfEmail(ws);
  const fw=thW('thFoldersW',250,160,440),lw=thW('thListW',360,220,680);
 const all=ws.threads||[];
 const query=String(ui.threadQuery||'').trim().toLowerCase();
 const inFolder=t=>folder==='all'?true:folder==='starred'?t.starred:folder==='important'?t.important:t.folder===folder;
 const matches=t=>!query||[t.subject,...t.participants.map(p=>(p.name||'')+' '+p.email),...t.messages.map(m=>m.bodyText)].join(' ').toLowerCase().includes(query);
 const rows=all.filter(t=>inFolder(t)&&matches(t)).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
 const count=k=>{const list=k==='all'?all:all.filter(t=>k==='starred'?t.starred:k==='important'?t.important:t.folder===k);return k==='inbox'?list.filter(t=>t.unread).length:list.length;};
 const folders=[['inbox','▸ Inbox'],['starred','★ Starred'],['important','⚑ Important'],['sent','⤴ Sent'],['drafts','✎ Drafts'],['all','▤ All Mail'],['archive','▤ Archive'],['spam','⚠ Spam'],['trash','🗑 Trash']];
 const sel=rows.find(t=>t.id===ui.threadId)||rows[0];
 const row=t=>{const other=otherParty(ws,t);const link=t.leadId?findLead(ws,t.leadId):null;
  const tags=[...(t.labels||[]).map(x=>'<span class="badge">'+e(x)+'</span>'),link?'<span class="badge real">'+e(link.l.name)+'</span>':'',t.messages.at(-1)?.kind==='auto'?'<span class="badge warn">auto-reply</span>':''].join('');
  return '<div class="th-row'+(t.unread?' unread':'')+(sel&&sel.id===t.id?' active':'')+'" data-action="thread-select" data-id="'+t.id+'">'+
   '<button type="button" class="th-star'+(t.starred?' on':'')+'" data-action="thread-star" data-thread="'+t.id+'" data-value="'+(t.starred?'false':'true')+'" aria-label="Star">'+(t.starred?'★':'☆')+'</button>'+
   '<div class="th-col"><div class="th-row1"><span class="th-from">'+e(other.name||other.email||'—')+'</span><span class="th-subj">'+e(t.subject)+'</span><span class="th-time">'+e(thTime(t.updatedAt))+'</span></div>'+
   '<div class="th-snip">'+e(threadSnippet(t))+'</div><div class="th-eng">'+tags+'</div></div></div>';};
  return '<div class="th-panes"><div class="th-folders" style="flex-basis:'+fw+'px"><div class="th-compose-row">'+btn('✎ Compose','thread-compose','primary')+'</div>'+
   folders.map(([k,label])=>'<a class="th-folder '+(folder===k?'active':'')+'" href="#" data-action="thread-folder" data-value="'+k+'">'+label+(count(k)?'<span class="n">'+count(k)+'</span>':'')+'</a>').join('')+'</div>'+
   '<div class="th-resizer" data-resize="folders" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Resize folders pane"></div>'+
   '<div class="th-list" style="flex-basis:'+lw+'px"><div class="th-list-head"><input class="th-search" type="search" placeholder="Search conversations" aria-label="Search conversations" value="'+e(ui.threadQuery||'')+'" data-input="threadQuery"><span class="count muted">'+rows.length+'</span></div>'+
   (rows.length?rows.map(row).join(''):'<div class="th-empty">'+(query?'No conversations match your search.':'No messages in this folder.')+'</div>')+'</div>'+
   '<div class="th-resizer" data-resize="list" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Resize message list"></div>'+
   '<div class="th-reader">'+(sel?threadReader(ws,ui,sel,se):'<div class="th-empty">Nothing to read in this folder.</div>')+'</div></div>';
}
function threadReader(ws,ui,t,se){
 const lead=t.leadId?findLead(ws,t.leadId):null;
 const last=t.messages.at(-1);
 const msg=m=>{const mine=m.direction==='out';const who=mine?'You':(m.from.name||m.from.email||'—');
  const recips=[...m.to,...m.cc].map(p=>p.email).filter(Boolean);
  return '<div class="th-msg'+(mine?' mine':'')+'"><div class="th-msg-head">'+
   '<span class="th-msg-who">'+e(who)+'</span>'+
   '<span class="th-msg-mail">'+e(mine?('to '+(recips.join(', ')||'—')):m.from.email)+'</span>'+
   (m.kind&&m.kind!=='message'?'<span class="badge warn">'+e(m.kind)+'</span>':'')+
   '<span class="th-msg-time">'+e(thTime(m.at))+'</span>'+
   '<span class="th-msg-actions">'+btn('Reply','thread-reply','subtle',{'data-thread':t.id,'data-message':m.id})+
    btn('Reply all','thread-reply-all','subtle',{'data-thread':t.id,'data-message':m.id})+
    btn('Forward','thread-forward','subtle',{'data-thread':t.id,'data-message':m.id})+'</span></div>'+
   '<div class="th-msg-body">'+sanitizeHtml(m.bodyHtml||'')+'</div></div>';};
 return '<div class="th-reader-head"><h2>'+e(t.subject)+'</h2>'+
  '<div class="th-reader-tools">'+
   btn(t.starred?'★ Starred':'☆ Star','thread-star','subtle',{'data-thread':t.id,'data-value':t.starred?'false':'true'})+
   btn(t.important?'⚑ Important':'☆ Important','thread-important','subtle',{'data-thread':t.id,'data-value':t.important?'false':'true'})+
   btn(t.unread?'Mark read':'Mark unread','thread-read','subtle',{'data-thread':t.id,'data-value':t.unread?'false':'true'})+
   btn('Archive','thread-move','subtle',{'data-thread':t.id,'data-folder':'archive'})+
   btn('Spam','thread-move','subtle',{'data-thread':t.id,'data-folder':'spam'})+
   btn('Trash','thread-move','subtle',{'data-thread':t.id,'data-folder':'trash'})+
  '</div></div>'+
  (lead?'<div class="th-crm"><b>CRM match:</b><a class="th-tag" href="'+e(go('lead',lead.p.id,lead.l.id,'channels'))+'">'+e(lead.l.name)+'</a><span class="muted small">linked to this lead</span></div>':'')+
  (t.labels&&t.labels.length?'<div class="th-labels">'+t.labels.map(x=>'<span class="badge">'+e(x)+'</span>').join('')+'</div>':'')+
  '<div class="th-reader-body">'+t.messages.map(msg).join('')+'</div>'+
  '<div class="th-reader-actions">'+btn('Reply','thread-reply','primary',{'data-thread':t.id,'data-message':last.id})+
   btn('Reply all','thread-reply-all','',{'data-thread':t.id,'data-message':last.id})+
   btn('Forward','thread-forward','',{'data-thread':t.id,'data-message':last.id})+
   btn('✎ Log inbound reply','thread-receive','subtle',{'data-thread':t.id})+'</div>';
}
function threadCompose(ws,ui){
 const d=ui.threadDraft||{mode:'compose',to:[],cc:[],subject:'',bodyHtml:''};
 const self=ws.members[0];
 const mode=d.mode||'compose';
 const title={compose:'New message',reply:'Reply',replyAll:'Reply all',forward:'Forward',receive:'Log inbound reply'}[mode]||'New message';
 const fixed=mode==='reply'||mode==='replyAll';
 const toVal=peopleEmails(d.to).join(', '),ccVal=peopleEmails(d.cc).join(', ');
 // Gmail-style space management: From is implied for replies/inbound, so hide its row.
 const showFrom=mode==='compose'||mode==='forward';
 // Cc collapses behind an inline toggle; it stays open if it already holds a value.
 const showCc=!!ui.showCc||!!ccVal;
 return '<div class="th-compose-wrap"><div class="th-compose">'+
  '<div class="th-compose-top"><span class="th-compose-title">'+e(title)+'</span>'+btn('Discard','thread-discard','subtle')+'</div>'+
  (showFrom?'<div class="th-field th-from"><label>From</label><div class="th-val"><span class="th-chip">'+e(self.name||'You')+' &lt;'+e(self.email||'you@workspace')+'&gt;</span></div></div>':'')+
   '<div class="th-field"><label>To</label><div class="th-val"><div class="th-recip"><input class="th-to" data-draft="to" value="'+e(toVal)+'"'+(fixed?' readonly':'')+' placeholder="Recipients, separated by commas" autocomplete="off" spellcheck="false">'+(showCc?'':'<button type="button" class="th-cc-toggle" data-action="thread-cc-toggle" title="Add Cc">Cc</button>')+'</div><div class="th-recip-hint" data-hint="to"></div></div></div>'+
   (showCc?'<div class="th-field"><label>Cc</label><div class="th-val"><div class="th-recip"><input class="th-cc" data-draft="cc" value="'+e(ccVal)+'"'+(fixed?' readonly':'')+' placeholder="optional" autocomplete="off" spellcheck="false"><button type="button" class="th-cc-toggle" data-action="thread-cc-toggle" title="Remove Cc">✕</button></div><div class="th-recip-hint" data-hint="cc"></div></div></div>':'')+
  '<div class="th-field"><label>Subject</label><div class="th-val"><input class="th-subject" data-draft="subject" value="'+e(d.subject||'')+'" autocomplete="off" placeholder="Subject"'+(mode==='receive'||mode==='reply'||mode==='replyAll'?' readonly':'')+'></div></div>'+
   '<div class="th-tools">'+
    fmtSel('formatBlock','Style',[['p','Normal text'],['h1','Heading 1'],['h2','Heading 2'],['h3','Heading 3'],['blockquote','Quote'],['pre','Code block']])+
    fmtSel('fontName','Font',[['Arial','Arial'],['Calibri','Calibri'],['Georgia','Georgia'],['Times New Roman','Times New Roman'],['Courier New','Courier New'],['Verdana','Verdana'],['Trebuchet MS','Trebuchet MS']])+
    fmtSel('fontSize','Size',[['1','Tiny'],['2','Small'],['3','Normal'],['4','Medium'],['5','Large'],['6','X-Large'],['7','XX-Large']])+
    '<span class="th-sep"></span>'+
    fmt('bold','<b>B</b>','','Bold')+fmt('italic','<i>I</i>','','Italic')+fmt('underline','<u>U</u>','','Underline')+fmt('strikeThrough','<s>S</s>','','Strikethrough')+
    '<span class="th-sep"></span>'+
    fmtColor('foreColor','A','Text colour','#000000')+fmtColor('hiliteColor','AB','Highlight colour','#ffff00')+
    '<span class="th-sep"></span>'+
    fmt('insertUnorderedList','•','','Bulleted list')+fmt('insertOrderedList','1.','','Numbered list')+
    fmt('inlineCode','&lt;/&gt;','','Inline code')+
    fmt('createLink','🔗','','Insert link')+fmt('insertTable','▦','','Insert table')+
    '<span class="th-sep"></span>'+
    fmt('removeFormat','⌫','','Clear formatting')+'</div>'+
  '<div class="th-editor"><div class="th-edit" contenteditable="true" spellcheck="true" role="textbox" aria-multiline="true" data-editor>'+sanitizeHtml(d.bodyHtml||'')+'</div></div>'+
  '<div class="th-compose-foot">'+btn('Save draft','thread-save-draft','subtle')+
   '<span class="th-send">'+btn(mode==='receive'?'Log reply':'Send','thread-submit','primary')+'</span></div>'+
  '</div></div>';
}
function mailboxCard(mail){
 const m=mail||{};
 const status=m.configured
  ?'<p class="row-gap"><span class="pill ok">✓ Saved · '+e(m.user)+'</span></p>'
  :'<p class="row-gap"><span class="pill off">Not configured</span></p>';
 const warn=m.secretAvailable===false?'<p class="notice small">Saving a password needs the <code>OUTREACH_SECRET</code> variable set in the server environment. Host, port and folder can still be saved once it is set.</p>':'';
 return card('Mailbox (IMAP)',
  '<p class="muted small">Thread reads inbound mail from this mailbox. Credentials are stored on this computer, encrypted at rest, and the password is never sent back to the browser. Leave the password blank to keep the saved one.</p>'+
  status+warn+
  form('mail-settings',
   field('IMAP host','host',m.host||'imap.dreamhost.com',{autocomplete:'off',spellcheck:'false'})+
   '<div class="field-row">'+field('Port','port',String(m.port||993),{type:'number',min:'1',max:'65535'})+field('Folder','mailbox',m.mailbox||'INBOX',{autocomplete:'off',spellcheck:'false'})+'</div>'+
   field('Mailbox address','user',m.user||'',{type:'email',autocomplete:'off',placeholder:'you@yourdomain.com'})+
   field('Password','password','',{type:'password',autocomplete:'new-password',placeholder:m.configured?'••••••••  leave blank to keep current':'Mailbox password'})+
   '<label class="flex">'+check('tls',m.tls!==false)+' Use TLS (recommended)</label>','Save mailbox')+
  '<div class="flex row-gap">'+btn('Test connection','mail-test')+btn('Fetch new mail','mail-fetch','primary')+'</div>');
}
export function workspacePage(page,ws,ui,state,{webSearch,firecrawlAvailable,jevAvailable,perplexityAvailable,limaAvailable,mail}={}){
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
     '<div class="row-gap">'+card('Workspace owner','<strong>'+e(member.name)+'</strong> <span class="pill">Owner</span>')+'</div>'+
     '<div class="row-gap">'+card('Email signature',
       '<p class="muted small">Added automatically to the end of every new message. Replies and forwards keep only their quoted text.</p>'+
       '<div class="th-tools sig-tools">'+sigFmt('bold','<b>B</b>','Bold')+sigFmt('italic','<i>I</i>','Italic')+sigFmt('createLink','🔗','Insert link')+sigFmt('removeFormat','⌫','Clear formatting')+'</div>'+
       '<div class="sig-edit" contenteditable="true" spellcheck="true" role="textbox" aria-multiline="true" data-sig>'+sanitizeHtml(member.signature||'')+'</div>'+
       '<div class="row-gap">'+btn('Save signature','signature-save','primary')+'</div>')+'</div>'+
     '<div class="row-gap">'+mailboxCard(mail)+'</div>';
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


