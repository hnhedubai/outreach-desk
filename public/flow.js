import {contactAllowed} from './eligibility.js';
import {outreachLink,e,go,link,btn,icon,header,card,empty,table,tr,blankRow,form,field,area,check,select,tabs,note,date,day,ext,attr,segment,handles,handleLabel,channels,leadChannels,marks,lifecycles,rowLink,leadState,jevFitScore,jevChip,verifyBadge} from './ui.js';

export const leadFields=(l={})=>'<div class="field-row">'+field('Company name','name',l.name,{required:true})+field('Company domain','domain',l.domain,{required:true,placeholder:'example.com'})+
 field('City','city',l.city)+field('Country / region','country',l.country)+field('Category','category',l.category)+
 field('Website platform','platform',l.platform)+field('Lead source','leadSource',l.leadSource)+'</div>'+area('Description','description',l.description);
export const personFields=(c={})=>field('Full name','name',c.name,{required:true})+field('Designation','title',c.title)+field('Work email','email',c.email,{type:'email'})+
 field('LinkedIn profile','linkedin',c.linkedin,{type:'url',placeholder:'https://www.linkedin.com/in/…'})+field('Source','source',c.source,{placeholder:'Company page or professional profile'});
function fitReview(l,p,timezone,jevAvailable){
 const value=jevFitScore(l);
 const score='<div class="detail-meta">'+jevChip(l)+
 (!l.erasedAt&&value==null?btn('Score with Jev','jev-score','subtle',{disabled:!jevAvailable}):'')+
 link('Edit targeting →',go('targeting',p.id),'')+'</div>'+
 (value!=null?'<p class="small muted">'+e(l.jevFit.model)+' · '+e(date(l.jevFit.scoredAt,timezone))+'</p>':'')+
 (!l.erasedAt&&value==null&&!jevAvailable?'<p class="small muted">Set TYPESAFE_API_KEY in the local server environment to enable scoring.</p>':'');
 if(!l.fitReview)return score;
 const sites=l.fitReview.assets.map(asset=>'<details class="note" open><summary><strong>'+e(asset.name)+'</strong>'+
 (asset.site?' <span class="muted">· '+e(asset.site)+'</span>':'')+'</summary>'+
 table(['Signal','Status','Evidence summary'],asset.signals.map(signal=>tr([e(signal.label),e(signal.status),e(signal.detail)])))+'</details>').join('');
 return score+'<p class="small muted">Evidence reviewed '+e(l.fitReview.reviewedOn)+' · '+link('View sources',go('lead',p.id,l.id,'enrichment'),'')+'</p>'+sites;
}
export function leadPage(ws,p,l,tab,ui,{jevAvailable,firecrawlAvailable,perplexityAvailable,limaAvailable}={}){
 const items=[['Channels','channels'],['People '+l.contacts.length,'people'],['Notes','notes'],['History','history'],['Drafts','drafts'],['Enrichment','enrichment']];
 const name=link('← Leads',go('leads',p.id),'btn link');
 const actions=btn('Edit details','dialog','',{'data-kind':'lead-edit'})+btn(l.notFit?'Restore fit':'Not a fit for this project','fit','',{'data-value':l.notFit?'false':'true'})+btn('Erase personal data…','dialog','danger',{'data-kind':'erase'});
 const edit='<div class="filters"><label class="flex">Lifecycle '+select('Lifecycle',lifecycles,l.lifecycle,{'data-change':'lifecycle'})+'</label>'+
 '<label class="flex">LTV <input type="number" min="0" name="ltv" value="'+e(l.ltv)+'" data-change="ltv" aria-label="Lifetime value"></label>'+
 '<span class="pill">'+e(leadState(l,p))+'</span></div>';
 const summary='<div class="grid2">'+card('Brief',(l.description?'<p>'+e(l.description)+'</p>':empty('No company brief yet.'))+
 '<p class="small muted">Platform · '+e(l.platform||'Unknown')+'</p>'+btn('Update brief','dialog','subtle',{'data-kind':'lead-edit'}))+
 card('Fit with this project',fitReview(l,p,ws.timezone,jevAvailable))+'</div>';
 let content='';
 if(tab==='channels'){
  const rows=leadChannels.map(ch=>{
   const listed=handles(l,ch);
   const history=p.assignments.filter(a=>a.leadId===l.id&&a.channel===ch);
   const latest=history.at(-1);
   const attempts=history.filter(a=>a.marks.includes('Attempted')).length;
   const links=listed.map(item=>outreachLink(ws,p,l,ch,item.value,handleLabel(item.value))).join('<br>');
   const canAttempt=listed.some(item=>contactAllowed(ws,p,l,ch,item.value));
   const status=listed.length?(latest?.marks.at(-1)||(canAttempt?'Available':'Unavailable')):'—';
   const controls=listed.length?marks.map(mark=>btn(mark,'lead-mark','subtle'+(latest?.marks.includes(mark)?' active':''),{
    'data-channel':ch,'data-mark':mark,disabled:(mark==='Attempted'&&!canAttempt)||(latest?.day===day(ws.timezone)&&latest.marks.includes(mark))
   })).join(''):'';
   const handle=(links||'<span class="muted">Not found in list</span>')+
    btn('Edit','dialog','subtle',{'data-kind':'channel-edit','data-channel':ch,'aria-label':'Edit '+ch+' handle'});
   return tr([e(ch),handle,e(listed.length?'Unassessed':'—'),e(status),e(attempts||'—'),controls]);
  });
  content=card('Channels',table(['Channel','Handle','Risk','Status','Attempts','Mark'],rows,'lead-channel-table'));
 }
 if(tab==='people'){
  const roles=p.targeting.roles.map(x=>x.toLowerCase());
  const rows=l.contacts.map(c=>tr(['<strong>'+e(c.name)+'</strong>','<span title="'+e(c.title||'')+'">'+e(c.designation||c.title||'—')+'</span>',c.email?verifyBadge(c.email_verified)+outreachLink(ws,p,l,'Email',c.email,c.email):'—',c.linkedin?(contactAllowed(ws,p,l,'LinkedIn',c.linkedin)?'<a class="accent" href="'+e(c.linkedin)+'" target="_blank" rel="noopener noreferrer" title="Open LinkedIn profile" aria-label="Open LinkedIn profile">'+icon('linkedin')+'</a>':icon('linkedin')+' <span class="pill off">Unavailable for outreach</span>'):'—',c.source?ext(c.source,'Source'):'—',
    roles.some(r=>((c.designation||'')+' '+(c.title||'')).toLowerCase().includes(r))?'<span class="pill green">Target role</span>':'',
    btn('Edit','dialog','subtle',{'data-kind':'contact-edit','data-id':c.id})+
    (limaAvailable&&!l.erasedAt&&!c.email?btn('Find work email','lima-email','subtle',{'data-id':c.id,title:'LimaData lookup · up to 1 credit'}):'')]));
  content=card('People','<div class="flex between"><p class="muted small">'+(roles.length?'Contacts matching the project’s target roles are labelled.':'Add names and professional contact details for this company.')+'</p>'+btn('+ Add person','dialog','primary',{'data-kind':'contact-add'})+'</div>'+
    '<div class="row-gap">'+table(['Name','Designation','Email','LinkedIn','Evidence','Fit',''],rows.length?rows:[blankRow(7,'No people have been added for this lead.')])+'</div>');
 }
 if(tab==='notes'){
  content=card('Notes',form('note',area('Add a note','text','',{required:true})+'<label>Channel'+select('channel',['General',...channels],'General')+'</label>','Add note')+
  '<div class="row-gap">'+(l.notes.map(n=>'<div class="note"><strong>'+e(n.author)+'</strong> <span class="pill">'+e(n.channel)+'</span><div class="small muted">'+e(date(n.at,ws.timezone))+'</div><div class="row-gap">'+e(n.text)+'</div></div>').join('')||empty('No notes yet.'))+'</div>');
 }
 if(tab==='history'){
  const rows=p.history.filter(x=>x.leadId===l.id);
  content=card('History',rows.map(n=>'<div class="activity"><span class="small muted">'+e(date(n.at,ws.timezone))+'</span><strong>'+e(n.type)+'</strong><span>'+e(n.channel)+'</span></div>').join('')||empty('No activity for this lead yet.'));
 }
 if(tab==='drafts'){
  const ch=ui.draftChannel||'LinkedIn',d=ui.draftEdits?.[ch]||l.drafts[ch]||{subject:'',body:''};
  content=card('Drafts','<div class="filters">'+segment(['Email','LinkedIn','Instagram'],ch,'draft-channel')+'</div>'+
   form('draft','<input type="hidden" name="channel" value="'+e(ch)+'">'+(ch==='Email'?field('Subject','subject',d.subject):'')+area('Message','body',d.body)+
   '<div class="flex">'+btn('Start from template','draft-template','',{'data-channel':ch})+btn('Copy message','draft-copy')+'</div>','Save draft'));
 }
 if(tab==='enrichment'){
  const rows=p.enrichments.filter(x=>x.leadId===l.id);
  content=card('Enrichment','<div class="flex between"><p class="small muted">Review sourced findings for '+e(l.domain)+'.</p>'+
    btn('Record findings','dialog','',{'data-kind':'enrich-record'})+btn('Re-enrich '+l.domain,'enrich-web','primary')+
    (firecrawlAvailable&&!l.erasedAt?btn('Find on site with Firecrawl (2 credits)','enrich-firecrawl'):'')+
    (perplexityAvailable&&!l.erasedAt?btn('Find on site with Perplexity','enrich-perplexity'):'')+'</div>'+
   '<div class="row-gap">'+(rows.map(x=>'<div class="note"><strong>'+e(date(x.at,ws.timezone))+'</strong>'+
   (x.provider?' <span class="muted small">· '+e(x.provider)+'</span>':'')+
   '<p>'+e(x.findings)+'</p><div>'+ext(x.source,'Source')+'</div></div>').join('')||empty('No enrichment results yet.'))+'</div>');
 }
 const meta=[ext('https://'+l.domain,l.domain),e([l.city,l.country].filter(Boolean).join(', ')),e(l.leadSource)].filter(Boolean).join(' · ');
 return name+'<div class="detail-top row-gap">'+header(e(l.name),meta,actions)+edit+'</div>'+summary+
 tabs(items,tab,t=>go('lead',p.id,l.id,t))+content;
}
export function newProjectPage(ws,ui){
 if(!ui.newMode)return '<div class="narrow">'+header('Do you already have leads?','Either path creates a project with its own list, targeting and channels.',link('Cancel',go('home')))+
 '<div class="grid2">'+card('No — find leads for me','<p>Describe the companies you want and review the results.</p><div class="row-gap">'+btn('Start searching →','new-mode','primary',{'data-value':'find'})+'</div>')+
 card('Yes — I have a list','<p>Create the project, then upload an Excel or CSV file or paste domains.</p><div class="row-gap">'+btn('Create project →','new-mode','',{'data-value':'import'})+'</div>')+'</div></div>';
 return '<div class="narrow">'+header('New project','Set up a separate lead list.',btn('Back','new-mode','',{'data-value':''}))+card('Project details',
 form('project-add',field('Project name','name','',{required:true,placeholder:'Wind and solar outreach'})+field('Your website','website','',{placeholder:'grynh2.com'})+area('What you offer','offer')+area('Ideal customer','ideal'),'Create project'))+'</div>';
}
export function findPage(ws,p,ui,{webSearch,firecrawlAvailable,perplexityAvailable}={}){
 const f=ui.find||{step:0,query:'',offer:p.targeting.offer||'',source:webSearch?'web':'local'};
 const steps=['Customers','Your business','Check search','Find'];
 const wizard='<ol class="step-list" aria-label="Search progress">'+steps.map((label,i)=>'<li class="'+(i===f.step?'active':i<f.step?'done':'')+'"'+(i===f.step?' aria-current="step"':'')+'><span>'+label+'</span></li>').join('')+'</ol>';
 let body='';
  if(f.step===0)body='<section class="find-question"><h2>Who are you looking for?</h2><p class="find-intro">Describe your ideal customers in your own words. Vitalise turns it into a search you can check before anything runs.</p>'+
 '<form class="find-query" data-form="find-step"><textarea class="find-query-text" name="query" aria-label="Describe your ideal companies" required placeholder="e.g. Boutique hotels in Lisbon and Porto with their own website and 10–40 rooms">'+e(f.query)+'</textarea>'+
 '<div class="find-query-footer"><small>Mention the type of business, where, and what makes them a good fit.</small><button type="submit" class="btn primary"'+(f.query.trim()?'':' disabled')+'>Continue →</button></div></form>'+
 '<div class="find-examples"><p>Try an example</p>'+['European wind developers seeking equity partners','Solar owners in Spain with operating assets','US renewable power producers seeking co-development'].map(x=>'<button type="button" data-action="find-example" data-value="'+e(x)+'">'+e(x)+'<span aria-hidden="true">↗</span></button>').join('')+'</div></section>';
  if(f.step===1)body='<div class="find-crumb">— Customers</div>'+
  '<div class="find-looking"><span>Looking for</span><p>'+e(f.query||'—')+'</p></div>'+
  '<h2 class="find-title">What do you sell them?</h2>'+
  '<p class="find-help">We use this to score every company we find — high fit if they are likely to need it, low fit if they only match the search.</p>'+
  card('Your business',form('find-step',field('Your website','website',f.website||p.targeting.website,{placeholder:'yourcompany.com'})+area('What you offer','offer',f.offer,{placeholder:'e.g. A tool that saves small teams time on a task they do every week.'}),'Build my search →'));
  if(f.step===2)body='<div class="find-crumb">— Your business</div>'+
  '<h2 class="find-title">Check the search</h2>'+
  '<p class="find-help">Review what we’ll search for and choose a source before running it.</p>'+
  card('Check search',form('find-search',area('Search description','query',f.query,{required:true})+'<label>Search source'+select('source',[
 ['Saved workspace leads','local'],...(webSearch?[['Exa company search','web']]:[]),
 ...(firecrawlAvailable?[['Firecrawl v2 web search (2 credits)','firecrawl']]:[]),
 ...(perplexityAvailable?[['Perplexity web search','perplexity']]:[])
 ],f.source)+'</label>'+
 (webSearch?note('Exa may use credits on the account connected to this server.'):'')+
 (firecrawlAvailable?note('Firecrawl checks the credit balance before searching. Review the results and select the company websites you want to add.'):'')+
 (perplexityAvailable?note('Perplexity searches use the account connected to this server.'):'')+
  (!webSearch&&!firecrawlAvailable&&!perplexityAvailable?note('Configure a web search provider in Apps.'):''),
  'Start search →'));
  if(f.step===3){
   const rows=f.rows||[], existing=new Set(p.leads.map(l=>l.domain)), reviewWebResults=['firecrawl','perplexity'].includes(f.source);
   body='<div class="find-crumb">— Check search</div>'+
   '<h2 class="find-title">Find</h2>'+
   '<p class="find-help">'+(rows.length?rows.length+' companies matched your search. Keep the ones you want to add.':'No matching companies were found.')+'</p>'+
   card('Review results',rows.length?form('find-add',
   (reviewWebResults?note('These web results can include articles and directories. Select the official company websites that match your search.'):'')+
   table(['Keep','Company','Domain','Region'],rows.map((r,i)=>tr([
   check('row-'+i,!reviewWebResults&&!existing.has(r.domain),'',{'aria-label':'Keep '+r.name}),
   e(r.name)+(reviewWebResults&&r.description?'<small class="subline">'+e(r.description.slice(0,250))+'</small>':''),
   ext(reviewWebResults?r.source:'https://'+r.domain,r.domain),e(r.country||'—')
  ]))),'Add selected leads'):empty('No matching companies were found. Change the description and try again.'));
 }
 return '<div class="find-page">'+header('Find leads')+wizard+'<div class="find-content">'+body+(f.step?'<div class="row-gap">'+btn('← Back','find-back')+'</div>':'')+'</div></div>';
}
export function importPage(ws,p,ui){
 const ready=ui.importData;
 const history=p.imports.map(x=>tr([e(x.label),e(date(x.at,ws.timezone)),x.added,x.updated??'—',x.duplicates-(x.updated||0),x.skipped]));
 const last=p.enrichments[0];
 const notices=last?card('Last enrichment','<p>'+e(last.domain)+' · '+e(date(last.at,ws.timezone))+'</p><p>'+e(last.findings)+'</p>'):'';
 let body='';
 if(ui.importOpen||ready){
  const file='<div class="file-drop"><label>Excel, CSV or TSV<input name="file" type="file" accept=".xlsx,.csv,.tsv,.txt"></label>'+
    '<div class="flex"><span data-import-filename>'+e(ui.importFile?.name||'No file selected')+'</span>'+
    btn('Clear file','import-clear-file','subtle',{disabled:!ui.importFile})+'</div></div>';
  body=card('Upload or paste domains',form('import-preview',file+
    area('Or paste domains / CSV','paste',ui.importPaste||'',{placeholder:'company,domain,country\nExample Power,example.com,Spain'}),'Preview import'));
  if(ready){
   const rows=ready.rows.map(x=>tr([x.record,e(x.name||'—'),e(x.domain||'—'),e(x.reason)+
    (x.warnings.length?'<small class="subline">'+e(x.warnings.join('. '))+'</small>':'')]));
   const counts='<p class="small muted">'+ready.added+' new · '+ready.updated+' updated · '+(ready.duplicates-ready.updated)+' unchanged · '+ready.skipped+' skipped · '+ready.warnings+' with warnings</p>';
   const review='<div class="table-shell" style="max-height:360px;overflow:auto">'+table(['Record','Company','Domain','Result'],rows)+'</div>';
   const controls=ready.added||ready.updated?form('import-commit',counts+review,'Import '+(ready.added+ready.updated)+' records'):counts+review;
   body+='<div class="row-gap" data-import-review>'+card('Review '+ready.rows.length+' records',controls)+'</div>';
  }
 }
 return header('Import','Upload Excel or CSV lists. Leads are deduplicated by domain.',btn('New import','import-open','primary'),'<b>'+p.leads.length+' / '+p.maxLeads.toLocaleString()+' leads</b>')+
  (notices?'<div class="row-gap">'+notices+'</div>':'')+(body?'<div class="row-gap">'+body+'</div>':'')+'<div class="row-gap">'+
  card('Recent imports',table(['File or source','Date','Added','Updated','Unchanged','Skipped'],history.length?history:[blankRow(6,'No imports yet. Upload Excel or CSV to get started.')]))+'</div>';
}
