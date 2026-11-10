import {cleanDomain,normalizeEmail} from './model.mjs';

export const perplexityAvailable = () => Boolean(process.env.PERPLEXITY_API_KEY?.trim());
export const limaAvailable = () => Boolean(process.env.LIMADATA_API_KEY?.trim());
const failure = (status,message) => Object.assign(new Error(message),{status});
const limaBase = 'https://api.limadata.com/api/v1';
const LIMA_EMAIL_LOOKUP_COST = 4; // credits per find/email_work lookup
let limaBusy = false;

async function providerRequest(provider,url,headers,body){
  let response;
  try{
    response = await fetch(url,{
      method:body?'POST':'GET', redirect:'error', signal:AbortSignal.timeout(15000),
      headers:{...headers,...(body?{'content-type':'application/json'}:{})},
      body:body?JSON.stringify(body):undefined
    });
  }catch(error){
    if(error.name==='TimeoutError')throw failure(504,provider+' timed out.');
    throw failure(502,provider+' could not be reached.');
  }
  return response;
}

async function providerJson(provider,response){
  if(response.status===401||response.status===403)throw failure(502,provider+' rejected the configured key or its access.');
  if(response.status===402)throw failure(402,provider+' reported insufficient credits.');
  if(response.status===429)throw failure(429,provider+' rate limit reached. Try again later.');
  if(!response.ok)throw failure(502,provider+' returned HTTP '+response.status+'.');
  const data = await response.json().catch(()=>null);
  if(!data||typeof data!=='object')throw failure(502,provider+' returned an invalid response.');
  return data;
}

const providerMessage=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,300):'';

export function classifyLimaResult(result,domain){
  if(!result||typeof result!=='object')throw failure(502,'LimaData returned an invalid response.');
  if(result.found===false||result.status==='not_found'||result.status==='no_result'){
    return {outcome:'no_result',email:'',message:providerMessage(result.message)||'LimaData found no matching work email.'};
  }
  const email=normalizeEmail(result.email??result.data?.email??result.work_email);
  if(email){
    const mailDomain=email.split('@').at(-1);
    if(mailDomain===domain||mailDomain.endsWith('.'+domain)){
      return {outcome:'match',email,message:providerMessage(result.message)||'LimaData returned a matching work email.'};
    }
    return {outcome:'invalid_result',email:'',message:'LimaData returned an email outside the company domain.'};
  }
  return {outcome:'no_result',email:'',message:providerMessage(result.message)||'LimaData returned no matching work email.'};
}

export function webResearchRows(results,domain,provider,descriptionField){
  const rows = new Map();
  for(const result of results){
    if(typeof result?.url!=='string'||result.url.length>400)continue;
    const url = URL.parse(result.url);
    if(!url||url.username||url.password||!['http:','https:'].includes(url.protocol))continue;
    const host = cleanDomain(url.hostname);
    const rawDescription = result[descriptionField];
    const description = typeof rawDescription==='string'?rawDescription.trim().slice(0,4000):'';
    if(!host||rows.has(host)||(domain&&(host!==domain||!description)))continue;
    const name = typeof result.title==='string'?result.title.trim().slice(0,140):'';
    rows.set(host,{name:name||host,domain:host,description,website:result.url,source:result.url,leadSource:provider});
  }
  return [...rows.values()];
}

export async function perplexitySearch(query,domain=''){
  const key = process.env.PERPLEXITY_API_KEY?.trim();
  if(!key)throw failure(503,'Set PERPLEXITY_API_KEY in the local server environment to enable Perplexity.');
  const response = await providerRequest('Perplexity','https://api.perplexity.ai/search',{authorization:'Bearer '+key},{
    query,max_results:10,max_tokens_per_page:512,...(domain?{search_domain_filter:[domain]}:{})
  });
  const payload = await providerJson('Perplexity',response);
  if(!Array.isArray(payload.results))throw failure(502,'Perplexity returned invalid search results.');
  return webResearchRows(payload.results.slice(0,10),domain,'Perplexity','snippet');
}

export async function findLimaEmail(name,domain){
  const key = process.env.LIMADATA_API_KEY?.trim();
  if(!key)throw failure(503,'Set LIMADATA_API_KEY in the local server environment to enable LimaData.');
  if(limaBusy)throw failure(429,'A LimaData lookup is already running.');
  limaBusy = true;
  const headers = {'x-api-key':key};
  try{
    const balance = await providerJson('LimaData',await providerRequest('LimaData',limaBase+'/credits/balance',headers));
    if(!Number.isFinite(balance.balance))throw failure(502,'LimaData did not provide a readable credit balance.');
    if(balance.balance<LIMA_EMAIL_LOOKUP_COST)throw failure(402,`LimaData needs at least ${LIMA_EMAIL_LOOKUP_COST} credits for a lookup.`);
    const response = await providerRequest('LimaData',limaBase+'/find/email_work',headers,{full_name:name,company_domain:domain});
    if(response.status===404)return {outcome:'no_result',email:'',message:'LimaData found no matching work email.'};
    const result = await providerJson('LimaData',response);
    return classifyLimaResult(result,domain);
  }finally{limaBusy=false;}
}
