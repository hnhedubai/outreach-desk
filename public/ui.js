import {contactAllowed,handleKey} from './eligibility.js';

export const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const channels=['Call','Email','Instagram','LinkedIn','SMS','WhatsApp'];
export const leadChannels=['Email','WhatsApp','Instagram','LinkedIn','SMS','Call'];
export const marks=['Attempted','Replied','Opt-out','Bounce','Invalid handle'];
export const lifecycles=['Prospect','Engaged','Active','Churned','Lost'];
export const menus=[['Today','today'],['Leads','leads'],['Find leads','find'],['Import','import'],['Overview','overview'],['Targeting','targeting'],['Analytics','analytics'],['Channels','channels'],['Agents','agents']];
export const labels=Object.fromEntries(menus.map(([label,page])=>[page,label]));
export const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n||0);
export const date=(stamp,timezone='Asia/Dubai')=>stamp?new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:timezone}).format(new Date(stamp)):'';
export const day=(tz='Asia/Dubai')=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,dateStyle:'short'}).format(new Date());
export const icon=(name)=>{
 const paths={home:'<path d="M2 8 8 3l6 5v6h-4V9H6v5H2z"/>',team:'<circle cx="6" cy="5" r="2"/><path d="M2 14v-2a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v2m1-11a2 2 0 1 1 0 4m1 2a3 3 0 0 1 2 3v2"/>',dnc:'<circle cx="8" cy="8" r="6"/><path d="m4 4 8 8"/>',settings:'<circle cx="8" cy="8" r="2.3"/><path d="m6 2 4 0 .5 2 2 .8 1.5 1.7-1 1.5 1 1.5-1.5 1.7-2 .8-.5 2H6l-.5-2-2-.8L2 9.5 3 8 2 6.5l1.5-1.7 2-.8z"/>',apps:'<rect x="2" y="2" width="5" height="5" rx=".7"/><rect x="9" y="2" width="5" height="5" rx=".7"/><rect x="2" y="9" width="5" height="5" rx=".7"/><rect x="9" y="9" width="5" height="5" rx=".7"/>',down:'<path d="m4 6 4 4 4-4"/>',mail:'<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="m3 5 5 4 5-4"/>',layers:'<path d="m2 6 6-3 6 3-6 3zM2 9l6 3 6-3m-12 3 6 3 6-3"/>',logo:'<path d="m2 12 5-7 3 3 4-4m-3 0h3v3"/>',plus:'<path d="M8 3v10M3 8h10"/>',menu:'<path d="M2 4h12M2 8h12M2 12h12"/>'};
 return '<svg viewBox="0 0 16 16" class="icon" aria-hidden="true">'+(paths[name]||paths.layers)+'</svg>';
};
export const attr=(obj={})=>Object.entries(obj).filter(([,v])=>v!==undefined&&v!==false).map(([k,v])=>v===true?' '+k:' '+k+'="'+e(v)+'"').join('');
export const btn=(label,action,classes='',data={})=>' <button type="button" class="btn '+e(classes)+'"'+attr({'data-action':action,...data})+'>'+e(label)+'</button>';
export const go=(page,p='',l='',tab='')=>'#/'+[p?'p':'',p,page,l,tab].filter(Boolean).map(encodeURIComponent).join('/');
export const link=(label,href,classes='btn')=>'<a class="'+e(classes)+'" href="'+e(href)+'">'+e(label)+'</a>';
export const rowLink=(lead,p)=>go('lead',p.id,lead.id,'channels');
export const ext=(value,label=value)=>{
 try{const u=new URL(value);if(!['https:','http:','mailto:'].includes(u.protocol))return e(label);return '<a class="accent" href="'+e(u.href)+'" target="_blank" rel="noopener noreferrer">'+e(label)+'</a>';}catch{return e(label);}
};
export function outreachLink(ws,p,lead,channel,value,label){
 if(!contactAllowed(ws,p,lead,channel,value))return e(label)+' <span class="pill off">Unavailable for outreach</span>';
 const number=String(value).replace(/[ ().-]/g,'');
 if(channel==='Call'||channel==='SMS'){
  const prefix=channel==='Call'?'tel:':'sms:';
  return '<a class="accent" href="'+e(prefix+number)+'">'+e(label)+'</a>';
 }
 const href=channel==='Email'?'mailto:'+encodeURIComponent(value).replace(/%40/g,'@'):
  channel==='WhatsApp'?'https://wa.me/'+handleKey(channel,value):value;
 return ext(href,label);
}
export const select=(name,values,current,extra={})=>'<select '+attr({name,'aria-label':name,...extra})+'>'+values.map(v=>{
 const [label,value]=Array.isArray(v)?v:[v,v];return '<option value="'+e(value)+'"'+(String(value)===String(current)?' selected':'')+'>'+e(label)+'</option>';
}).join('')+'</select>';
export const check=(name,checked,cls='',extra={})=>'<input type="checkbox" name="'+e(name)+'" class="'+e(cls)+'"'+attr({checked,...extra})+'>';
export const field=(label,name,value='',extra={})=>'<label>'+e(label)+'<input'+attr({name,value,...extra})+'></label>';
export const area=(label,name,value='',extra={})=>'<label>'+e(label)+'<textarea'+attr({name,...extra})+'>'+e(value)+'</textarea></label>';
export const form=(name,content,save='Save changes',extra={})=>'<form class="form"'+attr({'data-form':name,...extra})+'>'+content+'<div class="actions"><button class="btn primary" type="submit">'+e(save)+'</button></div></form>';
export const header=(title,description='',actions='',meta='')=>'<header class="page-head"><div><h1>'+title+'</h1>'+(description?'<p>'+description+'</p>':'')+(meta?'<div class="meta">'+meta+'</div>':'')+'</div><div class="page-actions">'+actions+'</div></header>';
export const card=(title,html,extra='')=>'<section class="card plain '+e(extra)+'"><h3>'+e(title)+'</h3><div class="row-gap">'+html+'</div></section>';
export const empty=text=>'<div class="empty">'+e(text)+'</div>';
export const table=(cols,rows,classes='')=>'<div class="table-shell '+e(classes)+'"><table><thead><tr>'+cols.map(x=>'<th>'+e(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>';
export const tr=(cells,extra={})=>'<tr'+attr(extra)+'>'+cells.map(x=>'<td>'+x+'</td>').join('')+'</tr>';
export const blankRow=(cols,text)=>'<tr><td colspan="'+cols+'">'+empty(text)+'</td></tr>';
export const bar=(pct,classes='')=>'<div class="bar '+e(classes)+'"><i style="width:'+Math.max(0,Math.min(100,Number(pct)||0))+'%"></i></div>';
export const stat=(label,value,detail)=>'<div class="card stat"><div class="label">'+e(label)+'</div><div class="stat-num">'+e(value)+'</div><div class="small muted">'+e(detail)+'</div></div>';
export const tabs=(items,current,prefix)=>'<nav class="tabs">'+items.map(([name,value])=>'<a class="'+(value===current?'active':'')+'" href="'+e(prefix(value))+'">'+e(name)+'</a>').join('')+'</nav>';
export const segment=(items,current,action,key='value')=>'<div class="segmented">'+items.map(item=>{const [label,value]=Array.isArray(item)?item:[item,item];return btn(label,action,value===current?'active':'',{['data-'+key]:value,'aria-pressed':value===current?'true':'false'});}).join('')+'</div>';
export const handleLabel=h=>String(h||'').replace(/^https?:\/\/(?:www\.)?/,'');
export function handles(lead,ch){
 const key=ch==='Email'?'email':ch==='LinkedIn'?'linkedin':'';
 const h=key?lead.contacts.filter(x=>x[key]).map(x=>({name:x.name,value:x[key]})):[];
 if(lead.channels[ch])h.push({name:lead.name,value:lead.channels[ch]});
 return [...new Map(h.map(x=>[x.value.toLowerCase(),x])).values()];
}
export const worked=a=>a.marks.length>0;
export const jevFitScore=l=>l.jevFit?.stale?null:l.jevFit?.score??null;
export const leadState=(l,p)=>{const m=p.assignments.filter(a=>a.leadId===l.id).flatMap(a=>a.marks);return m.some(x=>x==='Opt-out'||x==='Bounce')?'Opted out or bounced':m.includes('Replied')?'Replied on any channel':m.includes('Attempted')?'Attempted, no reply':'Not contacted';};
export const lifecycleClass=x=>'status'+(['Active','Engaged'].includes(x)?' green':'');
export const enabledChannels=p=>channels.filter(x=>p.configs[x].enabled);
export const todayRows=(ws,p)=>p.assignments.filter(a=>a.day===day(ws.timezone));
export const leadTitle=l=>'<span class="table-name">'+e(l.name)+'</span><small class="subline">'+e(l.domain)+(l.country?' · '+e(l.country):'')+'</small>';
export const channelTag=(c,active=true)=>'<span class="pill '+(c==='LinkedIn'?'in ':'')+(active?'':'off')+'">'+e(({LinkedIn:'IN',Email:'EM',Instagram:'IG',WhatsApp:'WA',Call:'TEL'})[c]||c)+'</span>';
export const note=(text)=>'<p class="notice small">'+e(text)+'</p>';


