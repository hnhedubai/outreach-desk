import {e,go,link,btn,header,card,empty,table,tr,blankRow,form,field,area,check,select,tabs,stat,bar,note,date,day,money,todayRows,icon,initialOf,glyphStyle} from './ui.js';
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


