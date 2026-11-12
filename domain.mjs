// Domain verification via DNS-over-HTTPS (Google). Zero-dep, HTTPS-egress only,
// so it works in the sandbox, locally, and on Render without raw DNS/53.
// "Valid" = the domain exists AND publishes an MX record (can receive email),
// which is the meaningful signal for email outreach.
const DOH='https://dns.google/resolve';

// Pure classifier, testable without network. Maps a DoH JSON response to a status.
export function classifyDnsMx(json){
  if(!json||typeof json!=='object')return {status:'error',mx:0};
  if(json.Status===3)return {status:'not_found',mx:0};   // NXDOMAIN — domain does not exist
  if(json.Status!==0)return {status:'error',mx:0};        // SERVFAIL / refused / etc.
  const mx=(Array.isArray(json.Answer)?json.Answer:[]).filter(a=>a&&a.type===15).length;
  return {status:mx>0?'valid':'no_mx',mx};
}

export async function verifyDomainMx(domain){
  if(!domain)return {status:'error',mx:0};
  try{
    const response=await fetch(DOH+'?name='+encodeURIComponent(domain)+'&type=MX',{
      method:'GET',redirect:'error',signal:AbortSignal.timeout(8000),headers:{accept:'application/dns-json'}
    });
    if(!response.ok)return {status:'error',mx:0};
    return classifyDnsMx(await response.json());
  }catch{return {status:'error',mx:0};}
}

// Bounded-concurrency batch over unique domains. Returns Map(domain -> {status,mx}).
export async function verifyDomains(domains,concurrency=6){
  const unique=[...new Set(domains.filter(Boolean))];
  const results=new Map();
  let i=0;
  const worker=async()=>{while(i<unique.length){const d=unique[i++];results.set(d,await verifyDomainMx(d));}};
  await Promise.all(Array.from({length:Math.min(concurrency,unique.length)},worker));
  return results;
}
