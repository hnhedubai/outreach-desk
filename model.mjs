import {randomUUID} from 'node:crypto';

import {contactAllowed,handleKey,isSuppressed,suppressionKind} from './public/eligibility.js';

export const CHANNELS=['Call','Email','Instagram','LinkedIn','SMS','WhatsApp'];
export const MARKS=['Attempted','Replied','Opt-out','Bounce','Invalid handle'];
const LIFECYCLE=['Prospect','Engaged','Active','Churned','Lost'];
const seeded=[
 ['Sonnedix','sonnedix.com','United States','Axel Thiemann','axel-thiemann-94313b'],
 ['Matrix Renewables','matrixrenewables.com','Spain','Luis Sabaté','luissabate'],
 ['Renewable Power Capital','renewablepowercapital.com','United Kingdom','Sarwjit Sambhi','sarwjit-sambhi'],
 ['Enel Green Power','enelgreenpower.com','Italy','Salvatore Bernabei','salvatore-bernabei'],
 ['Mainstream Renewable Power','mainstreamrp.com','United Kingdom','Julie Berg','julie-berg-1a02103'],
 ['Eden Renewables','edenrenewables.com','United Kingdom'],
 ['EDF power solutions North America','edf-re.com','United States'],
 ['Elements Green','elementsgreen.com','United Kingdom'],
 ['GreenGo S.r.l.','green-go.net','Italy'],['Hive Energy','hiveenergy.co.uk','United Kingdom'],
 ['Lexham Power','lexhampower.com','Italy'],['Nadara','nadara.com','United Kingdom'],
 ['Pattern Energy','patternenergy.com','United States'],['PRC Wind & Solar','prcwind.com','United States'],
 ['Silicon Ranch','siliconranch.com','United States'],['WI IPP','wi-ipp.de','Germany'],
 ['CWP Europe','cwp.eu','Southeast Europe'],['DESRI','desri.com','United States'],
 ['Firma Energy','firmaenergy.co.uk','United Kingdom'],['Geronimo Power','geronimopower.com','United States'],
 ['JUWI Inc.','juwiamericas.com','United States'],['Opdenergy','opdenergy.com','Spain'],
 ['TerraForm Power','terraform.com','United States'],['Tion Renewables','tion-renewables.com','Germany'],
 ['Velto Renewables','veltorenewables.com','Spain']
];
const tidy=(value,max=500)=>String(value??'').trim().slice(0,max);
const today=(tz='Asia/Dubai')=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,dateStyle:'short'}).format(new Date());
const id=()=>randomUUID().slice(0,12);
const now=()=>new Date().toISOString();
const invalid=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const count=(value,limit=1000)=>Math.max(0,Math.min(limit,Math.trunc(Number(value)||0)));
const list=(value,max=100)=>Array.isArray(value)?value.slice(0,max):[];
const byId=(array,key,message)=>array.find(row=>row.id===key)||invalid(message,404);
export function cleanDomain(value) {
  const raw=tidy(value,300);
  if(!raw)return '';
  try{
    const u=new URL(raw.includes('://')?raw:'https://'+raw);
    if(u.username||u.password||!['https:','http:'].includes(u.protocol))return '';
    const d=u.hostname.replace(/^www\./,'').replace(/\.$/,'').toLowerCase();
    const labels=d.split('.');
    return d.length<=253&&labels.length>1&&/^[a-z]/.test(labels.at(-1))&&
      labels.every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))?d:'';
  }catch{return '';}
}
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const normalizeEmail=value=>{const e=tidy(value,254).toLowerCase();return emailPattern.test(e)?e:'';};
export function cleanHandle(channel,value){
  const text=tidy(value,350);
  if(channel==='Email')return normalizeEmail(text);
  if(['Call','SMS','WhatsApp'].includes(channel))return /^\+?[\d ().-]{6,28}$/.test(text)?text:'';
  try{
    const u=new URL(text.includes('://')?text:'https://'+text);
    const host=channel==='LinkedIn'?'linkedin.com':'instagram.com';
    return ['https:','http:'].includes(u.protocol)&&(u.hostname===host||u.hostname.endsWith('.'+host))&&u.pathname.length>1?u.href:'';
  }catch{return '';}
}
function newContact(input){
  return {id:id(),name:tidy(input.name,140),title:tidy(input.title,160),email:normalizeEmail(input.email),linkedin:cleanHandle('LinkedIn',input.linkedin),source:tidy(input.source,350)};
}
const companyProfileLimits={city:100,platform:100,leadSource:140};
function cleanFitReview(review){
  if(!isRecord(review)||typeof review.reviewedOn!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(review.reviewedOn)||
    !Array.isArray(review.assets)||!review.assets.length||review.assets.length>25)invalid('Enter a review date and up to 25 assessed sites.');
  const statuses=['Documented','Partial','Unverified','Outside range'];
  const assets=review.assets.map(asset=>{
    if(!isRecord(asset)||!tidy(asset.name,140)||!Array.isArray(asset.signals)||!asset.signals.length||asset.signals.length>20)invalid('Each assessed site needs a name and up to 20 signals.');
    const signals=asset.signals.map(signal=>{
      if(!isRecord(signal)||!tidy(signal.label,140)||!statuses.includes(signal.status)||!tidy(signal.detail,1500))invalid('Each signal needs a label, status and evidence summary.');
      return {label:tidy(signal.label,140),status:signal.status,detail:tidy(signal.detail,1500)};
    });
    return {name:tidy(asset.name,140),site:tidy(asset.site,300),signals};
  });
  return {reviewedOn:review.reviewedOn,assets};
}
function newLead(input){
  const domain=cleanDomain(input.domain);
  if(!domain)invalid('Enter a valid company domain.');
  const channels={};
  for(const k of CHANNELS){const h=cleanHandle(k,input.channels?.[k]??(k==='Email'?input.email:k==='LinkedIn'?input.linkedin:''));if(h)channels[k]=h;}
  return {id:id(),name:tidy(input.name,140)||domain,domain,country:tidy(input.country,100),category:tidy(input.category,120),
    ...Object.fromEntries(Object.entries(companyProfileLimits).map(([key,limit])=>[key,tidy(input[key],limit)])),
    description:tidy(input.description,8000),website:tidy(input.website,400)||'https://'+domain,lifecycle:'Prospect',ltv:0,segment:'',score:null,
    manual:false,notFit:false,channels,contacts:list(input.contacts,200).map(newContact).filter(x=>x.name),notes:[],drafts:{},source:tidy(input.source,400),addedAt:now(),domainVerified:'pending',domainCheckedAt:null};
}
function makeProject(input,members){
  const name=tidy(input.name,80);
  if(!name)invalid('Enter a project name.');
  const configs=Object.fromEntries(CHANNELS.map((key,i)=>[key,{enabled:['Email','LinkedIn'].includes(key),cap:[8,1,6,5,6,8][i],cooldown:[10,7,5,14,14,10][i],touches:[2,3,1,3,1,1][i],corporate:['Email','SMS'].includes(key),priority:['A','B','C']}]));
  return {id:id(),name,leads:[],assignments:[],imports:[],searches:[],enrichments:[],history:[],configs,mailboxes:[],agents:members.map(m=>m.id),
    autoAssign:true,split:'Auto-balance',quotas:{},globalCooldown:7,maxLeads:1000,createdAt:now(), targeting:{website:tidy(input.website,350),offer:tidy(input.offer,6000),ideal:tidy(input.ideal,6000),guidelines:'',signals:[],roles:[],a:70,b:40}};
}
export function createState(){
  const owner={id:'owner',name:'Mubashir',email:'',role:'Owner',phone:'',timezone:'Asia/Dubai',status:'Active'};
  const workspace={id:'grynh2',name:'grynh2',timezone:'Asia/Dubai',members:[owner],projects:[],suppressions:[],audit:[],exports:[],cookie:'',searches:0};
  const p=makeProject({name:'Wind-Solar-Outreach',website:'grynh2.com',offer:'Investment introductions and partnerships for wind and solar projects.',ideal:'Owners and developers of wind and solar assets seeking investment, joint ventures, co-development, or project sales.'},workspace.members);
  p.id='wind-solar-outreach';
  for(const [name,domain,country,person,profile] of seeded){
    const linkedin=profile?'https://www.linkedin.com/in/'+profile:'';
    p.leads.push(newLead({name,domain,country,contacts:person?[{name:person,linkedin,source:linkedin}]:[],source:'Starter directory'}));
  }
  workspace.projects.push(p);
  generate(workspace,p,false);
  return {revision:0,active:workspace.id,workspaces:[workspace]};
}
const defaultCap=(p,ch)=>ch==='Email'?p.mailboxes.filter(m=>m.enabled).reduce((n,m)=>n+m.cap,0):p.configs[ch].cap;
export function handles(l,ch){
  const key=ch==='Email'?'email':ch==='LinkedIn'?'linkedin':'';
  const direct=key?l.contacts.filter(c=>c[key]).map(c=>({value:c[key],name:c.name})):[];
  if(l.channels[ch])direct.push({value:l.channels[ch],name:l.name});
  return [...new Map(direct.map(h=>[h.value.toLowerCase(),h])).values()];
}
function assignmentAllowed(ws,p,lead,row){
 const key=handleKey(row.channel,row.handle);
 return contactAllowed(ws,p,lead,row.channel,row.handle)&&
  handles(lead,row.channel).some(h=>handleKey(row.channel,h.value)===key)&&
  (!row.mailbox||p.mailboxes.some(m=>m.id===row.mailbox&&m.enabled&&m.cap>0));
}

export function reconcileAssignments(state){
 let changed=false;
 for(const ws of state.workspaces){
  const day=today(ws.timezone);
  for(const p of ws.projects){
   const leads=new Map(p.leads.map(l=>[l.id,l]));
   const rows=p.assignments.filter(a=>a.day===day);
   const byChannel=new Map(CHANNELS.map(ch=>[ch,rows.filter(a=>a.channel===ch&&touched(a)).length]));
   const byMailbox=new Map(p.mailboxes.map(m=>[m.id,rows.filter(a=>a.mailbox===m.id&&touched(a)).length]));
   p.assignments=p.assignments.filter(a=>{
    if(a.day!==day||touched(a))return true;
    const used=byChannel.get(a.channel);
    const mailbox=p.mailboxes.find(m=>m.id===a.mailbox);
    const usedInMailbox=byMailbox.get(a.mailbox);
    if(!assignmentAllowed(ws,p,leads.get(a.leadId),a)||used>=defaultCap(p,a.channel)||
      (a.channel==='Email'&&(!mailbox||usedInMailbox>=mailbox.cap))){
     changed=true;
     return false;
    }
    if(a.assignee&&!ws.members.some(m=>m.id===a.assignee&&m.status==='Active'&&p.agents.includes(m.id))){
     a.assignee='';
     changed=true;
    }
    byChannel.set(a.channel,used+1);
    if(mailbox)byMailbox.set(mailbox.id,usedInMailbox+1);
    return true;
   });
  }
 }
 return changed;
}
const audit=(ws,p,type,detail={})=>{
  const e={id:id(),at:now(),project:p?.id||'',type,...detail};
  ws.audit.unshift(e);
  if(p)p.history.unshift(e);
};
export function recordJevFit(workspace,project,lead,fit){
  lead.jevFit=fit;
  audit(workspace,project,'Jev fit scored',{leadId:lead.id,score:fit.score,model:fit.model});
}
const touched=a=>a.marks.some(x=>MARKS.includes(x));
function agentFor(ws,p,channel,rows){
 const eligible=ws.members.filter(m=>m.status==='Active'&&p.agents.includes(m.id));
 if(!p.autoAssign||!eligible.length)return '';
 if(p.split==='Fixed quotas'){
   return eligible.find(m=>rows.filter(a=>a.assignee===m.id).length<(p.quotas?.[m.id]?.[channel]||0))?.id||'';
 }
 return [...eligible].sort((a,b)=>rows.filter(r=>r.assignee===a.id).length-rows.filter(r=>r.assignee===b.id).length)[0].id;
}
export function runDaily(state){
 let changed=false;
 for(const ws of state.workspaces){
  const localHour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:ws.timezone,hour:'2-digit',hourCycle:'h23'}).format(new Date()));
  const date=today(ws.timezone);
  if(localHour<6)continue;
  for(const p of ws.projects){
   if(p.lastGeneratedDay===date)continue;
   generate(ws,p,false);
   changed=true;
  }
 }
 return changed;
}
function generate(ws,p,replace){
  const day=today(ws.timezone);
  if(replace)p.assignments=p.assignments.filter(a=>a.day!==day||touched(a));
  p.lastGeneratedDay=day;
  for(const ch of CHANNELS){
    const cfg=p.configs[ch];
    if(!cfg.enabled)continue;
    const cap=defaultCap(p,ch);
    const rows=p.assignments.filter(a=>a.day===day&&a.channel===ch);
    const age=stamp=>(Date.now()-Date.parse(stamp))/86400000;
    const sorted=[...p.leads].sort((a,b)=>{
      const weight=l=>l.segment?cfg.priority.indexOf(l.segment):3;
      return weight(a)-weight(b)||(b.score??0)-(a.score??0);
    });
    for(const lead of sorted){
      if(rows.length>=cap)break;
      if(lead.notFit||['Lost','Churned'].includes(lead.lifecycle)||rows.some(a=>a.leadId===lead.id))continue;
      const history=p.assignments.filter(a=>a.leadId===lead.id&&touched(a));
      const touches=history.filter(a=>a.channel===ch&&a.marks.includes('Attempted'));
      if(history.some(a=>a.marks.includes('Replied')||a.marks.includes('Opt-out'))||touches.length>=cfg.touches||
        history.some(a=>a.at&&age(a.at)<(a.channel===ch?Math.max(p.globalCooldown,cfg.cooldown):p.globalCooldown)))continue;
      const handle=handles(lead,ch).find(h=>contactAllowed(ws,p,lead,ch,h.value));
      if(!handle)continue;
      const boxes=p.mailboxes.filter(m=>m.enabled&&rows.filter(a=>a.mailbox===m.id).length<m.cap);
      const mailbox=ch==='Email'?[...boxes].sort((a,b)=>rows.filter(r=>r.mailbox===a.id).length-rows.filter(r=>r.mailbox===b.id).length)[0]?.id||'':'';
      if(ch==='Email'&&!mailbox)continue;
      const assignment={id:id(),leadId:lead.id,day,channel:ch,handle:handle.value,person:handle.name,mailbox,marks:[],at:null,
        assignee:agentFor(ws,p,ch,rows)};
      rows.push(assignment);p.assignments.push(assignment);
    }
  }
}
function mergeContacts(lead,contacts,warnings){
 let changed=false;
 for(const contact of contacts){
  const profile=handleKey('LinkedIn',contact.linkedin);
  const sameName=c=>c.name.trim().toLowerCase()===contact.name.trim().toLowerCase();
  const matches=lead.contacts.filter(c=>{
   const existingProfile=handleKey('LinkedIn',c.linkedin);
   if(profile&&profile===existingProfile)return true;
   if(!sameName(c))return false;
   return (!c.email||!contact.email||c.email===contact.email)&&(!existingProfile||!profile||existingProfile===profile);
  });
  if(matches.length!==1){
   if(matches.length===0){lead.contacts.push(contact);changed=true;}
   else warnings.push('Ambiguous contact match. Existing contacts kept');
   continue;
  }
  const [existing]=matches;
  if(contact.email&&existing.email&&contact.email!==existing.email)warnings.push('Different contact email. Existing email kept');
  for(const field of ['title','email','linkedin','source']){
   if(!existing[field]&&contact[field]){existing[field]=contact[field];changed=true;}
  }
 }
 return changed;
}

function importedLead(ws,raw,domain){
 const warnings=[];
 const website=[raw.website,raw.domain].find(url=>typeof url==='string'&&cleanDomain(url)===domain);
 const validWebsite=website?new URL(/^https?:\/\//i.test(website.trim())?website.trim():'https://'+website.trim()).href:'';
 const input={...raw,domain,website:validWebsite||'https://'+domain};
 if(raw.website&&cleanDomain(raw.website)!==domain)warnings.push('Website ignored because it does not match the company domain');
 const lead=newLead({...input,contacts:[]});
 for(const channel of CHANNELS){
  const supplied=raw.channels?.[channel]??(channel==='Email'?raw.email:channel==='LinkedIn'?raw.linkedin:'');
  if(supplied&&!handleKey(channel,lead.channels[channel])){
   delete lead.channels[channel];warnings.push('Invalid '+channel+' handle ignored');
  }
  if(lead.channels[channel]&&isSuppressed(ws,lead,channel,lead.channels[channel])){
   delete lead.channels[channel];warnings.push('Blocked '+channel+' handle ignored');
  }
 }
 lead.contacts=[];
 for(const contact of raw.contacts||[]){
  const parsed=newContact(contact);
  if(!parsed.name){warnings.push('Contact missing a name');continue;}
  if((parsed.email&&isSuppressed(ws,lead,'Email',parsed.email))||
    (parsed.linkedin&&isSuppressed(ws,lead,'LinkedIn',parsed.linkedin))){
   warnings.push('Blocked contact ignored');
   continue;
  }
  if(contact.email&&!parsed.email)warnings.push('Invalid contact email ignored');
  if(contact.linkedin&&!parsed.linkedin)warnings.push('Invalid contact LinkedIn URL ignored');
  mergeContacts(lead,[parsed],warnings);
 }
 return {lead,warnings:[...new Set(warnings)]};
}

function processImport(ws,p,rows,preview=false){
 if(!Array.isArray(rows)||!rows.length||rows.length>1000)invalid('Provide between 1 and 1,000 import rows.');
 const seen=new Map(p.leads.map(l=>[l.domain,preview?structuredClone(l):l]));
 const erased=new Set(p.history.filter(entry=>entry.type==='erase').map(entry=>entry.leadId));
 const summary={added:0,duplicates:0,updated:0,skipped:0,warnings:0};
 const review=[];
 for(const [index,raw] of rows.entries()){
  if(!isRecord(raw))invalid('Import record '+(index+1)+' must be an object.');
  if(raw.contacts!==undefined&&(!Array.isArray(raw.contacts)||raw.contacts.length>200||raw.contacts.some(c=>!isRecord(c)))){
   invalid('Import record '+(index+1)+' must contain up to 200 valid contact objects.');
  }
  if(raw.inputError){
   summary.skipped++;
   if(preview)review.push({record:index+1,name:tidy(raw.name,140),domain:tidy(raw.domain,300),status:'skipped',reason:tidy(raw.inputError,140),warnings:[]});
   continue;
  }
  const domain=typeof raw.domain==='string'?cleanDomain(raw.domain):'';
  const existing=seen.get(domain);
  let reason='',status='skipped',warnings=[];
  if(!domain)reason=tidy(raw.domain)?'Invalid company domain':'Missing company domain';
  else if(isSuppressed(ws,{domain},'Domain',domain))reason='Company domain is on the do-not-contact list';
  else if(existing&&(existing.erasedAt||erased.has(existing.id)))reason='Personal data was erased for this company';
  else if(!existing&&seen.size>=p.maxLeads)reason='Project lead limit reached';
  else{
   const candidate=importedLead(ws,raw,domain);
   const {lead}=candidate;
   warnings=candidate.warnings;
   if(existing){
    let changed=mergeContacts(existing,lead.contacts,warnings);
    for(const [channel,value] of Object.entries(lead.channels)){
     if(!existing.channels[channel]){existing.channels[channel]=value;changed=true;}
    }
    for(const field of ['country','category','description',...Object.keys(companyProfileLimits)]){
     if(!existing[field]&&lead[field]){existing[field]=lead[field];changed=true;}
    }
    status=changed?'updated':'duplicate';
    reason=changed?'Adds details to the existing lead':'Existing lead kept';
   }else{
    status='added';
    reason='New lead';
    seen.set(domain,lead);
    if(!preview)p.leads.push(lead);
   }
  }
  if(status==='updated'||status==='duplicate')summary.duplicates++;
  if(status!=='duplicate')summary[status]++;
  if(warnings.length)summary.warnings++;
  if(preview)review.push({record:index+1,name:tidy(raw.name,140)||domain,domain:domain||tidy(raw.domain,300),status,reason,warnings:[...new Set(warnings)]});
 }
 return {...summary,...(preview?{rows:review}:{})};
}

function importRows(ws,p,input,kind){
 const rows=Array.isArray(input.rows)?input.rows.map(row=>isRecord(row)?{...row,leadSource:tidy(row.leadSource,140)||kind,source:tidy(row.source,400)||kind}:row):input.rows;
 const summary=processImport(ws,p,rows);
 const rec={id:id(),at:now(),label:tidy(input.label,180)||kind,...summary};
 if(input.batchId){rec.batchId=input.batchId;rec.batchHash=input.batchHash;}
 (kind==='Find leads'?p.searches:p.imports).unshift(rec);
 audit(ws,p,kind,rec);
 return rec;
}
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

export function perform(state,type,input={}){
  if(!isRecord(input))invalid('Provide action details as an object.');
  const ws=byId(state.workspaces,input.workspace||state.active,'Workspace unavailable.');
  if(type==='workspace-select'){state.active=ws.id;return {};}
  const p=input.project?byId(ws.projects,input.project,'Project unavailable.'):null;
  const l=input.lead&&p?byId(p.leads,input.lead,'Lead unavailable.'):null;
  const project=()=>p||invalid('Select a project.');
  const lead=()=>l||invalid('Select a lead.');
  if(type==='workspace-add'){
    const name=tidy(input.name,80);if(!name)invalid('Enter a workspace name.');
    const slug=tidy(String(input.slug||'').toLowerCase(),80).replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'');
    const key=slug||name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||id();
    if(state.workspaces.some(x=>x.id===key))invalid('That workspace already exists.',409);
    const members=[structuredClone(ws.members[0])];
    for(const inv of Array.isArray(input.invites)?input.invites:[]){
      const email=normalizeEmail(isRecord(inv)?inv.email:inv);if(!email||members.some(m=>m.email===email))continue;
      members.push({id:id(),name:email.split('@')[0],email,role:isRecord(inv)&&inv.role==='Admin'?'Admin':'Agent',status:'Pending'});
    }
    state.workspaces.push({id:key,name,timezone:ws.timezone,members,projects:[],suppressions:[],audit:[],exports:[],cookie:'',searches:0});
    state.active=key;return {workspace:key};
  }
  if(type==='workspace-settings'||type==='account'){
    const name=tidy(input.name,80),tz=tidy(input.timezone,80);
    if(!name)invalid('Name is required.');
    try{new Intl.DateTimeFormat('en',{timeZone:tz}).format();}catch{invalid('Choose a valid time zone.');}
    if(type==='workspace-settings'){ws.name=name;ws.timezone=tz;}
    else{Object.assign(ws.members[0],{name,timezone:tz,phone:tidy(input.phone,45),email:normalizeEmail(input.email)});}
    return {};
  }
  if(type==='cookie'){ws.cookie=input.value==='accepted'?'accepted':'necessary';return {};}
  if(type==='invite'){
    const email=normalizeEmail(input.email);if(!email)invalid('Enter a valid email address.');
    if(ws.members.some(m=>m.email===email))invalid('That person is already listed.',409);
    ws.members.push({id:id(),name:email.split('@')[0],email,role:input.role==='Admin'?'Admin':'Agent',status:'Pending'});
    audit(ws,null,'Invitation recorded',{email});return {};
  }
  if(type==='member-status'){
    const m=byId(ws.members,input.member,'Member unavailable.');if(m.role==='Owner')invalid('The owner is always active.');
    m.status=input.status==='Active'?'Active':'Pending';return {};
  }
  if(type==='member-role'){
    const m=byId(ws.members,input.member,'Member unavailable.');if(m.role==='Owner')invalid('The owner role is fixed.');
    m.role=input.role==='Admin'?'Admin':'Agent';return {};
  }
  if(type==='suppress'){
    const added=addSuppression(ws,tidy(input.value,350),tidy(input.kind,30),tidy(input.reason,80)||'Added by admin');return {added};
  }
  if(type==='unsuppress'){
    byId(ws.suppressions,input.id,'Entry unavailable.').removedAt=now();audit(ws,null,'Suppression removed');return {};
  }
  if(type==='project-add'){
    if(ws.projects.length>=5)invalid('This workspace has reached its five-project limit.');
    const created=makeProject(input,ws.members);ws.projects.push(created);return {project:created.id};
  }
  project();
  if(type==='lead-add'){
    if(p.leads.length>=p.maxLeads)invalid('Project limit reached.');
    if(input.contacts!==undefined&&(!Array.isArray(input.contacts)||input.contacts.some(c=>!isRecord(c))))invalid('Each contact must be an object.');
    const item=newLead(input);
    if(p.leads.some(x=>x.domain===item.domain))invalid('A lead for this domain already exists.',409);
    if(isSuppressed(ws,item,'Domain',item.domain))invalid('That domain is on the do-not-contact list.');
    p.leads.push(item);audit(ws,p,'Lead added',{leadId:item.id});return {lead:item.id};
  }
  if(type==='import-preview')return processImport(ws,p,input.rows,true);
  if(type==='import'||type==='find-add')return importRows(ws,p,input,type==='import'?'Import':'Find leads');
  if(type==='targeting'){
    const a=count(input.a,100),b=count(input.b,100);if(a<b)invalid('The A threshold must be at least the B threshold.');
    if(list(input.signals,50).some(x=>!isRecord(x)))invalid('Each targeting signal must be an object.');
    p.targeting={website:tidy(input.website,350),offer:tidy(input.offer,6000),ideal:tidy(input.ideal,6000),guidelines:tidy(input.guidelines,6000),a,b,
      signals:list(input.signals,50).map(x=>({text:tidy(x.text,140),weight:Math.max(-100,Math.min(100,Number(x.weight)||0))})).filter(x=>x.text),
      roles:list(input.roles,50).map(x=>tidy(x,120)).filter(Boolean)};
    return {};
  }
  if(type==='project-limit'){p.maxLeads=Math.max(p.leads.length,1,count(input.limit,1000));return {};}
  if(type==='channels'){
    if(list(input.mailboxes,30).some(m=>!isRecord(m)))invalid('Each mailbox must be an object.');
    for(const ch of CHANNELS){
      const c=input.configs?.[ch];if(!c)continue;
      const priority=list(c.priority,3).filter(x=>['A','B','C'].includes(x));
      p.configs[ch]={enabled:!!c.enabled,cap:count(c.cap,1000),cooldown:count(c.cooldown,365),touches:count(c.touches,50),corporate:!!c.corporate,
        priority:new Set(priority).size===3?priority:['A','B','C']};
    }
    p.mailboxes=list(input.mailboxes,30).map(m=>({id:tidy(m.id,35)||id(),email:normalizeEmail(m.email),cap:count(m.cap,1000),enabled:!!m.enabled})).filter(m=>m.email);
    p.mailboxes=[...new Map(p.mailboxes.map(m=>[m.email,m])).values()];
    return {};
  }
  if(type==='agents'){
    p.agents=list(input.agents,100).filter(x=>ws.members.some(m=>m.id===x&&m.status==='Active'));
    p.autoAssign=!!input.autoAssign;p.split=input.split==='Fixed quotas'?'Fixed quotas':'Auto-balance';p.globalCooldown=count(input.globalCooldown,365);
    p.quotas=Object.fromEntries(ws.members.map(m=>[m.id,Object.fromEntries(CHANNELS.map(ch=>[ch,count(input.quotas?.[m.id]?.[ch],1000)]))]));
    return {};
  }
  if(type==='worklist'){generate(ws,p,!!input.replace);audit(ws,p,input.replace?'Worklist regenerated':'Worklist topped up');return {};}
  if(type==='reassign'){
    const current=p.assignments.filter(a=>a.day===today(ws.timezone));
    for(const a of current.filter(a=>!touched(a)))a.assignee='';
    for(const a of current.filter(a=>!touched(a)))a.assignee=agentFor(ws,p,a.channel,current.filter(r=>r.channel===a.channel&&r!==a));
    return {};
  }
  if(type==='assign'||type==='mark'){
    const row=byId(p.assignments,input.assignment,'Assignment unavailable.');
    if(type==='assign'){
      const target=tidy(input.assignee,50);
      if(target&&!ws.members.some(m=>m.id===target&&m.status==='Active'&&p.agents.includes(m.id)))invalid('That agent is not active on this project.');
      row.assignee=target;
    }else mark(ws,p,row,input.mark);
    return {};
  }
  lead();
  if(type==='lead-edit'){
    const domain=cleanDomain(input.domain);if(!domain)invalid('Enter a valid company domain.');
    if(p.leads.some(x=>x.id!==l.id&&x.domain===domain))invalid('This domain already belongs to another lead.',409);
    if(domain!==l.domain){delete l.fitReview;delete l.jevFit;}
    Object.assign(l,{name:tidy(input.name,140)||domain,domain,country:tidy(input.country,100),category:tidy(input.category,120),description:tidy(input.description,8000)});
    for(const [key,limit] of Object.entries(companyProfileLimits)){
      if(Object.hasOwn(input,key))l[key]=tidy(input[key],limit);
    }
    if(Object.hasOwn(input,'fitReview')){
      if(l.erasedAt)invalid('A review cannot be recorded for an erased lead.');
      l.fitReview=cleanFitReview(input.fitReview);
    }
  }else if(type==='lifecycle'){
    if(LIFECYCLE.includes(input.value))l.lifecycle=input.value;
    if(input.ltv!=null)l.ltv=count(input.ltv,1_000_000_000);
  }else if(type==='fit'){l.notFit=!!input.value;}
  else if(type==='channel-edit'){
    if(!CHANNELS.includes(input.channel))invalid('Channel unavailable.');
    const value=cleanHandle(input.channel,input.value);
    if(tidy(input.value)&&!value)invalid('Enter a valid handle for this channel.');
    if(value)l.channels[input.channel]=value;else delete l.channels[input.channel];
  }else if(type==='contact-add'||type==='contact-edit'){
    const c=newContact(input);if(!c.name)invalid('Enter a contact name.');
    if(type==='contact-edit'){
      const existing=byId(l.contacts,input.contact,'Contact unavailable.');
      if(existing.email!==c.email)delete existing.emailSource;
      Object.assign(existing,{...c,id:input.contact});
    }
    else l.contacts.push(c);
  }else if(type==='save-lima-email'){
    const contact=byId(l.contacts,input.contact,'Contact unavailable.');
    if(l.erasedAt||contact.email||contact.name!==input.expectedName||l.domain!==input.expectedDomain){
      invalid('The contact or company changed. Review the current record.',409);
    }
    const email=normalizeEmail(input.email),domain=email.split('@').at(-1);
    if(!email||(domain!==l.domain&&!domain.endsWith('.'+l.domain)))invalid('The email does not match the company domain.');
    contact.email=email;
    contact.emailSource='LimaData';
  }else if(type==='note'){
    const text=tidy(input.text,8000);if(!text)invalid('Enter a note.');
    l.notes.unshift({id:id(),text,channel:tidy(input.channel,30)||'General',at:now(),author:ws.members[0].name});
  }else if(type==='draft'){
    if(!CHANNELS.includes(input.channel))invalid('Channel unavailable.');
    l.drafts[input.channel]={subject:tidy(input.subject,300),body:tidy(input.body,10000),at:now()};
  }else if(type==='erase'){
    if(input.confirm!=='ERASE')invalid('Type ERASE to confirm.');
    for(const ch of CHANNELS)for(const h of handles(l,ch)){
     if(handleKey(ch,h.value))addSuppression(ws,h.value,ch,'Erasure request');
    }
    l.contacts=[];l.channels={};l.notes=[];l.drafts={};l.notFit=true;
    delete l.fitReview;
    delete l.jevFit;
    l.description='';l.source='';l.website='https://'+l.domain;l.erasedAt=now();
    p.enrichments=p.enrichments.filter(entry=>entry.leadId!==l.id);
    for(const a of p.assignments.filter(a=>a.leadId===l.id)){a.handle='';a.person='';if(!a.marks.includes('Opt-out'))a.marks.push('Opt-out');}
  }else if(type==='lead-mark'){
    const ch=input.channel;
    if(!CHANNELS.includes(ch))invalid('Channel unavailable.');
    const day=today(ws.timezone);
    const options=handles(l,ch);
    const handle=(input.mark==='Attempted'?options.filter(h=>contactAllowed(ws,p,l,ch,h.value)):options)[0];
    if(!handle)invalid('This lead has no available handle for that channel.');
    let a=p.assignments.find(x=>x.leadId===l.id&&x.channel===ch&&x.day===day);
    if(!a){a={id:id(),leadId:l.id,day,channel:ch,handle:handle.value,person:handle.name,marks:[],at:null,assignee:'owner'};p.assignments.push(a);}
    mark(ws,p,a,input.mark);return {};
  }else if(type==='enrich-record'){
    if(input.expectedDomain&&input.expectedDomain!==l.domain)invalid('The company domain changed during enrichment.',409);
    const desc=tidy(input.description,8000);
    const source=tidy(input.source,400);
    const url=URL.parse(source);
    if(!desc||!url||!['http:','https:'].includes(url.protocol))invalid('Enter findings and a valid source URL.');
    const provider=input.provider==='firecrawl'?'Firecrawl v2':input.provider==='perplexity'?'Perplexity':'';
    if(provider&&(l.erasedAt||input.expectedDomain!==l.domain||url.username||url.password||cleanDomain(url.hostname)!==l.domain)){
      invalid('The research source no longer matches this company.',409);
    }
    if(!l.description)l.description=desc;
    p.enrichments.unshift({id:id(),leadId:l.id,domain:l.domain,at:now(),source,findings:desc,...(provider?{provider}:{})});
  }else invalid('Unknown action.',404);
  audit(ws,p,type,{leadId:l.id});return {};
}
function mark(ws,p,row,value){
  if(!MARKS.includes(value))invalid('Unknown mark.');
  if(row.marks.includes(value))return;
  const l=byId(p.leads,row.leadId,'Lead unavailable.');
  if(value==='Attempted'&&!assignmentAllowed(ws,p,l,row))invalid('This assignment is no longer available for outreach.');
  row.marks.push(value);row.at=now();
  if(value==='Replied'&&l.lifecycle==='Prospect')l.lifecycle='Engaged';
  if(['Opt-out','Bounce','Invalid handle'].includes(value)&&row.handle)addSuppression(ws,row.handle,row.channel,value);
  audit(ws,p,value,{leadId:l.id,channel:row.channel,assignee:row.assignee});
}
function addSuppression(ws,raw,kind,reason){
  const value=kind==='Domain'?cleanDomain(raw):tidy(raw,350).toLowerCase();
  const key=handleKey(kind,value);
  if(!key)invalid('Enter a valid suppression value.');
  const type=suppressionKind(kind);
  if(ws.suppressions.some(x=>!x.removedAt&&suppressionKind(x.kind)===type&&handleKey(x.kind,x.value)===key))return false;
  ws.suppressions.unshift({id:id(),value,kind:type,reason,at:now(),removedAt:null});
  audit(ws,null,'Suppression added',{reason});return true;
}

