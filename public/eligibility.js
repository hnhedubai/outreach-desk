const phoneKinds=['Phone','Call','SMS','WhatsApp'];
export const suppressionKind=kind=>phoneKinds.includes(kind)?'Phone':kind;

export function handleKey(kind,value){
 const raw=String(value??'').trim();
 if(!raw)return '';
 if(phoneKinds.includes(kind)){
  if(!/^\+?[\d ().-]+$/.test(raw))return '';
  const digits=raw.replace(/\D/g,'');
  const number=digits.startsWith('00')?digits.slice(2):digits;
  return number.length>=6?number:'';
 }
 if(kind==='Email')return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)?raw.toLowerCase():'';
 if(['LinkedIn','Instagram','Domain'].includes(kind)){
  try{
   const url=new URL(raw.includes('://')?raw:'https://'+raw);
   if(!['http:','https:'].includes(url.protocol))return '';
   const host=url.hostname.toLowerCase();
   if(kind==='Domain')return host.replace(/^www\./,'');
   const base=kind==='LinkedIn'?'linkedin.com':'instagram.com';
   const path=decodeURIComponent(url.pathname).toLowerCase().replace(/\/+$/,'');
   return (host===base||host.endsWith('.'+base))&&path?base+path:'';
  }catch{return '';}
 }
 return '';
}

export function isSuppressed(ws,lead,kind,value){
 const key=handleKey(kind,value),type=suppressionKind(kind);
 return ws.suppressions.some(entry=>{
  if(entry.removedAt)return false;
  const entryType=suppressionKind(entry.kind);
  return entryType==='Domain'?handleKey('Domain',entry.value)===lead.domain:
   Boolean(key)&&entryType===type&&handleKey(entry.kind,entry.value)===key;
 });
}

export function contactAllowed(ws,project,lead,channel,value){
 return Boolean(lead&&handleKey(channel,value)&&project.configs[channel]?.enabled&&
  !lead.notFit&&!['Lost','Churned'].includes(lead.lifecycle)&&!isSuppressed(ws,lead,channel,value)&&
  (channel!=='Email'||!project.configs.Email.corporate||value.toLowerCase().endsWith('@'+lead.domain)));
}
