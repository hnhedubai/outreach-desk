import {e,go,link,btn,header,card,empty,form,field,area,check,select,todayRows,channels,icon,labels,menus,worked,ext,initialOf,glyphStyle} from './ui.js';
import {workspacePage,quoteTrail} from './workspace.js';
import {projectPage} from './project.js';
import {leadPage,newProjectPage,findPage,importPage,leadFields,personFields} from './flow.js';
import {parseCsv,parseWorkbook} from './spreadsheet.js';
import {safeHref} from './sanitize.js';

const app=document.querySelector('#app'),dialog=document.querySelector('#dialog'),toast=document.querySelector('#toast');
let state,authenticated=false,webSearch=false,jevAvailable=false,firecrawlAvailable=false,perplexityAvailable=false,limaAvailable=false,reoonAvailable=false,mail=null,ui={},menu='',busy=false,noticeTimer,navCollapsed=false;
const workspace=()=>state.workspaces.find(x=>x.id===state.active)||state.workspaces[0];
function route(){
 const parts=location.pathname.split('/').filter(Boolean).map(x=>{try{return decodeURIComponent(x);}catch{return x;}});
 const ws=workspace(),hasProject=parts[0]==='p',p=hasProject?ws.projects.find(x=>x.id===parts[1]):null;
 const page=(hasProject?parts[2]:parts[0])||'home';
 const lead=page==='lead'&&p?p.leads.find(l=>l.id===parts[3]):null;
 return {ws,p,page,lead,tab:parts[4]||'channels',badProject:hasProject&&!p};
}
// Client-side routing over the History API. navigate() pushes a real path (no '#') and
// re-renders; onLocationChange() resets per-route UI and is shared by navigate() and the
// popstate handler (back/forward). Keeping it in one place mirrors the old hashchange flow.
function onLocationChange(){
 const r=route(),keepImport=r.page==='import';
 const prior=ui;ui=keepImport?{importOpen:prior.importOpen}:{};menu='';
 // Entering Thread folds the left nav to the icon rail so the mail panes get width.
 if(r.page==='thread')navCollapsed=true;
 if(dialog.open)dialog.close();
 render({keepScroll:false});
}
function navigate(path){
 const target=String(path||'').split('#')[0];
 if(!target||target==='/')return;
 if(location.pathname===target)return;
 history.pushState({},'',target);
 onLocationChange();
}
const person=ws=>ws.members[0];
const labelOf=r=>r.page==='lead'?r.lead?.name||'Lead':r.page==='thread'?'':labels[r.page]||({home:'Home',team:'Team',thread:'Thread',dnc:'Do-not-contact',settings:'Settings',usage:'Usage & limits',audit:'Audit export',apps:'Apps',new:'New project',account:'Account settings',agent:'Agent mode'})[r.page]||'Home';
const nav=(name,page,path,active,sub=false)=>'<a class="nav-item '+(active?'active ':'')+(sub?'sub':'')+'" href="'+e(path)+'" title="'+e(name)+'">'+(sub?'':icon(page))+'<span class="nav-name">'+e(name)+'</span></a>';
const projectNav=(ws,current)=>ws.projects.map(p=>{
 const expanded=current?.id===p.id;
 const num=todayRows(ws,p).filter(a=>!worked(a)).length;
  return '<a class="nav-item'+(expanded?' active':'')+'" href="'+go('today',p.id)+'"><span class="project-icon"><span class="glyph" style="'+glyphStyle(initialOf(p.name))+'">'+e(initialOf(p.name))+'</span></span><span class="nav-name">'+e(p.name)+'</span><span class="nav-badge">'+num+'</span></a>'+
 (expanded?menus.map(([label,key])=>nav(label,key,go(key,p.id),route().page===key||(key==='leads'&&route().page==='lead'),true)).join(''):'');
}).join('');
function shell(r,body){
 const {ws,p,page}=r,me=person(ws),n=p?todayRows(ws,p).filter(a=>a.assignee===me.id&&!worked(a)).length:0;
 const workspaceMenu=menu==='workspace'?'<div class="dropdown"><div class="nav-label">Workspaces</div>'+state.workspaces.map(w=>btn(w.name,'workspace-select',w.id===ws.id?'active':'',{'data-id':w.id})).join('')+btn('Add workspace','dialog','',{'data-kind':'workspace-add'})+'</div>':'';
 const accountMenu=menu==='account'?'<div class="dropdown"><div class="nav-label">'+e(me.name)+'</div>'+link('Account settings',go('account'),'')+
 btn('Change password','dialog','',{'data-kind':'password-change'})+btn('Cookie settings','dialog','',{'data-kind':'cookie'})+btn('Sign out','logout','subtle')+'</div>':'';
  const wsItems=[['Home','home'],['Team','team'],['Thread','thread'],['Do-not-contact','dnc'],['Settings','settings'],['Apps','apps']];
 const actions=p&&page!=='agent'?'<button type="button" class="btn notify" data-action="enrichment-menu"><span class="enriched-check" aria-hidden="true">✓</span>Enriched <span>'+p.enrichments.length+'</span></button><a class="btn primary agent-entry" href="'+go('agent',p.id)+'">Agent mode <span class="agent-count">'+n+' mine</span></a>':'';
 return '<div class="shell'+(navCollapsed?' collapsed':'')+'"><div class="brand-head"><button type="button" class="brand" data-action="menu" data-value="workspace" aria-expanded="'+(menu==='workspace')+'"><span class="logo"><img class="logo-img" src="/icon-192.png" alt="" width="28" height="28"></span>'+'<span class="brand-name">'+e(ws.name)+'</span>'+icon('down')+'</button>'+workspaceMenu+'</div>'+
 '<header class="topbar"><div class="crumb">'+btn('☰','mobile-menu','subtle',{id:'menu-toggle','aria-label':navCollapsed?'Expand navigation':'Collapse navigation',title:navCollapsed?'Expand navigation':'Collapse navigation'})+
  (page==='thread'?'':link(ws.name,go('home'),'')+' <span>/</span> '+(p?link(p.name,go('overview',p.id),'')+' <span>/</span> ':'')+e(labelOf(r)))+'</div><div class="head-actions">'+actions+'</div></header>'+
 '<aside class="sidebar '+(ui.mobile?'open':'')+'"><nav class="nav-scroll" aria-label="Main navigation">'+wsItems.map(([name,key])=>nav(name,key,go(key),!p&&(page===key||(key==='settings'&&['usage','audit'].includes(page))))).join('')+
 '<div class="nav-label">Projects</div>'+projectNav(ws,p)+nav('+ New project','plus',go('new'),page==='new')+'</nav>'+
 '<button class="account" data-action="menu" data-value="account" aria-expanded="'+(menu==='account')+'"><span class="avatar"><span class="glyph" style="'+glyphStyle(initialOf(me.name))+'">'+e(initialOf(me.name))+'</span></span><span class="account-meta"><b>'+e(me.name)+'</b><small class="muted">'+e(me.role)+'</small></span><span class="dots">···</span></button>'+accountMenu+'</aside>'+
 '<main class="main page-'+e(page)+'" id="main"><div class="wrap">'+body+'</div></main></div>';
}
const renderErrorMessage='Something went wrong. Reload the page.';
function fallbackView(){
 try{
  if(!app)throw Error('The application root is unavailable.');
  const card=document.createElement('section');
  card.className='card error-card';
  card.innerHTML='<h1>'+e('Something went wrong')+'</h1><p>'+e('The page could not be rendered. Reload the app to recover.')+'</p>';
  const reload=document.createElement('button');
  reload.type='button';reload.className='btn primary';reload.innerHTML=e('Reload');
  reload.addEventListener('click',()=>location.reload());
  card.append(reload);
  app.replaceChildren(card);
 }catch(fallbackError){
  console.error(fallbackError);
  if(app)app.textContent='Vitalise hit an unexpected error. Reload the page.';
 }
}
function reportUiError(error){
 console.error(error);
 try{notify(renderErrorMessage,true);}catch(notifyError){console.error(notifyError);}
 fallbackView();
}
function render({keepScroll=true,restoreInput}={}){
 if(!state)return;
 try{
  const r=route();
  const previous=app.querySelector('.main')?.scrollTop||0,side=app.querySelector('.nav-scroll')?.scrollTop||0;
  let content='';
  if(r.badProject)content=header('Project unavailable','Choose a project from the sidebar.');
   else if(r.page==='lead')content=r.lead?leadPage(r.ws,r.p,r.lead,r.tab,ui,{jevAvailable,firecrawlAvailable,perplexityAvailable,limaAvailable,reoonAvailable}):header('Lead unavailable');
  else if(r.page==='find'||r.page==='import'){
   content=!r.p?header('Page unavailable','Choose a project from the sidebar.'):
    r.page==='find'?findPage(r.ws,r.p,ui,{webSearch,firecrawlAvailable,perplexityAvailable}):importPage(r.ws,r.p,ui);
  }
  else if(r.page==='new')content=newProjectPage(r.ws,ui);
  else if(r.p)content=projectPage(r.page,r.ws,r.p,ui);
   else content=workspacePage(r.page,r.ws,ui,state,{webSearch,jevAvailable,firecrawlAvailable,perplexityAvailable,limaAvailable,mail});
  app.innerHTML=shell(r,content||header('Page unavailable','Use the sidebar to continue.'));
  if(keepScroll)app.querySelector('.main').scrollTop=previous;
  app.querySelector('.nav-scroll').scrollTop=side;
  if(restoreInput){
   const input=app.querySelector('[data-input="'+CSS.escape(restoreInput.key)+'"]');
   if(input){input.focus({preventScroll:true});try{input.setSelectionRange(restoreInput.start,restoreInput.end);}catch{}}
  }
  document.title=labelOf(r)+' · Vitalise';
 }catch(error){
  console.error(error);
  try{notify(renderErrorMessage,true);}catch(notifyError){console.error(notifyError);}
  fallbackView();
 }
}
function notify(text,error=false){
 toast.textContent=text;toast.className='show'+(error?' error':'');clearTimeout(noticeTimer);
 noticeTimer=setTimeout(()=>{toast.className='';},5200);
}
function loginPage(message=''){
 return '<main class="auth-page"><section class="auth-card"><div class="auth-brand"><span class="logo"><img class="logo-img" src="/icon-192.png" alt="" width="28" height="28"></span><span>Vitalise</span></div>'+
 '<h1>Welcome back</h1><p class="auth-intro">Sign in to manage your projects, leads and research workspace.</p>'+
 '<form class="auth-form" data-form="login">'+field('Username','username','admin',{autocomplete:'username',required:true})+
 '<label>Password<div class="password-field"><input type="password" name="password" autocomplete="current-password" required><button type="button" class="password-toggle" data-action="toggle-password">Show</button></div></label>'+
 (message?'<p class="auth-error">'+e(message)+'</p>':'')+'<button class="btn primary auth-submit" type="submit">Sign in</button></form>'+
 '<p class="auth-help">Forgot your password? Run <strong>npm run reset-password</strong> in the Vitalise folder.</p></section></main>';
}
async function request(path,body){
 const res=await fetch(path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw Object.assign(new Error(data.error||'Request failed.'),{status:res.status});
 return data;
}
async function refresh(){({state,webSearch,jevAvailable,firecrawlAvailable,perplexityAvailable,limaAvailable,reoonAvailable}=await request('/api/state'));try{mail=await request('/api/mail');}catch{mail=null;}}
async function action(type,input={},options={}){
 if(busy)return;
 const r=route();busy=true;
 try{
  const context=options.context||{workspace:r.ws.id,project:r.p?.id,lead:r.lead?.id};
  const payload={...context,...input};
  const out=await request('/api/action',{type,input:payload,revision:options.revision??state.revision});
   ({state,webSearch,jevAvailable,firecrawlAvailable,perplexityAvailable,limaAvailable,reoonAvailable}=out);
  if(dialog.open&&!options.context)dialog.close();
  if(options.after)options.after(out.result);
  render();
  if(options.message!==false)notify(options.message||'Saved.');
  return out.result;
 }catch(error){
  if(error.status===409){
   try{
    await refresh();render();
    if(options.onConflict){await options.onConflict();return;}
   }catch(refreshError){notify(refreshError.message||'Could not refresh. Reload the app and try again.',true);return;}
  }
  notify(error.message,true);
 }finally{busy=false;}
}
function openDialog(kind,info={}){
 const r=route(),l=r.lead,p=r.p;
 if(kind==='workspace-add'){
  const fresh=()=>({step:1,name:'',slug:'',slugEdited:false,invites:[]});
  if(!dialog.open)ui.wsWizard=fresh();
  else if(!ui.wsWizard)ui.wsWizard=fresh();
  dialog.className='wizard';
  dialog.innerHTML=workspaceWizardHtml();
  if(!dialog.open)dialog.showModal();
  return;
 }
 let title='',content='';
 if(kind==='lead-add'||kind==='lead-edit'){title=kind==='lead-add'?'Add lead':'Edit lead details';content=form(kind,leadFields(kind==='lead-edit'?l:{}),kind==='lead-add'?'Add lead':'Save changes');}
 if(kind==='contact-add'||kind==='contact-edit'){
  const current=kind==='contact-edit'?l.contacts.find(x=>x.id===info.id):{};
  title=kind==='contact-edit'?'Edit contact':'Add person';content=form(kind,personFields(current)+hidden('contact',current?.id),kind==='contact-add'?'Add person':'Save contact');
 }
 if(kind==='project-limit'){title='Project lead limit';content=form(kind,field('Lead limit','limit',p.maxLeads,{type:'number',min:Math.max(1,p.leads.length),max:1000,required:true}));}
 if(kind==='channel-edit'){title='Edit '+info.channel+' handle';content=form(kind,hidden('channel',info.channel)+field('Handle','value',l.channels[info.channel]||''));}
 if(kind==='suppress'){title='Add do-not-contact entry';content=form(kind,'<label>Type'+select('kind',['Email','Domain','Phone','LinkedIn','Instagram'],'Email')+'</label>'+field('Address, domain or handle','value','',{required:true})+'<label>Reason'+select('reason',['Added by admin','Opt-out','Bounce','Erasure request'],'Added by admin')+'</label>','Add entry');}
  if(kind==='workspace-add'){/* handled by the 2-step wizard in workspaceWizardHtml() */}
 if(kind==='cookie'){title='Cookie settings';content='<p>Vitalise stores workspace and preference data on this computer.</p><div class="flex row-gap">'+btn('Necessary only','cookie','',{'data-value':'necessary'})+btn('Accept','cookie','primary',{'data-value':'accepted'})+'</div>';}
 if(kind==='password-change'){title='Change password';content=form(kind,field('Current password','currentPassword','',{type:'password',autocomplete:'current-password',required:true})+field('New password','newPassword','',{type:'password',autocomplete:'new-password',minlength:10,required:true})+field('Confirm new password','confirmPassword','',{type:'password',autocomplete:'new-password',minlength:10,required:true})+'<p class="small muted">Use at least 10 characters.</p>','Change password');}
 if(kind==='erase'){title='Erase personal data';content='<p>Clear contacts, outreach handles, notes, drafts, the brief and enrichment findings from '+e(l.name)+'. The company remains on the list. Suppress the removed handles to prevent future outreach.</p>'+form('erase',field('Type ERASE to confirm','confirm','',{required:true,pattern:'ERASE'}),'Erase personal data');}
 if(kind==='enrich-record'){title='Record enrichment findings';content=form(kind,field('Source URL','source','',{type:'url',required:true})+area('Findings','description','',{required:true}),'Save findings');}
 if(kind==='research-review'){
  title='Review '+info.leadSource+' findings';
  content=form('enrich-record','<p class="small">Search snippet for '+e(l.domain)+' · '+ext(info.source,'Open source')+'</p>'+
   hidden('source',info.source)+hidden('expectedDomain',info.domain)+hidden('provider',info.provider)+
   area('Findings','description',info.description,{required:true}),'Save findings');
 }
 if(kind==='lima-review'){
  title='Review LimaData email';
  content=form('save-lima-email','<p>'+e(info.expectedName)+' · '+e(info.expectedDomain)+'</p><p><strong>'+e(info.email)+'</strong></p>'+
   '<p class="small muted">LimaData match. Deliverability is unverified.</p>'+
   hidden('contact',info.contact)+hidden('expectedName',info.expectedName)+hidden('expectedDomain',info.expectedDomain)+
   hidden('email',info.email),'Save work email');
 }
 if(kind==='enrichments'){
  title='Recent enrichment';
  content=(p.enrichments.slice(0,6).map(x=>'<div class="activity"><b>'+e(x.domain)+'</b> '+link('View details',go('lead',p.id,x.leadId,'enrichment'),'btn link')+'</div>').join('')||empty('No enrichments recorded.'))+link('Import and enrichment',go('import',p.id),'btn link');
 }
  if(!title)return;
  dialog.className='';
  dialog.innerHTML='<div class="dialog-head"><h2>'+e(title)+'</h2>'+btn('Close','close-dialog','subtle')+'</div>'+content;
 if(!dialog.open)dialog.showModal();
}
const slugify=value=>String(value||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
function wsSlugInfo(slug){
 const key=String(slug||'').toLowerCase().trim();
 if(!key)return {key,state:'empty'};
 if(!/^[a-z0-9-]+$/.test(key))return {key,state:'invalid'};
 if(state.workspaces.some(x=>x.id===key))return {key,state:'taken'};
 return {key,state:'available'};
}
function wsSlugMessage(host,info){
 if(info.state==='available')return {text:host+'/'+info.key+' is available.',cls:'ok'};
 if(info.state==='taken')return {text:host+'/'+info.key+' is already taken.',cls:'bad'};
 if(info.state==='invalid')return {text:'Use only letters, numbers and dashes.',cls:'bad'};
 return {text:'Letters, numbers and dashes. Leave blank to build it from the name.',cls:'muted'};
}
function updateWizardSlug(){
 const form=dialog.querySelector('form[data-form="workspace-add-step1"]');if(!form)return;
 const w=ui.wsWizard||{},info=wsSlugInfo(w.slug),msg=wsSlugMessage(location.host||'localhost',info);
 const status=form.querySelector('[data-slug-status]');
 if(status){status.textContent=msg.text;status.className='url-status '+msg.cls;}
 const cont=form.querySelector('button[type=submit]');
 if(cont)cont.disabled=info.state==='taken'||info.state==='invalid';
}
function onDialogInput(event){
 const x=event.target,form=x.closest?.('form[data-form="workspace-add-step1"]');if(!form)return;
 const w=ui.wsWizard;if(!w)return;
 if(x.name==='name'){
  w.name=x.value;
  if(!w.slugEdited){w.slug=slugify(x.value);const s=form.querySelector('[name=slug]');if(s)s.value=w.slug;}
 }else if(x.name==='slug'){w.slugEdited=true;w.slug=x.value.toLowerCase();}
 else return;
 updateWizardSlug();
}
function collectInviteRows(){
 return [...dialog.querySelectorAll('.wizard-invite-row')].map(row=>({email:(row.querySelector('[name=inviteEmail]')?.value||'').trim().toLowerCase(),role:row.querySelector('[name=inviteRole]')?.value==='Admin'?'Admin':'Agent'}));
}
function cleanInvites(rows){
 const seen=new Set(),out=[];
 for(const r of rows||[]){const email=r.email;if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||seen.has(email))continue;seen.add(email);out.push({email,role:r.role});}
 return out;
}
async function createWorkspaceFromWizard(rows){
 const w=ui.wsWizard||{};
 await action('workspace-add',{name:w.name,slug:w.slug,invites:cleanInvites(rows||[])},{message:false,after:()=>{ui.wsWizard={step:3,name:w.name,slug:w.slug};openDialog('workspace-add');}});
}
function workspaceWizardHtml(){
 const w=ui.wsWizard,step=w.step||1;
 const host=(location.host||'localhost')+'/';
  const bullets=['Group projects, leads and outreach in one place','Invite teammates as Agents or Admins','Time zone sets when daily worklists build','API keys and limits stay inside the workspace'];
  const left='<div class="wizard-left"><div class="wizard-brand"><span class="logo"><img class="logo-img" src="/icon-192.png" alt="" width="28" height="28"></span><div><span class="wizard-brand-name">Vitalise</span><span class="wizard-brand-tag">One desk for outreach, leads and research.</span></div></div>'+
   '<div class="wizard-left-body"><h2>Set up a new workspace</h2><p>A workspace holds your projects, people, leads and research. Name it after your company or team, then invite the people who will work the lists.</p>'+
   '<ul class="wizard-bullets">'+bullets.map(b=>'<li><span class="wizard-bullet-ck">'+icon('check')+'</span><span>'+e(b)+'</span></li>').join('')+'</ul></div>'+
   '<div class="wizard-foot">© 2026 Vitalise</div></div>';
   const track='<div class="wizard-track"><i class="on"></i><i class="'+(step>=2?'on':'')+'"></i></div>';
   const progress=step<3?'<div class="wizard-progress">'+track+'<span>Step '+step+' of 2</span></div>':'';
   let right='';
   if(step===1){
    const info=wsSlugInfo(w.slug),msg=wsSlugMessage(location.host||'localhost',info);
    right='<h2>Name your workspace</h2><p class="wizard-sub">Usually your company or team. Projects, people and settings live here.</p>'+
     '<form class="form" data-form="workspace-add-step1">'+
     '<label>Workspace name<input name="name" value="'+e(w.name)+'" maxlength="80" required autocomplete="off"></label>'+
     '<label>URL<div class="url-field"><span class="url-prefix">'+e(host)+'</span><input name="slug" value="'+e(w.slug)+'" placeholder="acme" maxlength="80" autocomplete="off" spellcheck="false" aria-label="Workspace URL"></div></label>'+
     '<p class="url-status '+msg.cls+'" data-slug-status>'+e(msg.text)+'</p>'+
     '<div class="wizard-actions"><button type="submit" class="btn primary"'+(info.state==='taken'||info.state==='invalid'?' disabled':'')+'>Continue to invite your team →</button><button type="button" class="btn ghost" data-action="close-dialog">Cancel</button></div></form>';
    }else if(step===2){
     const invites=(w.invites&&w.invites.length)?w.invites:[{email:'',role:'Agent'}];
     const rows=invites.map((m,i)=>'<div class="wizard-invite-row"><label>Email<input name="inviteEmail" type="email" value="'+e(m.email)+'" placeholder="teammate@company.com" autocomplete="off"></label><label>Role'+select('inviteRole',['Agent','Admin'],m.role||'Agent')+'</label>'+(invites.length>1?'<button type="button" class="row-remove" data-action="ws-invite-remove" data-index="'+i+'" aria-label="Remove invitation">&times;</button>':'<span class="row-remove-spacer"></span>')+'</div>').join('');
     right='<h2>Invite your team</h2><p class="wizard-sub">Invite the people who will work '+e(w.name||'this workspace')+'. Admins can also manage projects, channels and settings. You can do this later too.</p>'+
      '<div class="wizard-invite-rows">'+rows+'</div>'+
      '<button type="button" class="add-another" data-action="ws-invite-another">+ Add another</button>'+
      '<form class="form" data-form="workspace-add-step2"><div class="wizard-actions"><button type="submit" class="btn primary">Finish</button><button type="button" class="btn ghost" data-action="ws-skip">Skip for now</button></div></form>';
    }else{
     right='<div class="wizard-success"><div class="wizard-success-icon">'+icon('check')+'</div><h2>'+e(w.name||'Your workspace')+' is ready</h2><p class="wizard-sub">Next, set up your first project. We’ll start by reading your website.</p>'+link('Create your first project →',go('new'),'btn primary')+'</div>';
    }
  return '<div class="wizard-body">'+left+'<div class="wizard-right"><div class="wizard-col">'+progress+right+'</div></div></div>';
}
const hidden=(name,value)=>'<input type="hidden" name="'+e(name)+'" value="'+e(value)+'">';
const values=form=>Object.fromEntries(new FormData(form));
const selfEmail=()=>String(workspace().members[0]?.email||'').toLowerCase();
// Owner's stored signature (sanitised server-side). Prefilled into brand-new compose
// bodies only; replies/forwards are built by draftFromMessage and stay untouched.
const signatureHtml=()=>String(workspace().members[0]?.signature||'');
const splitRecipients=value=>String(value||'').split(/[,\s;]+/).map(s=>s.trim()).filter(s=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
function threadForm(){
 return {to:splitRecipients(app.querySelector('.th-to')?.value),cc:splitRecipients(app.querySelector('.th-cc')?.value),
  subject:app.querySelector('.th-subject')?.value||'',bodyHtml:app.querySelector('.th-edit')?.innerHTML||''};
}
function draftFromMessage(threadId,messageId,mode){
 const thread=(workspace().threads||[]).find(x=>x.id===threadId);if(!thread)return null;
 const message=thread.messages.find(x=>x.id===messageId)||thread.messages.at(-1);
 const se=selfEmail(),seen=new Set(),to=[],cc=[];
 const push=(list,target)=>{for(const p of list||[]){const k=String(p.email||'').toLowerCase();if(!p.email||k===se||seen.has(k))continue;seen.add(k);target.push(p.email);}};
 if(mode==='reply'){push(message.direction==='out'?message.to:[message.from],to);}
 else if(mode==='replyAll'){push(message.direction==='out'?[...message.to,...message.cc]:[message.from,...message.to,...message.cc],to);}
 const raw=message.subject||thread.subject||'';
 const subject=mode==='forward'?'Fwd: '+(thread.subject||'(no subject)'):(/^(re|fwd):/i.test(raw)?raw:'Re: '+raw);
 const quoted=(mode==='reply'||mode==='replyAll')?quoteTrail(message):'';
 return {mode,threadId,messageId:message.id,leadId:thread.leadId||'',to,cc,subject,bodyHtml:quoted};
}
const isEmail=t=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
const splitRaw=value=>String(value||'').split(/[,\s;]+/).map(s=>s.trim()).filter(Boolean);
const invalidRecips=()=>[...splitRaw(app.querySelector('.th-to')?.value),...splitRaw(app.querySelector('.th-cc')?.value)].filter(t=>!isEmail(t));
function recipHint(input){
 const hint=input.closest('.th-val')?.querySelector('.th-recip-hint');if(!hint)return;
 const bad=splitRaw(input.value).filter(t=>!isEmail(t));
 if(bad.length){hint.className='th-recip-hint bad';hint.textContent='Not a valid address: '+bad.join(', ');}
 else{hint.className='th-recip-hint';hint.textContent='';}
}
function hasContent(d){if(!d)return false;const text=String(d.bodyHtml||'').replace(/<[^>]*>/g,'').replace(/&nbsp;/gi,' ').trim();return !!(d.to?.length||d.cc?.length||String(d.subject||'').trim()||text);}
// Autosave: keep the in-progress compose draft in localStorage so an accidental reload or
// navigating away doesn't lose it. The key is scoped to the active workspace, and only
// compose-mode drafts are ever restored (via the Compose button) — reply/forward drafts are
// rebuilt from their thread and must not leak into a fresh "New message".
const snapKey=()=>'vitalise.composeDraft.v1:'+(state?.active||'');let snapTimer;
function saveSnapshot(){try{const d=ui.threadDraft;if(d&&d.mode==='compose'&&hasContent(d))localStorage.setItem(snapKey(),JSON.stringify(d));}catch{}}
function loadSnapshot(){try{const d=JSON.parse(localStorage.getItem(snapKey())||'null');return d&&d.mode==='compose'&&hasContent(d)?d:null;}catch{return null;}}
function clearSnapshot(){try{localStorage.removeItem(snapKey());}catch{}}
function queueSnapshot(){clearTimeout(snapTimer);snapTimer=setTimeout(saveSnapshot,800);}
function targetDraft(data){
 const p=route().p,t=ui.targetDraft||p.targeting;
 return {...t,website:data.website,offer:data.offer,ideal:data.ideal,guidelines:data.guidelines,signals:[...t.signals],roles:[...t.roles]};
}
function channelDraft(data){
 const p=route().p,base=ui.channelDraft||{configs:p.configs,mailboxes:p.mailboxes};
 return {
  configs:Object.fromEntries(channels.map(ch=>{
   const k=ch.toLowerCase(),c=base.configs[ch];
   return [ch,{...c,priority:[...c.priority],enabled:isChecked(data,k+'-enabled'),cap:data[k+'-cap']??c.cap,cooldown:data[k+'-cooldown'],touches:data[k+'-touches'],corporate:isChecked(data,k+'-corporate')}];
  })),
  mailboxes:base.mailboxes.map((m,i)=>({...m,cap:data['boxCap-'+i],enabled:isChecked(data,'boxEnabled-'+i)}))
 };
}
function findDraft(){
 const r=route();
 return ui.find??={step:0,query:'',offer:r.p.targeting.offer,website:r.p.targeting.website,source:webSearch?'web':'local'};
}
function rowsFromGrid(grid){
 const key=value=>String(value??'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'');
 const aliases={
  domain:['companydomain','websitedomain','domain','domainname','organizationdomain','accountdomain'],
  website:['companywebsite','companyurl','website','websiteurl','websiteaddress','organizationwebsite','url','web','site'],
  name:['companyname','company','organizationname','organisationname','organization','organisation','businessname','lead','name'],
  country:['country','countryregion','region','location'],category:['category','industry','sector'],
  city:['companycity','city','locality'],platform:['websiteplatform','platform','cms'],leadSource:['leadsource','acquisitionsource','origin'],
  email:['workemail','contactemail','corporateemail','emailaddress','email'],
  linkedin:['contactlinkedin','linkedinprofile','linkedinprofileurl','linkedinurl','linkedin','linkedinhandle'],
  companyLinkedin:['companylinkedin','companylinkedinurl','companylinkedinprofile'],
  phone:['companyphone','phone','phonenumber','telephone'],instagram:['companyinstagram','instagram','instagramurl'],
  person:['contactname','fullname','contact','person','decisionmaker'],
  first:['contactfirstname','firstname','givenname'],last:['contactlastname','lastname','surname'],
  title:['designation','jobtitle','title','role'],description:['description','notes','brief'],
  source:['contactsource','sourceurl','source'],
 };
 if(!grid.length)throw Error('The spreadsheet is empty.');
 const head=grid[0].map(key);
 const indexes=Object.fromEntries(Object.entries(aliases).map(([k,labels])=>[k,labels.map(label=>head.indexOf(label)).find(i=>i>=0)??-1]));
 if(indexes.domain<0&&indexes.website<0){
  if(grid.some(row=>row.slice(1).some(value=>String(value??'').trim())))throw Error('Include a Company Domain or Website column.');
  return grid.map(row=>({domain:String(row.links?.[0]||row[0]||'').trim()}));
 }
 return grid.slice(1).map(row=>{
  const cell=k=>String(row[indexes[k]]??'').trim();
  const url=k=>String(row.links?.[indexes[k]]||cell(k)).trim();
  const domain=url('domain')||url('website');
  const name=cell('name'),person=cell('person')||[cell('first'),cell('last')].filter(Boolean).join(' ');
  const email=cell('email'),linkedin=url('linkedin'),source=url('source');
  const data={name,domain,website:url('website'),country:cell('country'),category:cell('category'),description:cell('description'),city:cell('city'),platform:cell('platform'),leadSource:cell('leadSource'),source};
  if(cell('phone')||url('instagram'))data.channels={Call:cell('phone'),Instagram:url('instagram')};
  if(row.slice(head.length).some(value=>String(value??'').trim()))data.inputError='More columns than the header. Quote fields containing separators.';
  if(person){
   data.contacts=[{name:person,title:cell('title'),email,linkedin,source}];
   data.linkedin=url('companyLinkedin');
  }else{
   data.email=email;
   data.linkedin=url('companyLinkedin')||linkedin;
  }
  return data;
 });
}

async function previewImport(view,context,draft,token){
 const out=await request('/api/import-preview',{...context,rows:draft.rows});
 if(ui!==view||view.importToken!==token)return;
 view.importData={...draft,...out.result,revision:out.revision};
 render();
}

function invalidateImport(){
 ui.importToken=(ui.importToken||0)+1;
 ui.importData=null;
 app.querySelector('[data-import-review]')?.remove();
}
function download(filename,content,type='text/csv'){
 const url=URL.createObjectURL(new Blob([content],{type}));
 const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const escapeCsv=x=>'"'+String(x??'').replace(/^[=+\-@\t\r]/,"'$&").replace(/"/g,'""')+'"';
async function searchCompanies(input){
 if(busy)return null;
 busy=true;
 try{return (await request('/api/search',input)).rows;}catch(error){notify(error.message,true);return null;}finally{busy=false;}
}
// ---- Compose rich-text engine ------------------------------------------------
// The body is a contenteditable div (.th-edit) whose innerHTML is stored as bodyHtml
// and run through sanitizeHtml on save, so only tags/attrs the sanitizer allowlists
// survive. Native <select>/<input type=color> steal focus from the editor, so we keep
// the last in-editor selection range and restore it before applying each command.
let savedRange=null;
function trackEditorSelection(){
  const sel=window.getSelection();
  if(!sel||sel.rangeCount===0)return;
  const editor=app.querySelector('.th-edit');
  if(editor&&editor.contains(sel.anchorNode))savedRange=sel.getRangeAt(0).cloneRange();
}
function restoreEditorSelection(editor){
  editor.focus();
  const sel=window.getSelection();
  if(savedRange&&editor.contains(savedRange.commonAncestorContainer)){
    sel.removeAllRanges();sel.addRange(savedRange);
  }
}
function insertTable(){
  const rows=3,cols=3;let html='<table><tbody>';
  for(let r=0;r<rows;r++){
    html+='<tr>';
    for(let c=0;c<cols;c++)html+=(r===0?'<th>Header</th>':'<td>&nbsp;</td>');
    html+='</tr>';
  }
  html+='</tbody></table><p><br></p>';
  document.execCommand('insertHTML',false,html);
}
function applyFormat(cmd,value,editor){
  editor=editor||app.querySelector('.th-edit');if(!editor)return;
  const isCompose=editor.classList.contains('th-edit');
  // Compose relies on the saved range (selects/colour inputs steal focus); the signature
  // editor only uses buttons, whose mousedown is preventDefault-ed, so its live selection
  // is already intact — just refocus.
  if(isCompose)restoreEditorSelection(editor);else editor.focus();
  // Style-producing commands emit <span style="…"> rather than legacy <font> tags.
  const css=cmd==='foreColor'||cmd==='hiliteColor'||cmd==='fontName'||cmd==='fontSize';
  try{document.execCommand('styleWithCSS',false,css);}catch{}
  if(cmd==='createLink'){
    const url=prompt('Link URL (https:// or mailto:)');
    const link=safeHref(url);
    if(url&&url.trim()&&!link)notify('Only http, https or mailto links are allowed (localhost and private-network addresses are blocked).',true);
    if(link)document.execCommand('createLink',false,link);
  }
  else if(cmd==='formatBlock')document.execCommand('formatBlock',false,value||'blockquote');
  else if(cmd==='inlineCode'){
    const sel=window.getSelection(),text=sel&&String(sel);
    if(text)document.execCommand('insertHTML',false,'<code>'+text.replace(/[&<>]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;'})[ch])+'</code>');
  }
  else if(cmd==='insertTable')insertTable();
  else if(cmd==='fontSize')document.execCommand('fontSize',false,value||'3');
  else if(cmd==='fontName')document.execCommand('fontName',false,value||'Arial');
  else if(cmd==='foreColor')document.execCommand('foreColor',false,value);
  else if(cmd==='hiliteColor'){if(!document.execCommand('hiliteColor',false,value))document.execCommand('backColor',false,value);}
  else document.execCommand(cmd,false,null);
  // Only the compose editor autosaves into the draft; the signature persists on Save only.
  if(isCompose){if(ui.threadDraft)ui.threadDraft.bodyHtml=editor.innerHTML;queueSnapshot();}
}
 app.addEventListener('click',onClick);
 dialog.addEventListener('click',onClick);
 dialog.addEventListener('input',onDialogInput);
 // Thread pane resizing: drag the divider between folders / list / reader, or
 // focus it and use arrow keys. Widths persist in localStorage and are read back
 // by workspace.js on every render, so they survive re-renders and reloads.
 const TH_LIMITS={folders:{min:160,max:440,key:'thFoldersW'},list:{min:220,max:680,key:'thListW'}};
 const thClamp=(lim,w)=>Math.min(lim.max,Math.max(lim.min,Math.round(w)));
 function onResizeDown(event){
   if(event.button!==0)return;
   const handle=event.target.closest('.th-resizer');if(!handle)return;
   const which=handle.dataset.resize,lim=TH_LIMITS[which];if(!lim)return;
   const pane=handle.previousElementSibling;if(!pane)return;
   event.preventDefault();
   const startX=event.clientX,startW=pane.getBoundingClientRect().width;
   handle.classList.add('dragging');document.body.classList.add('th-resizing');
   const move=e=>{pane.style.flexBasis=thClamp(lim,startW+(e.clientX-startX))+'px';};
   const up=e=>{document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);handle.classList.remove('dragging');document.body.classList.remove('th-resizing');const w=thClamp(lim,startW+(e.clientX-startX));pane.style.flexBasis=w+'px';try{localStorage.setItem('vitalise.'+lim.key,String(w));}catch{}};
   document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);
 }
 function onResizeKey(event){
   const handle=event.target.closest('.th-resizer');if(!handle)return;
   const which=handle.dataset.resize,lim=TH_LIMITS[which];if(!lim)return;
   const pane=handle.previousElementSibling;if(!pane)return;
   const cur=pane.getBoundingClientRect().width,step=event.shiftKey?40:12;
   let w=null;
   if(event.key==='ArrowRight')w=cur+step;else if(event.key==='ArrowLeft')w=cur-step;else if(event.key==='Home')w=lim.min;else if(event.key==='End')w=lim.max;
   if(w===null)return;
   event.preventDefault();
   const v=thClamp(lim,w);pane.style.flexBasis=v+'px';try{localStorage.setItem('vitalise.'+lim.key,String(v));}catch{}
 }
 app.addEventListener('mousedown',onResizeDown);
 app.addEventListener('keydown',onResizeKey);
 async function onClick(event){
  try{
   // Click-outside dismiss: if a dropdown menu is open and the click lands outside
   // the menu and its trigger, close the menu and swallow this click (standard
   // "first click dismisses" behaviour). The trigger and Escape still work as before.
   if(menu&&!event.target.closest('.dropdown')&&!event.target.closest('[data-action="menu"]')){menu='';render();return;}
   // Internal SPA links now point at real paths. Intercept plain left-clicks on same-origin
  // path links and route them through the History API; leave new-tab (target), download,
  // modifier-clicks and non-path links (mailto:, tel:, external, '#') to the browser.
  const link=event.target.closest('a[href^="/"]');
  if(link&&!link.target&&!link.hasAttribute('download')&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){
   if(dialog.open)dialog.close();
   event.preventDefault();navigate(link.getAttribute('href'));return;
  }
 const button=event.target.closest('[data-action]');
 if(!button){
   const row=event.target.closest('tr[data-open]');if(row&&!event.target.closest('a,input,button,select'))navigate(row.dataset.open);
  return;
 }
 // Folder links and conversation rows are anchors/divs that carry data-action but have no
 // button default; the folder's href="#" would otherwise clear the hash and drop to the
 // dashboard, so suppress the anchor default and let the action keep the module focused.
 if(button.tagName==='A')event.preventDefault();
 const d=button.dataset,type=d.action,r=route(),p=r.p,l=r.lead;
 if(type==='menu'){menu=menu===d.value?'':d.value;render();return;}
  if(type==='mobile-menu'){if(matchMedia('(max-width:620px)').matches)ui.mobile=!ui.mobile;else navCollapsed=!navCollapsed;render();return;}
 if(type==='dialog'){menu='';render();openDialog(d.kind,d);return;}
 if(type==='close-dialog'){dialog.close();return;}
 if(type==='toggle-password'){
  const input=button.closest('.password-field')?.querySelector('input');
  if(input){input.type=input.type==='password'?'text':'password';button.textContent=input.type==='password'?'Show':'Hide';}
  return;
 }
  if(type==='logout'){
   try{await request('/api/auth/logout',{});authenticated=false;state=null;menu='';app.innerHTML=loginPage('You have been signed out.');}
   catch(error){notify(error.message,true);}
   return;
  }
  if(type==='mail-test'){
   if(busy)return;
   const original=button.textContent;busy=true;button.disabled=true;button.textContent='Testing…';
   try{
    const out=await request('/api/mail/test',{});
    notify(out.fetched?('Connection OK · '+out.fetched+' recent message'+(out.fetched>1?'s':'')+(out.latest?' · newest: '+out.latest.subject:'')):'Connection OK · mailbox is empty.');
   }catch(error){notify(error.message,true);}
   finally{busy=false;if(button.isConnected){button.disabled=false;button.textContent=original;}}
   return;
  }
  if(type==='mail-fetch'){
   if(busy)return;
   const original=button.textContent;busy=true;button.disabled=true;button.textContent='Fetching…';
   try{
    const out=await request('/api/mail/fetch',{workspace:r.ws.id,revision:state.revision});
    ({state,webSearch,jevAvailable,firecrawlAvailable,perplexityAvailable,limaAvailable,reoonAvailable}=out);
    const added=(out.result&&out.result.added)||0;
    ui.threadView='inbox';ui.threadFolder='inbox';
    render();
    notify(added?('Imported '+added+' new message'+(added>1?'s':'')+' into Thread.'):'No new mail to import.');
   }catch(error){notify(error.message,true);}
   finally{busy=false;if(button.isConnected){button.disabled=false;button.textContent=original;}}
   return;
  }
 if(type==='enrichment-menu'){openDialog('enrichments');return;}
  const views={'today-channel':'todayChannel','today-pool':'todayPool','analytics-scope':'analyticsScope','analytics-tab':'analyticsSection','apps-filter':'apps','agent-channel':'agentChannel','draft-channel':'draftChannel','new-mode':'newMode','thread-view':'threadView'};
   if(views[type]){ui[views[type]]=d.value;if(type.startsWith('today-'))ui.todayPage=0;if(type==='agent-channel')ui.agentId='';render({keepScroll:type!=='thread-view'});return;}
   if(type==='thread-folder'){ui.threadFolder=d.value;render();return;}
   if(type==='thread-select'){ui.threadId=d.id;render();return;}
   if(type==='thread-demo'){notify('Campaign builder is still a preview — not wired yet.');return;}
     if(type==='thread-compose'){if(!hasContent(ui.threadDraft))ui.threadDraft=loadSnapshot()||{mode:'compose',to:[],cc:[],subject:'',bodyHtml:signatureHtml()};ui.threadView='compose';render();return;}
     if(type==='thread-discard'){if(hasContent(ui.threadDraft)&&!confirm('Discard this message? Your text will be lost.'))return;ui.threadDraft=null;clearSnapshot();ui.threadView='inbox';render();return;}
    if(type==='thread-cc-toggle'){ui.showCc=!ui.showCc;render();return;}
    if(type==='thread-reply'||type==='thread-reply-all'||type==='thread-forward'){
     const mode=type==='thread-reply'?'reply':type==='thread-reply-all'?'replyAll':'forward';
     const draft=draftFromMessage(d.thread,d.message,mode);
     if(!draft){notify('Conversation unavailable.',true);return;}
     ui.threadDraft=draft;ui.threadView='compose';ui.threadId=d.thread;saveSnapshot();render();return;
    }
   if(type==='thread-receive'){
    const t=(workspace().threads||[]).find(x=>x.id===d.thread);if(!t){notify('Conversation unavailable.',true);return;}
    const se=selfEmail();const other=t.participants.find(p=>p.email&&String(p.email).toLowerCase()!==se)||t.participants[0]||{name:'',email:''};
     ui.threadDraft={mode:'receive',threadId:t.id,subject:t.subject,to:[other.email],cc:[],from:{name:other.name,email:other.email},bodyHtml:''};
     ui.threadView='compose';ui.threadId=t.id;saveSnapshot();render();return;
   }
   if(type==='thread-star'){await action('thread-star',{threadId:d.thread,starred:d.value==='true'},{message:false});return;}
   if(type==='thread-read'){await action('thread-read',{threadId:d.thread,unread:d.value==='true'},{message:false});return;}
   if(type==='thread-important'){await action('thread-important',{threadId:d.thread,important:d.value==='true'},{message:false});return;}
   if(type==='thread-move'){await action('thread-move',{threadId:d.thread,folder:d.folder},{message:'Moved to '+d.folder+'.'});return;}
   if(type==='thread-save-draft'){
    const f=threadForm(),cur=ui.threadDraft||{};
    await action('thread-save-draft',{threadId:cur.threadId||undefined,subject:f.subject,to:f.to,cc:f.cc,bodyHtml:f.bodyHtml,leadId:cur.leadId||undefined},
     {message:'Draft saved.',after:r=>{if(r&&r.thread)ui.threadDraft={...cur,threadId:r.thread};}});
    return;
   }
    if(type==='thread-submit'){
     const draft=ui.threadDraft||{},f=threadForm();
     const bad=invalidRecips();
     if(bad.length){notify('Remove the invalid address'+(bad.length>1?'es':'')+': '+bad.join(', '),true);return;}
     const after=r=>{ui.threadDraft=null;ui.threadView='inbox';clearSnapshot();if(r&&r.thread)ui.threadId=r.thread;};
    if(draft.mode==='reply')await action('thread-reply',{threadId:draft.threadId,messageId:draft.messageId,bodyHtml:f.bodyHtml},{message:'Reply sent.',after});
    else if(draft.mode==='replyAll')await action('thread-reply-all',{threadId:draft.threadId,messageId:draft.messageId,bodyHtml:f.bodyHtml},{message:'Reply sent to all.',after});
    else if(draft.mode==='forward')await action('thread-forward',{threadId:draft.threadId,messageId:draft.messageId,to:f.to,cc:f.cc,bodyHtml:f.bodyHtml},{message:'Forwarded.',after});
    else if(draft.mode==='receive')await action('thread-receive',{threadId:draft.threadId,from:draft.from,bodyHtml:f.bodyHtml},{message:'Inbound reply logged.',after});
    else await action('thread-send',{subject:f.subject,to:f.to,cc:f.cc,bodyHtml:f.bodyHtml,threadId:draft.threadId||undefined,leadId:draft.leadId||undefined},{message:'Sent.',after});
    return;
   }
     if(type==='fmt'){applyFormat(d.cmd,d.value);return;}
     if(type==='sig-fmt'){const ed=app.querySelector('.sig-edit');if(ed)applyFormat(d.cmd,d.value,ed);return;}
     if(type==='signature-save'){
       const html=app.querySelector('.sig-edit')?.innerHTML||'';
       await action('signature',{html},{message:'Signature saved.'});return;
     }
 if(type==='page'){ui[d.kind+'Page']=Math.max(0,Number(d.value)||0);render();return;}
 if(type==='cookie'){await action('cookie',{value:d.value});return;}
  if(type==='workspace-select'){await action(type,{workspace:d.id},{after:()=>{menu='';navigate(go('home'));}});return;}
   if(type==='ws-invite-another'){const w=ui.wsWizard||{};w.invites=collectInviteRows();w.invites.push({email:'',role:'Agent'});openDialog('workspace-add');return;}
   if(type==='ws-invite-remove'){const w=ui.wsWizard||{};w.invites=collectInviteRows();w.invites.splice(Number(d.index),1);if(!w.invites.length)w.invites=[{email:'',role:'Agent'}];openDialog('workspace-add');return;}
   if(type==='ws-skip'){await createWorkspaceFromWizard([]);return;}
   if(type==='onboard-start'){ui.newMode=d.value;navigate(go('new'));return;}
 if(type==='worklist'){await action(type,{replace:d.replace==='true'},{message:d.replace==='true'?'Worklist regenerated.':'Worklist topped up.'});return;}
 if(type==='mark'||type==='lead-mark'){await action(type,{assignment:d.id,channel:d.channel,mark:d.mark},{message:d.mark+' recorded.'});return;}
 if(type==='fit'){await action(type,{value:d.value==='true'});return;}
 if(type==='unsuppress'){await action(type,{id:d.id});return;}
 if(type==='reassign'){await action(type);return;}
 if(type==='dnc-export'){
  const csv=['value,type,reason,added',...r.ws.suppressions.filter(x=>!x.removedAt).map(x=>[x.value,x.kind,x.reason,x.at].map(escapeCsv).join(','))].join('\n');
  download('do-not-contact.csv',csv);return;
 }
 if(type==='jev-score'){
  if(busy)return;
  const label=button.textContent;
  button.disabled=true;button.textContent='Scoring…';
  try{await action(type,{}, {message:'Jev fit score ready.'});}
  finally{button.disabled=false;button.textContent=label;}
  return;
 }
 if(type==='target-add'||type==='target-remove'){
  const data=values(button.closest('form')),draft=targetDraft(data),list=draft[d.kind];
  if(type==='target-remove')list.splice(Number(d.index),1);
  else if(d.kind==='signals'){if(!data.newSignal?.trim()){notify('Enter a signal.',true);return;}list.push({text:data.newSignal,weight:0});}
  else{if(!data.newRole?.trim()){notify('Enter a role.',true);return;}list.push(data.newRole);}
  ui.targetDraft=draft;render();return;
 }
 if(type==='box-add'||type==='box-remove'){
  const data=values(button.closest('form')),draft=channelDraft(data);
  if(type==='box-remove')draft.mailboxes.splice(Number(d.index),1);
  if(type==='box-add'){if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.mailboxAddress||'')){notify('Enter a valid mailbox address.',true);return;}draft.mailboxes.push({email:data.mailboxAddress,cap:1,enabled:true});}
  ui.channelDraft=draft;render();return;
 }
 if(type==='agent-select'){ui.agentId=d.id;render();return;}
 if(type==='agent-next'){
  const rows=todayRows(r.ws,p).filter(a=>(!a.assignee||a.assignee===person(r.ws).id)&&(!ui.agentChannel||ui.agentChannel==='All'||a.channel===ui.agentChannel));
  const i=rows.findIndex(x=>x.id===ui.agentId);
  const start=i>=0?i:Math.max(0,rows.findIndex(x=>!worked(x)));
  ui.agentId=rows[(start+1)%rows.length]?.id;render();return;
 }
 if(type==='copy'||type==='draft-copy'){
  const text=type==='copy'?d.text:button.closest('form')?.elements.body?.value;
  if(!text){notify('There is no draft to copy.',true);return;}
  try{await navigator.clipboard.writeText(text);notify('Copied.');}catch{notify('Select the draft text and copy it manually.',true);}return;
 }
 if(type==='draft-template'){
  const form=button.closest('form'),contact=l.contacts[0]?.name.split(' ')[0]||'there';
  const offer=p.targeting.offer||'a potential renewable energy partnership';
  form.elements.body.value='Hi '+contact+',\n\nI’m reaching out to '+l.name+' about '+offer.replace(/[.]+$/,'')+'. Would you be open to a brief conversation?\n\nBest,\n'+person(r.ws).name;
  if(form.elements.subject&&!form.elements.subject.value)form.elements.subject.value='Renewable energy partnership';
  form.elements.body.dispatchEvent(new Event('input',{bubbles:true}));
  return;
 }
 if(type==='find-example'){findDraft().query=d.value;render();return;}
 if(type==='find-back'){const f=findDraft();f.step=Math.max(0,f.step-1);render();return;}
 if(type==='import-open'){
  invalidateImport();ui.importOpen=true;ui.importFile=null;ui.importPaste='';render();return;
 }
 if(type==='import-clear-file'){invalidateImport();ui.importFile=null;render();return;}
 if(type==='enrich-firecrawl'||type==='enrich-perplexity'){
  const provider=type==='enrich-firecrawl'?'firecrawl':'perplexity';
  if(busy||!l||l.erasedAt||!(provider==='firecrawl'?firecrawlAvailable:perplexityAvailable))return;
  const href=location.pathname,view=ui;
  button.disabled=true;
  try{
   const rows=await searchCompanies({workspace:r.ws.id,project:p.id,lead:l.id,source:provider});
   if(!rows||href!==location.pathname||view!==ui)return;
   const row=rows[0];
   if(row)openDialog('research-review',{...row,provider});
   else notify('No usable findings on '+l.domain+'.',true);
  }finally{button.disabled=false;}
  return;
 }
 if(type==='lima-email'){
  if(busy||!limaAvailable||!l||l.erasedAt)return;
  const href=location.pathname,view=ui;
  button.disabled=true;busy=true;
  try{
   const result=await request('/api/contact-email',{workspace:r.ws.id,project:p.id,lead:l.id,contact:d.id});
   if(href!==location.pathname||view!==ui)return;
   if(result.outcome==='match'&&result.email)openDialog('lima-review',result);
   else notify(result.message||'LimaData returned no usable work email.',true);
   }catch(error){notify(error.message,true);}
   finally{button.disabled=false;busy=false;}
   return;
  }
  if(type==='verify-email'||type==='verify-account'){
   if(busy||!reoonAvailable||!l||l.erasedAt)return;
   const href=location.pathname,view=ui;
   button.disabled=true;busy=true;
   try{
    const body={workspace:r.ws.id,project:p.id,lead:l.id,revision:state.revision};
    if(type==='verify-email')body.contact=d.id;
    const out=await request('/api/verify-emails',body);
    if(href!==location.pathname||view!==ui)return;
    ({state,webSearch,jevAvailable,firecrawlAvailable,perplexityAvailable,limaAvailable,reoonAvailable}=out);
    render();
    const res=out.result||{};
    if(res.verified)notify(res.verified+(res.verified===1?' email verified.':' emails verified.'));
    else notify('Reoon returned no usable result.',true);
   }catch(error){notify(error.message,true);}
   finally{button.disabled=false;busy=false;}
   return;
  }
  if(type==='analyze-site'||type==='enrich-web'){
  if(!webSearch){notify('Set EXA_API_KEY on the local server to enable web research.',true);return;}
  const form=button.closest('form');
  const domain=type==='analyze-site'?String(values(form).website||'').replace(/^https?:\/\//,'').split('/')[0].toLowerCase().replace(/^www\./,''):l.domain;
  if(!domain){notify('Enter a company website.',true);return;}
  const rows=await searchCompanies({workspace:r.ws.id,source:'web',query:'Official company website for '+domain+' and what the company offers'});
  const row=rows?.find(x=>x.domain===domain&&x.description);
  if(!row){if(rows)notify('No sourced description was returned for this domain.',true);return;}
  if(type==='analyze-site'){if(!form.isConnected)return;const draft=targetDraft(values(form));draft.offer=row.description;ui.targetDraft=draft;render();notify('Review the sourced description before saving.');}
  else await action('enrich-record',{source:row.source,description:row.description,expectedDomain:domain},{
   context:{workspace:r.ws.id,project:p.id,lead:l.id},message:'Enrichment saved for '+l.name+'.'
  });
 }
 }catch(error){reportUiError(error);}
}
app.addEventListener('change',async event=>{
 try{
  const el=event.target,d=el.dataset,k=d.filter;
  if(d.action==='fmt-change'){
    const cmd=d.cmd,value=el.value;
    if(cmd&&value){applyFormat(cmd,value);if(el.tagName==='SELECT')el.selectedIndex=0;}
    return;
  }
 if(el.form?.dataset.form==='import-preview'&&el.name==='file'){
  invalidateImport();ui.importFile=el.files[0]||null;
  const fileName=app.querySelector('[data-import-filename]');
  if(fileName)fileName.textContent=ui.importFile?.name||'No file selected';
  const clear=app.querySelector('[data-action="import-clear-file"]');
  if(clear)clear.disabled=!ui.importFile;
  return;
 }
 if(k){ui[k]=el.type==='checkbox'?el.checked:el.value;if(k.startsWith('lead'))ui.leadsPage=0;if(k==='todaySize')ui.todayPage=0;render();return;}
 if(d.change==='assignee')await action('assign',{assignment:d.id,assignee:el.value});
 if(d.change==='member-role')await action('member-role',{member:d.member,role:el.value});
 if(d.change==='member-status')await action('member-status',{member:d.member,status:el.value});
 if(d.change==='lifecycle')await action('lifecycle',{value:el.value});
 if(d.change==='ltv')await action('lifecycle',{ltv:el.value});
 }catch(error){reportUiError(error);}
});
 app.addEventListener('input',event=>{
  try{
  const x=event.target,key=x.dataset.input;
  if(x.classList.contains('th-edit')){if(ui.threadDraft){ui.threadDraft.bodyHtml=x.innerHTML;queueSnapshot();}return;}
  if(x.dataset.draft&&ui.threadDraft){ui.threadDraft[x.dataset.draft]=x.value;if(x.dataset.draft==='to'||x.dataset.draft==='cc')recipHint(x);queueSnapshot();return;}
  if(x.form?.dataset.form==='import-preview'&&x.name==='paste'){invalidateImport();ui.importPaste=x.value;}
 if(x.form?.dataset.form==='draft'&&['subject','body'].includes(x.name)){
  const data=values(x.form);
  (ui.draftEdits??={})[data.channel]=data;
 }
 if(x.classList.contains('find-query-text')){
  findDraft().query=x.value;
  x.form.querySelector('button[type=submit]').disabled=!x.value.trim();
  return;
 }
 if(!key)return;
 ui[key]=x.value;if(key==='leadQuery')ui.leadsPage=0;
 render({restoreInput:{key,start:x.selectionStart,end:x.selectionEnd}});
 }catch(error){reportUiError(error);}
});
 app.addEventListener('submit',onSubmit);
  app.addEventListener('mousedown',event=>{if(event.target.closest('button.th-fmt'))event.preventDefault();});
  document.addEventListener('selectionchange',()=>{if(app.querySelector('.th-edit'))trackEditorSelection();});
 dialog.addEventListener('submit',onSubmit);
async function onSubmit(event){
 const f=event.target.closest('form[data-form]');if(!f)return;
 event.preventDefault();
 const kind=f.dataset.form,data=values(f);
 if(kind==='login'){
  const submit=f.querySelector('button[type="submit"]');submit.disabled=true;
  try{await request('/api/auth/login',{username:data.username,password:data.password});authenticated=true;await refresh();if(location.pathname==='/')history.replaceState(null,'',workspace().projects[0]?go('today',workspace().projects[0].id):go('home'));render({keepScroll:false});}
  catch(error){app.innerHTML=loginPage(error.message);}
  finally{if(submit.isConnected)submit.disabled=false;}
  return;
 }
  if(kind==='password-change'){
   if(data.newPassword!==data.confirmPassword){notify('New passwords do not match.',true);return;}
   try{await request('/api/auth/change-password',data);dialog.close();notify('Password changed.');}
   catch(error){notify(error.message,true);}
   return;
  }
  if(kind==='mail-settings'){
   try{
    const out=await request('/api/mail/save',{host:data.host,port:data.port,user:data.user,mailbox:data.mailbox,password:data.password||'',tls:data.tls==='on'});
    mail=out.settings;render();notify('Mailbox settings saved.');
   }catch(error){notify(error.message,true);}
   return;
  }
 const r=route();
 if(kind==='audit'){
  if(data.from&&data.to&&data.from>data.to){notify('The start date must be before the end date.',true);return;}
  const q=new URLSearchParams({workspace:r.ws.id,project:data.project,from:data.from,to:data.to,format:data.format});
  const a=document.createElement('a');a.href='/api/audit?'+q;a.download='outreach-audit.'+data.format;a.click();return;
 }
 if(kind==='project-add'){
  const destination=ui.newMode==='find'?'find':'import';
   await action(kind,data,{after:result=>{navigate(go(destination,result.project));}});return;
 }
  if(kind==='workspace-add-step1'){
   const name=(data.name||'').trim(),rawSlug=(data.slug||'').trim().toLowerCase();
   if(!name){notify('Enter a workspace name.',true);return;}
   if(rawSlug&&!/^[a-z0-9-]+$/.test(rawSlug)){notify('The URL can only contain letters, numbers and dashes.',true);return;}
   const key=(rawSlug||name).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
   if(!key){notify('Enter a workspace name.',true);return;}
   if(state.workspaces.some(x=>x.id===key)){notify('That workspace already exists.',true);return;}
    const w=ui.wsWizard||{};w.step=2;w.name=name;w.slug=key;w.invites=(w.invites&&w.invites.length)?w.invites:[{email:'',role:'Agent'}];ui.wsWizard=w;
    openDialog('workspace-add');return;
   }
   if(kind==='workspace-add-step2'){
    await createWorkspaceFromWizard(collectInviteRows());return;
   }
 if(kind==='find-step'){const d=findDraft();Object.assign(d,data);d.step++;render();return;}
 if(kind==='find-search'){
  if(busy)return;
  const d=findDraft();Object.assign(d,data);
  const href=location.pathname,query=d.query,source=d.source;
  const rows=await searchCompanies({workspace:r.ws.id,source:d.source,query:d.query});
  if(!rows||href!==location.pathname||ui.find!==d||d.step!==2||d.query!==query||d.source!==source)return;
  d.rows=rows;d.step=3;render();return;
 }
 if(kind==='find-add'){
  const d=findDraft();const rows=d.rows.filter((x,i)=>isChecked(data,'row-'+i));
  if(!rows.length){notify('Select at least one lead to add.',true);return;}
   const out=await action(kind,{rows,label:d.query},{message:false,after:()=>{navigate(go('leads',r.p.id));}});
  if(out)notify(out.added+' added, '+out.duplicates+' duplicates, '+out.skipped+' skipped.');return;
 }
 if(kind==='import-preview'){
  const view=ui,context={workspace:r.ws.id,project:r.p.id};
  invalidateImport();
  const token=view.importToken;
  const file=data.file?.name?data.file:view.importFile;
  const paste=String(data.paste||'').trim();
  view.importFile=file;view.importPaste=String(data.paste||'');
  const submit=f.querySelector('button[type=submit]');
  submit.disabled=true;
  try{
   if(file&&paste)throw Error('Choose one input. Clear the file or the pasted text.');
   if(paste.length>10_000_000)throw Error('Split the pasted text into smaller batches.');
   const grid=file?await parseWorkbook(file):parseCsv(paste);
   if(ui!==view||view.importToken!==token)return;
   const rows=rowsFromGrid(grid);
   if(!rows.length||rows.length>1000)throw Error(rows.length?'Split the file into imports of up to 1,000 records.':'No data rows were found below the header.');
   await previewImport(view,context,{inputRows:rows,rows,label:file?.name||'Pasted list',batchId:crypto.randomUUID()},token);
  }catch(error){if(ui===view&&view.importToken===token)notify(error.message,true);}
  finally{if(submit.isConnected)submit.disabled=false;}
  return;
 }
 if(kind==='import-commit'){
  const view=ui,preview=view.importData;
  if(!preview||!(preview.added||preview.updated))return;
  const context={workspace:r.ws.id,project:r.p.id};
  const draft={inputRows:preview.inputRows,label:preview.label,batchId:preview.batchId};
  const out=await action('import',{rows:draft.inputRows,label:draft.label,batchId:draft.batchId},{
   context,revision:preview.revision,message:false,
   after:()=>{if(ui===view&&view.importData===preview){invalidateImport();view.importOpen=false;view.importFile=null;view.importPaste='';}},
   onConflict:async()=>{
    if(ui!==view||view.importData!==preview)return;
    invalidateImport();
    await previewImport(view,context,{...draft,rows:draft.inputRows},view.importToken);
    notify('The project changed. Review the updated preview before importing.',true);
   }
  });
  if(out)notify(out.added+' added, '+out.updated+' updated, '+(out.duplicates-out.updated)+' unchanged, '+out.skipped+' skipped.');
  return;
 }
 if(kind==='targeting'){await action(kind,targetDraft(data),{after:()=>{ui.targetDraft=null;}});return;}
 if(kind==='channels'){await action(kind,channelDraft(data),{after:()=>{ui.channelDraft=null;}});return;}
 if(kind==='agents'){
  const agents=r.ws.members.filter(m=>isChecked(data,'agent-'+m.id)).map(m=>m.id);
  const quotas=Object.fromEntries(r.ws.members.map(m=>[m.id,Object.fromEntries(channels.map(c=>[c,data['quota-'+m.id+'-'+c]??0]))]));
  await action(kind,{agents,quotas,autoAssign:isChecked(data,'autoAssign'),split:data.split,globalCooldown:data.globalCooldown});return;
 }
 if(kind==='draft'){
  await action(kind,data,{after:()=>{if(ui.draftEdits)delete ui.draftEdits[data.channel];}});return;
 }
 if(kind==='erase'&&data.confirm!=='ERASE'){notify('Type ERASE to confirm.',true);return;}
 await action(kind,data,{message:kind==='invite'?'Pending invitation saved.':undefined});
}
window.addEventListener('popstate',onLocationChange);
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu){menu='';render();}});
// compat.js (classic script) may have already rendered an "unsupported browser"
// notice; if so, skip booting so we don't overwrite it. If compat.js never loaded,
// __compat is undefined and we boot normally.
if(!window.__compat||window.__compat.ok!==false){
 try{
  const authState=await request('/api/auth/status');
  authenticated=authState.authenticated;
  if(authenticated){
    await refresh();
    if(location.pathname==='/')history.replaceState(null,'',workspace().projects[0]?go('today',workspace().projects[0].id):go('home'));
    if(route().page==='thread')navCollapsed=true;
    render({keepScroll:false});
  }else app.innerHTML=loginPage();
  window.__vitaliseBooted=true;
 }catch(error){app.textContent='Vitalise could not open. '+error.message;}
}
window.addEventListener('error',event=>{notify(event.message||'Something went wrong.',true);});
window.addEventListener('unhandledrejection',event=>{notify(event.reason?.message||'Something went wrong. Reload if it continues.',true);});

