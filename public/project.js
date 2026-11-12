import {contactAllowed,handleKey} from './eligibility.js';
import {outreachLink,e,go,link,btn,header,card,empty,table,tr,blankRow,form,field,area,check,select,tabs,stat,bar,note,date,day,money,todayRows,channels,leadChannels,marks,lifecycles,icon,segment,ext,handles,handleLabel,enabledChannels,leadTitle,rowLink,leadState,worked,channelTag,lifecycleClass,jevFitScore,jevChip,jevSearch} from './ui.js';

const canAttempt=(ws,p,l,a)=>contactAllowed(ws,p,l,a.channel,a.handle)&&
 handles(l,a.channel).some(h=>handleKey(a.channel,h.value)===handleKey(a.channel,a.handle))&&
 (!a.mailbox||p.mailboxes.some(m=>m.id===a.mailbox&&m.enabled&&m.cap>0));
const pct=(n,d)=>d?Math.round(n/d*100):0;
const dash=n=>n==null?'—':e(n);
const jevSeekingPct=l=>l.jevFit?.stale||l.jevFit?.seekingInvestment==null?'—':Math.round(l.jevFit.seekingInvestment*100);
const todayLabel=tz=>new Intl.DateTimeFormat('en-GB',{timeZone:tz,weekday:'long',day:'numeric',month:'long'}).format(new Date());
const cleanFilter=(v)=>String(v||'').toLowerCase();
const pager=(size,n,page,kind)=>'<div class="pager"><label class="flex">Rows per page '+select('Rows per page',kind==='leads'?[10,25,50,100]:[10,15,25,50],size,{'data-filter':kind+'Size'})+'</label><span>'+
 (n?(page*size+1)+'–'+Math.min(n,(page+1)*size)+' of '+n:'0 results')+'</span><span class="push"></span>'+
 btn('‹ Previous','page','subtle',{'data-kind':kind,'data-value':page-1,disabled:page<=0})+btn('Next ›','page','subtle',{'data-kind':kind,'data-value':page+1,disabled:(page+1)*size>=n})+'</div>';
function assignments(ws,p){return todayRows(ws,p).map(a=>({a,l:p.leads.find(l=>l.id===a.leadId)})).filter(x=>x.l);}
export function projectPage(page,ws,p,ui){
 if(page==='today')return today(ws,p,ui);
 if(page==='leads')return leads(ws,p,ui);
 if(page==='overview')return overview(ws,p);
 if(page==='targeting')return targeting(ws,p,ui);
 if(page==='channels')return channelSettings(ws,p,ui);
 if(page==='agents')return agentSettings(ws,p);
 if(page==='analytics')return analytics(ws,p,ui);
 if(page==='agent')return agentMode(ws,p,ui);
 return '';
}
function today(ws,p,ui){
 const all=assignments(ws,p), tabs=['All',...enabledChannels(p)], ch=ui.todayChannel||'All', pool=ui.todayPool||'All';
 const owner=ws.members[0].id;
 const visible=all.filter(({a})=>(ch==='All'||a.channel===ch)&&(pool==='All'||(pool==='Mine'?a.assignee===owner:!a.assignee)));
 const size=Number(ui.todaySize)||10,page=Math.min(Number(ui.todayPage)||0,Math.max(0,Math.ceil(visible.length/size)-1));
 const active=ws.members.filter(m=>m.status==='Active'&&p.agents.includes(m.id));
 const shown=visible.slice(page*size,(page+1)*size).map(({a,l},i)=>tr([
   e(page*size+i+1),'<span class="channel-cell">'+channelTag(a.channel)+' '+e(a.channel)+'</span>',link(leadTitleText(l),rowLink(l,p),'table-name')+(l.domainVerified==='valid'?'<span class="domain-tick" title="Domain verified — MX mail server live">✓</span>':'')+'<small class="subline">'+e(l.domain)+(l.country?' · '+e(l.country):'')+'</small>',
  dash(jevFitScore(l)),'<div class="handle"><b>'+e(a.person)+'</b><small class="subline">'+e(handleLabel(a.handle))+'</small></div>',
  select('Assignee',[['Shared pool',''],...active.map(x=>[x.name,x.id])],a.assignee,{'data-change':'assignee','data-id':a.id}),
  '<span class="status '+(a.marks.includes('Replied')?'green':'')+'">'+e(a.marks.at(-1)||'Available')+'</span>',
  '<div class="td-actions">'+marks.map(m=>btn(m,'mark','subtle'+(a.marks.includes(m)?' active':''),{'data-id':a.id,'data-mark':m,disabled:a.marks.includes(m)||(m==='Attempted'&&!canAttempt(ws,p,l,a))})).join('')+'</div>',
  link('Open →',rowLink(l,p),'btn link nowrap')
 ]));
 const done=visible.filter(x=>worked(x.a)).length;
 return header('Today','Today’s worklist — every enabled channel, split between your agents.',btn('Top up','worklist','',{'data-replace':'false'})+btn('Regenerate','worklist','primary',{'data-replace':'true'}))+
 '<div class="panel"><div class="work-head">'+tabs.map(t=>{
  const matching=all.filter(({a})=>t==='All'||a.channel===t), n=matching.filter(({a})=>worked(a)).length;
  return '<button type="button" class="work-tile '+(ch===t?'active':'')+'" data-action="today-channel" data-value="'+e(t)+'"><div class="flex between"><strong class="flex">'+(t==='LinkedIn'?channelTag(t):icon(t==='Email'?'mail':'layers'))+' '+e(t)+'</strong><span><b>'+e(matching.length-n)+'</b> left</span></div>'+bar(pct(n,matching.length),'slim')+'<small class="muted">'+(matching.length?n+' of '+matching.length+' done':'No candidates today')+'</small></button>';
 }).join('')+'</div><div class="work-filter">'+segment(['All','Mine','Shared pool'],pool,'today-pool')+'<div style="width:160px">'+bar(pct(done,visible.length))+'</div><span>'+done+' / '+visible.length+' done</span></div>'+
 table(['#','Channel','Lead','Fit / 4','Handle','Assignee','Status','Mark',''],shown.length?shown:[blankRow(9,'No assignments in this view.')],'work-table')+pager(size,visible.length,page,'today')+'</div>'+
 '<p class="small muted row-gap">Marks are independent. Each mark is recorded in the audit history. Copy drafts from the lead page.</p>';
}
const leadTitleText=l=>l.name;
function leads(ws,p,ui){
 const filters={fit:ui.leadFit||'',state:ui.leadState||'',lifecycle:ui.leadLifecycle||'',channel:ui.leadChannel||''};
 const displayChannels=leadChannels.filter(channel=>p.configs[channel]?.enabled);
 const query=cleanFilter(ui.leadQuery);
  const matching=[...p.leads].filter(l=>(!query||[l.name,l.domain,l.city,l.country,l.category,jevSearch(l),...(l.fitReview?.assets.flatMap(asset=>[asset.name,asset.site])||[])].join(' ').toLowerCase().includes(query))&&
  (!filters.fit||(jevFitScore(l)!=null)===(filters.fit==='scored'))&&(!filters.state||leadState(l,p)===filters.state)&&(!filters.lifecycle||l.lifecycle===filters.lifecycle)&&(!filters.channel||handles(l,filters.channel).length))
  .sort((a,b)=>(jevFitScore(b)??-1)-(jevFitScore(a)??-1)||a.name.localeCompare(b.name));
 const size=Number(ui.leadsSize)||25,page=Math.min(Number(ui.leadsPage)||0,Math.max(0,Math.ceil(matching.length/size)-1));
 const rows=matching.slice(page*size,(page+1)*size).map(l=>tr([
   link(l.name,rowLink(l,p),'table-name')+(l.domainVerified==='valid'?'<span class="domain-tick" title="Domain verified — MX mail server live">✓</span>':'')+'<small class="subline">'+e([l.domain,l.platform].filter(Boolean).join(' · '))+'</small>',
   e(l.category||'—')+([l.city,l.country].some(Boolean)?' <span class="muted">· '+e([l.city,l.country].filter(Boolean).join(', '))+'</span>':''),
   jevChip(l),e(l.lifecycle),displayChannels.map(c=>channelTag(c,handles(l,c).length>0)).join(' ')
 ],{'data-open':rowLink(l,p)}));
 return header('Leads <span class="soft">'+p.leads.length+'</span>','Everyone in this project’s list, with reachability per channel.',btn('+ Add lead','dialog','primary',{'data-kind':'lead-add'}),
 '<b>'+p.leads.length+' / '+p.maxLeads.toLocaleString()+' leads</b> <span class="muted">· '+(p.maxLeads-p.leads.length)+' left</span> '+btn('Change','dialog','link',{'data-kind':'project-limit'}))+
 '<div class="filters"><input type="search" aria-label="Search leads" placeholder="Search lead, domain, city…" value="'+e(ui.leadQuery)+'" data-input="leadQuery">'+
 select('Jev fit',[['Any fit score',''],['Scored','scored'],['Unscored','unscored']],filters.fit,{'data-filter':'leadFit'})+
 select('Outreach state',[['Any outreach state',''],'Not contacted','Attempted, no reply','Replied on any channel','Opted out or bounced'],filters.state,{'data-filter':'leadState'})+
 select('Lifecycle',[['Any lifecycle',''],...lifecycles],filters.lifecycle,{'data-filter':'leadLifecycle'})+
 select('Channel',[['Any channel',''],...displayChannels],filters.channel,{'data-filter':'leadChannel'})+'<span class="count muted">'+matching.length+' shown</span></div>'+
  table(['Lead','Category','Jev','Lifecycle','Channels'],rows.length?rows:[blankRow(5,'No leads match these filters.')],'leads-table')+pager(size,matching.length,page,'leads');
}
function overview(ws,p){
 const today=todayRows(ws,p), attempts=p.assignments.filter(a=>a.marks.includes('Attempted')),replies=attempts.filter(a=>a.marks.includes('Replied')).length;
 const reach=enabledChannels(p).reduce((n,c)=>n+p.leads.reduce((m,l)=>m+handles(l,c).length,0),0);
 const relevant=p.leads.reduce((n,l)=>n+l.contacts.length,0), covered=p.leads.filter(l=>l.contacts.length).length;
 const scored=p.leads.filter(l=>jevFitScore(l)!=null).length;
 const meter=(label,done,total)=>'<div class="meter-row"><strong>'+e(label)+'</strong>'+bar(pct(done,total))+'<span class="nowrap">'+e(done)+' / '+e(total)+'</span></div>';
 const history=p.history.slice(0,9).map(a=>'<div class="activity"><small class="muted">'+e(date(a.at,ws.timezone))+'</small><strong>'+e(p.leads.find(l=>l.id===a.leadId)?.name||a.label||p.name)+'</strong><span class="pill">'+e(a.type)+'</span></div>').join('');
 return '<div class="eyebrow">Overview · '+e(todayLabel(ws.timezone))+'</div>'+header(e(p.name))+
 '<div class="cards">'+stat('Leads in list',p.leads.length,'deduped by domain')+stat('Reachable handles',reach,'across '+enabledChannels(p).length+' enabled channels')+stat('Worked today',today.filter(worked).length+'/'+today.length,'assignments')+
 stat('Reply rate',pct(replies,attempts.length)+'%',replies+' replies / '+attempts.length+' attempts')+stat('Found by Find leads',p.searches.reduce((n,s)=>n+s.added,0),p.searches.length+' searches')+
 stat('Relevant people found',relevant,covered+' companies have someone to reach')+'</div>'+
 '<div class="grid2">'+'<section class="card plain metric-panel"><div class="flex between"><h3>Today by channel</h3>'+link('Open worklists →',go('today',p.id),'btn link')+'</div><div class="row-gap">'+enabledChannels(p).map(ch=>{const rows=today.filter(a=>a.channel===ch);return meter(ch,rows.filter(worked).length,rows.length);}).join('')+'</div><div class="overview-legend small"><span>Replied</span><span>Attempted</span><span>Pending</span></div></section>'+
 card('Lifecycle',lifecycles.map(k=>{const n=p.leads.filter(l=>l.lifecycle===k).length;return '<div class="meter-row"><strong>'+k+'</strong>'+bar(pct(n,p.leads.length),'slim')+'<span>'+n+'</span></div>';}).join(''),'metric-panel')+
 card('Recent activity',history||empty('No activity yet.'))+card('Jev fit coverage',meter('Scored',scored,p.leads.length)+meter('Unscored',p.leads.length-scored,p.leads.length))+'</div>';
}
function targeting(ws,p,ui){
 const t=ui.targetDraft||p.targeting;
 const signals=t.signals.map((x,i)=>'<div class="flex between activity"><span>'+e(x.text)+'</span>'+btn('Remove','target-remove','subtle',{'data-kind':'signals','data-index':i})+'</div>').join('');
 const roles=t.roles.map((x,i)=>'<div class="flex between activity"><span>'+e(x)+'</span>'+btn('Remove','target-remove','subtle',{'data-kind':'roles','data-index':i})+'</div>').join('');
 return '<div class="eyebrow">Project settings</div>'+header('Targeting','Describe your offer, the companies you want to reach and the evidence Jev should look for.')+
 '<form class="form" data-form="targeting">'+
 card('01  Your website',field('Website URL','website',t.website)+btn('Analyze site','analyze-site','subtle'))+
 card('02  What you offer',area('What you offer','offer',t.offer))+
 card('03  Ideal customer',area('Ideal customer','ideal',t.ideal))+
 card('04  Draft guidelines',area('Draft guidelines','guidelines',t.guidelines))+
 card('Signals','<p class="muted small">Describe evidence that helps establish fit.</p>'+ (signals||empty('No signals yet.'))+
 '<div class="field-row">'+field('Add a signal','newSignal','')+btn('Add','target-add','',{'data-kind':'signals'})+'</div>')+
 card('Who to reach','<p class="muted small">The roles at each company you want to talk to.</p>'+(roles||empty('No roles yet.'))+'<div class="field-row">'+field('Add a role','newRole','')+btn('Add role','target-add','',{'data-kind':'roles'})+'</div>')+
 '<div class="actions"><button type="submit" class="btn primary">Save changes</button></div></form>';
}
function channelSettings(ws,p,ui){
 const draft=ui.channelDraft||{configs:p.configs,mailboxes:p.mailboxes};
 const boxes=draft.mailboxes.map((m,i)=>tr([e(m.email),'<input type="number" min="0" max="1000" name="boxCap-'+i+'" value="'+e(m.cap)+'" aria-label="Daily mailbox cap">',check('boxEnabled-'+i,m.enabled,'switch',{'aria-label':'Enable mailbox '+m.email}),btn('Remove','box-remove','subtle',{'data-index':i})]));
 const controls=channels.map(ch=>{
  const c=draft.configs[ch],key=ch.toLowerCase();
  return card(ch,'<label class="flex">'+check(key+'-enabled',c.enabled,'switch',{'aria-label':'Enable '+ch})+' '+(c.enabled?'Enabled':'Off — no worklist generated')+'</label><div class="field-row three row-gap">'+
   (ch==='Email'?'<div class="field">Daily cap<small>Sum of enabled mailbox caps</small></div>':field('Daily cap',key+'-cap',c.cap,{type:'number',min:0,max:1000}))+
   field('Cooldown (days)',key+'-cooldown',c.cooldown,{type:'number',min:0,max:365})+field('Max touches per firm',key+'-touches',c.touches,{type:'number',min:0,max:50})+'</div>'+
   '<label class="flex row-gap">'+check(key+'-corporate',c.corporate)+' Corporate-only</label>'+
   (ch==='Email'?'<div class="row-gap"><h3>Mailboxes</h3><p class="small muted">Assignments spread across enabled mailboxes.</p>'+
   table(['Address','Daily cap','Enabled',''],boxes.length?boxes:[blankRow(4,'No mailboxes configured.')])+
   '<div class="field-row row-gap">'+field('New mailbox address','mailboxAddress','',{type:'email'})+btn('Add mailbox','box-add')+'</div></div>':''));
 }).join('');
 return '<div class="eyebrow">Project settings</div>'+header('Channels &amp; mailboxes','Per-channel daily caps, cooldowns, touch limits and email mailbox capacity.')+
 '<form class="form" data-form="channels">'+controls+'<div class="actions"><button type="submit" class="btn primary">Save changes</button></div></form>';
}
function agentSettings(ws,p){
 const rows=ws.members.map(m=>tr([check('agent-'+m.id,p.agents.includes(m.id),'switch',{'aria-label':'Enable '+m.name,disabled:m.status!=='Active'})+' <strong>'+e(m.name)+'</strong>',e(m.role),e(m.status),p.assignments.filter(a=>a.day===day(ws.timezone)&&a.assignee===m.id&&worked(a)).length+' / '+p.assignments.filter(a=>a.day===day(ws.timezone)&&a.assignee===m.id).length]));
 return '<div class="eyebrow">Project settings</div>'+header('Agents &amp; assignment','Set project access, daily assignment and the cooldown between channels.',btn('Re-assign pending now','reassign'))+
 form('agents',card('Assignment rules','<label class="flex">'+check('autoAssign',p.autoAssign,'switch')+' Auto-assign daily</label>'+
 '<div class="field-row row-gap"><label>How to split'+select('split',['Fixed quotas','Auto-balance'],p.split)+'</label>'+field('Global cooldown days','globalCooldown',p.globalCooldown,{type:'number',min:0,max:365})+'</div>')+
 card('Today’s split',table(['Agent','Role','Status','Done / assigned'],rows))+
 card('Fixed quotas','<p class="small muted">These limits apply when Fixed quotas is selected. Extra assignments go to the shared pool.</p>'+
 table(['Agent',...enabledChannels(p)],ws.members.map(m=>tr([e(m.name),...enabledChannels(p).map(ch=>'<input type="number" min="0" max="1000" aria-label="'+e(ch+' quota for '+m.name)+'" name="quota-'+e(m.id)+'-'+e(ch)+'" value="'+e(p.quotas?.[m.id]?.[ch]||0)+'">')])))));
}
function analytics(ws,p,ui){
 const section=ui.analyticsSection||'Summary', scope=ui.analyticsScope||'This project',windowDays=Number(ui.analyticsDays)||30;
 const projects=scope==='All projects'?ws.projects:[p];
 const cutoff=Date.now()-windowDays*86400000;
 const active=projects.flatMap(x=>x.assignments).filter(x=>x.at&&Date.parse(x.at)>=cutoff),leads=projects.flatMap(x=>x.leads);
 const attempted=active.filter(a=>a.marks.includes('Attempted'));
 const attempts=attempted.length,replies=active.filter(a=>a.marks.includes('Replied')).length;
 const repliedToAttempts=attempted.filter(a=>a.marks.includes('Replied')).length;
 const optouts=attempted.filter(a=>a.marks.includes('Opt-out')||a.marks.includes('Bounce')).length;
 const by=(labels,key)=>labels.map(label=>{const r=active.filter(a=>key(a)===label);const x=r.filter(a=>a.marks.includes('Attempted')),y=r.filter(a=>a.marks.includes('Replied')).length;return tr([e(label),x.length,y,pct(x.filter(a=>a.marks.includes('Replied')).length,x.length)+'%']);});
 let body='';
 if(section==='Summary')body='<div class="cards">'+stat('Attempts',attempts,'all channels')+stat('Replies',replies,'marked replied')+stat('Reply rate',pct(repliedToAttempts,attempts)+'%','attempts with a reply')+
 stat('Opt-out rate',pct(optouts,attempts)+'%','including bounces')+stat('Customers',leads.filter(l=>l.lifecycle==='Active').length,'active lifecycle')+
 stat('Total LTV',money(leads.reduce((n,l)=>n+l.ltv,0)),'across selected projects')+'</div>'+
 '<div class="grid2">'+card('Reply rate by channel',table(['Channel','Attempted','Replied','Reply rate'],by([...new Set(projects.flatMap(enabledChannels).concat(active.map(a=>a.channel)))],a=>a.channel)))+
 card('Reply rate by person',table(['Agent','Attempted','Replied','Reply rate'],by(ws.members.map(m=>m.name),a=>ws.members.find(m=>m.id===a.assignee)?.name)))+'</div>';
 if(section==='Channels')body=card('Channels',table(['Channel','Attempted','Replied','Reply rate'],by(channels,a=>a.channel)));
 if(section==='People')body=card('Leaderboard',table(['Agent','Attempted','Replied','Reply rate'],by(ws.members.map(m=>m.name),a=>ws.members.find(m=>m.id===a.assignee)?.name)));
 if(section==='LTV')body=card('Lifetime value by fit coverage',table(['Fit score status','Customers','LTV'],[true,false].map(scored=>{const rows=leads.filter(l=>l.lifecycle==='Active'&&(jevFitScore(l)!=null)===scored);return tr([scored?'Scored':'Unscored',rows.length,money(rows.reduce((n,l)=>n+l.ltv,0))]);})));
 if(section==='Find leads'){const searches=projects.flatMap(x=>x.searches).filter(x=>Date.parse(x.at)>=cutoff);body=card('Search history',table(['Search','Added','Duplicates','Skipped'],searches.length?searches.map(r=>tr([e(r.label),r.added,r.duplicates,r.skipped])):[blankRow(4,'No saved searches in this period.')]));}
 return header('Analytics','Outreach, replies and value won — by channel, by person, over time.')+
 '<div class="filters">'+select('Date range',[['Last 7 days',7],['Last 30 days',30],['Last 90 days',90]],windowDays,{'data-filter':'analyticsDays'})+segment(['This project','All projects'],scope,'analytics-scope')+'</div>'+
 '<div class="tabs">'+['Summary','Channels','People','LTV','Find leads'].map(k=>btn(k,'analytics-tab',k===section?'active':'',{'data-value':k})).join('')+'</div>'+body;
}
function agentMode(ws,p,ui){
 const all=assignments(ws,p),channel=ui.agentChannel||'All';
 const mine=all.filter(({a})=>(!a.assignee||a.assignee===ws.members[0].id)&&(channel==='All'||a.channel===channel));
 const selected=mine.find(x=>x.a.id===ui.agentId)||mine.find(x=>!worked(x.a))||mine[0];
 const menu=segment(['All',...enabledChannels(p)],channel,'agent-channel');
 const panel=selected?(()=>{
  const {a,l}=selected,draft=l.drafts[a.channel]?.body||'Hi '+(a.person.split(' ')[0]||'there')+', I’m reaching out about a potential renewable energy partnership. Would you be open to a brief conversation?';
  const available=canAttempt(ws,p,l,a);
  return card(l.name,'<p>'+e(a.person)+' · '+e(a.channel)+'</p><p class="small muted">'+e(handleLabel(a.handle))+'</p><div class="row-gap note">'+e(draft)+'</div><div class="flex wrap-flex row-gap">'+
   btn('Copy draft','copy','primary',{'data-text':draft,disabled:!available})+(available?outreachLink(ws,p,l,a.channel,a.handle,'Open '+a.channel):'<span class="pill off">Unavailable for outreach</span>')+link('Lead record',rowLink(l,p),'btn link')+'</div><div class="filters">'+marks.map(m=>btn(m,'mark',a.marks.includes(m)?'active':'',{'data-id':a.id,'data-mark':m,disabled:a.marks.includes(m)||(m==='Attempted'&&!available)})).join('')+btn('Skip to next','agent-next')+'</div>');
 })():card('No candidates',empty('There is no work in this channel today.'));
 return header('Agent mode',e(p.name)+' · '+mine.filter(x=>worked(x.a)).length+' of '+mine.length+' done',link('Exit',go('today',p.id)))+
 '<div class="filters">'+menu+'</div><div class="agent-grid"><div class="panel agent-list">'+(mine.map(({a,l})=>btn(l.name,'agent-select',selected?.a.id===a.id?'active':'',{'data-id':a.id})).join('')||empty('No assignments'))+'</div>'+panel+'</div>';
}



