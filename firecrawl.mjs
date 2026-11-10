import {webResearchRows} from './research-providers.mjs';

const base = 'https://api.firecrawl.dev/v2';
const creditFloor = 105;
// A web search of up to ten results costs two credits without scraping.
const searchLimit = 10;
const searchCredits = 2;
let busy = false;

export const firecrawlAvailable = () => Boolean(process.env.FIRECRAWL_API_KEY?.trim());
const failure = (status,message) => Object.assign(new Error(message),{status});

async function request(path,key,body){
  let response;
  try {
    response = await fetch(base+path,{
      method:body?'POST':'GET', redirect:'error', signal:AbortSignal.timeout(15000),
      headers:{authorization:'Bearer '+key,...(body?{'content-type':'application/json'}:{})},
      body:body?JSON.stringify(body):undefined
    });
  } catch (error) {
    if(error.name==='TimeoutError')throw failure(504,'Firecrawl timed out.');
    throw failure(502,'Firecrawl could not be reached.');
  }
  if(response.status===401||response.status===403)throw failure(502,'Firecrawl rejected the configured key or its access.');
  if(response.status===402)throw failure(402,'Firecrawl reported insufficient credits.');
  if(response.status===429)throw failure(429,'Firecrawl rate limit reached. Try again later.');
  if(!response.ok)throw failure(502,'Firecrawl returned HTTP '+response.status+'.');
  const result = await response.json().catch(()=>null);
  if(result?.success!==true)throw failure(502,'Firecrawl returned an invalid response.');
  return result.data;
}

export async function firecrawlSearch(query,domain=''){
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if(!key)throw failure(503,'Set FIRECRAWL_API_KEY in the local server environment to enable Firecrawl.');
  if(busy)throw failure(429,'A Firecrawl search is already running. Try again when it finishes.');
  busy = true;
  try {
    const balance = await request('/team/credit-usage',key);
    if(!Number.isFinite(balance?.remainingCredits)){
      throw failure(502,'Firecrawl did not provide a readable credit balance. Search stopped.');
    }
    if(balance.remainingCredits-searchCredits<creditFloor){
      throw failure(402,'Firecrawl search stopped to preserve the 105-credit reserve.');
    }
    const data = await request('/search',key,{query,limit:searchLimit,sources:['web']});
    if(!Array.isArray(data?.web))throw failure(502,'Firecrawl returned invalid web results.');
    return webResearchRows(data.web.slice(0,searchLimit),domain,'Firecrawl v2','description');
  } finally {
    busy = false;
  }
}
