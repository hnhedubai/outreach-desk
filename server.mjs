import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openStore} from './db.mjs';
import {createState,perform,cleanDomain,runDaily,reconcileAssignments,recordJevFit} from './model.mjs';
import {currentJevFit,jevAvailable,jevInput,scoreWithJev} from './jev.mjs';
import {firecrawlAvailable,firecrawlSearch} from './firecrawl.mjs';
import {perplexityAvailable,perplexitySearch,limaAvailable,findLimaEmail} from './research-providers.mjs';
import {authUsername,clearSessions,createSession,destroySession,ensureAuth,readAuth,sessionFrom,setPassword,verifyPassword} from './auth.mjs';
export function classifyStreamError(error,req){
 if(error&&error.status)return {status:error.status,message:error.message};
 if(req?.destroyed||req?.aborted||['ERR_STREAM_PREMATURE_CLOSE','ECONNRESET','EPIPE','ABORTED'].includes(error?.code))
  return {status:400,message:'The request was interrupted. Please try again.'};
 throw error;
}
export const csv=value=>{
 const text=String(value??'');
 const safe=/^[=+\-@\t\r]/.test(text)?"'"+text:text;
 return '"'+safe.replace(/"/g,'""')+'"';
};
export async function createApp({db:providedDb,dataDir:providedDataDir,port:requestedPort}={}){
const root=dirname(fileURLToPath(import.meta.url));
const port=Number(requestedPort??process.env.PORT??8282);
const dataDir=providedDataDir||process.env.OUTREACH_DATA_DIR||join(root,'data');
await mkdir(dataDir,{recursive:true});
const store=await openStore({providedDb,dataDir});
const auth=await ensureAuth(dataDir);
await store.seed(JSON.stringify(createState()));
const read=async()=>{
 const row=await store.getState();
 if(!row)throw requestError(500,'Saved workspace data is unreadable. Restore it from a backup.');
 try{return {...JSON.parse(row.document),revision:row.revision};}
 catch{throw requestError(500,'Saved workspace data is unreadable. Restore it from a backup.');}
};
// Serialize state for storage; a state larger than V8's max string length is reported, not crashed.
const encodeState=state=>{
 try{return JSON.stringify(state);}
 catch{throw requestError(507,'The workspace is too large to save. Reduce its size and try again.');}
};
const maintain=async()=>{
 const state=await read();
 const reconciled=reconcileAssignments(state);
 const generated=runDaily(state);
 if(!reconciled&&!generated)return state;
 const previous=state.revision;state.revision++;
 return await store.save(state.revision,encodeState(state),previous)?state:await read();
};
const load=async()=>maintain();
const send=(res,status,data,type='application/json; charset=utf-8')=>{
 if(res.destroyed||res.writableEnded||res.headersSent)return;
 let payload=data;
 if(type.startsWith('application/json')){
  try{payload=JSON.stringify(data);}
  catch{status=500;payload=JSON.stringify({error:'The response could not be encoded.'});}
 }
 try{
  res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'","Referrer-Policy":"no-referrer"});
  res.end(payload);
 }catch{/* the client disconnected before the response completed */}
};
async function body(req,limit=3_000_000){
 const tooLarge=()=>Object.assign(new Error('The request is too large. Split the import into smaller batches.'),{status:413});
 if(Number(req.headers['content-length'])>limit){req.resume();throw tooLarge();}
 const chunks=[];
 let size=0;
 try{
  for await(const chunk of req.iterator({destroyOnReturn:false})){
   size+=chunk.length;
   if(size>limit){req.resume();throw tooLarge();}
   chunks.push(chunk);
  }
 }catch(error){
  const classified=classifyStreamError(error,req);
  if(error?.status)throw error;
  throw Object.assign(new Error(classified.message),{status:classified.status});
 }
 try{
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();
  return value;
 }catch{throw Object.assign(new Error('Expected a valid JSON object.'),{status:400});}
}
const paths=new Map([['/','index.html'],['/index.html','index.html'],['/app.js','app.js'],['/css/style.css','css/style.css'],['/spreadsheet.js','spreadsheet.js'],['/ui.js','ui.js'],['/eligibility.js','eligibility.js'],['/project.js','project.js'],['/workspace.js','workspace.js'],['/flow.js','flow.js'],['/fonts/Inter.ttf','fonts/Inter.ttf'],['/fonts/SpaceGrotesk.ttf','fonts/SpaceGrotesk.ttf']]);
const mime={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',ttf:'font/ttf'};
const keyAvailable=()=>Boolean(process.env.EXA_API_KEY);
const scoring=new Set();
const requestError=(status,message)=>Object.assign(new Error(message),{status});
function stateResponse(state,result){
 for(const workspace of state.workspaces)for(const project of workspace.projects)for(const lead of project.leads){
  if(lead.jevFit)lead.jevFit.stale=!currentJevFit(project,lead);
 }
 return {state,result,webSearch:keyAvailable(),jevAvailable:jevAvailable(),firecrawlAvailable:firecrawlAvailable(),
  perplexityAvailable:perplexityAvailable(),limaAvailable:limaAvailable()};
}
function scoringTarget(state,input){
 const workspace=state.workspaces.find(workspace=>workspace.id===input?.workspace);
 const project=workspace?.projects.find(project=>project.id===input.project);
 const lead=project?.leads.find(lead=>lead.id===input.lead&&!lead.erasedAt);
 if(!lead)throw requestError(404,'Lead unavailable for scoring.');
 return {workspace,project,lead};
}
async function scoreLead(input,revision){
 if(!input||Array.isArray(input)||typeof input.workspace!=='string'||typeof input.project!=='string'||typeof input.lead!=='string'||
    Object.keys(input).some(key=>!['workspace','project','lead'].includes(key))){
  throw requestError(400,'Jev accepts exactly one lead per request: workspace, project and lead.');
 }
 const state=await read();
  if(revision!==state.revision)throw requestError(409,'The workspace changed. Refresh and try again.');
 const {workspace,project,lead}=scoringTarget(state,input);
 if(!project.targeting.ideal?.trim())throw requestError(400,'Set the ideal customer in project targeting before scoring.');
 if(!lead.description?.trim()&&!lead.fitReview?.assets?.length)throw requestError(400,'Add a company brief or fit evidence before scoring.');
 const request=jevInput(project,lead);
 if(currentJevFit(project,lead))return stateResponse(state,{score:lead.jevFit.score,cached:true});
 if(scoring.size)throw requestError(409,'Another Jev record is being scored. Commit it before scoring the next record.');
 const key=JSON.stringify([workspace.id,project.id,lead.id]);
 if(scoring.has(key))throw requestError(409,'This lead is already being scored.');
 scoring.add(key);
 try{
  const fit=await scoreWithJev(request);
  const latest=await read(),target=scoringTarget(latest,input);
  if(jevInput(target.project,target.lead).basis!==fit.basis){
   throw requestError(409,'Targeting or lead evidence changed during scoring. Review and try again.');
  }
  recordJevFit(target.workspace,target.project,target.lead,fit);
   const previous=latest.revision++;
   if(!(await store.save(latest.revision,encodeState(latest),previous))){
    throw requestError(409,'The workspace changed during scoring. Refresh and try again.');
   }
  return stateResponse(latest,{score:fit.score});
 }finally{scoring.delete(key);}
}
function requirePost(req){
 if(req.method!=='POST'||!req.headers['content-type']?.startsWith('application/json'))throw Object.assign(new Error('Use a JSON POST.'),{status:405});
 if(req.headers.origin!=='http://'+req.headers.host)throw Object.assign(new Error('Cross-origin requests are unavailable.'),{status:403});
}
async function search(input,state){
 const ws=state.workspaces.find(x=>x.id===input.workspace);
 if(!ws)throw Object.assign(new Error('Workspace not found.'),{status:404});
 const provider=input.source==='firecrawl'?firecrawlSearch:input.source==='perplexity'?perplexitySearch:null;
 if(provider&&input.lead!=null){
  const project=ws.projects.find(x=>x.id===input.project);
  const lead=project?.leads.find(x=>x.id===input.lead&&!x.erasedAt);
  if(!lead)throw requestError(404,'Lead unavailable for research.');
  return provider('site:'+lead.domain+' company overview projects development partnerships',lead.domain);
 }
 const query=String(input.query||'').trim().slice(0,3000);
 if(!query)throw Object.assign(new Error('Describe the companies you are looking for.'),{status:400});
 if(provider)return provider(query);
 if(input.source!=='web'){
  const corpus=ws.projects.flatMap(p=>p.leads);
  const words=query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[];
  const ranked=[...new Map(corpus.map(x=>[x.domain,x])).values()].map(l=>({l,n:words.reduce((n,w)=>n+([l.name,l.domain,l.description,l.country,l.category].join(' ').toLowerCase().includes(w)?1:0),0)}))
   .filter(x=>x.n>0).sort((a,b)=>b.n-a.n);
  return ranked.slice(0,30).map(({l})=>({name:l.name,domain:l.domain,country:l.country,category:l.category,description:l.description,source:l.website}));
 }
 if(!keyAvailable())throw Object.assign(new Error('Set EXA_API_KEY in the local server environment to enable web search.'),{status:503});
 let response;
 try{response=await fetch('https://api.exa.ai/search',{method:'POST',headers:{'x-api-key':process.env.EXA_API_KEY,'content-type':'application/json'},
   body:JSON.stringify({query,type:'auto',category:'company',numResults:15,contents:{highlights:true}}),signal:AbortSignal.timeout(30000)});
 }catch(error){
  if(error.name==='TimeoutError')throw Object.assign(new Error('Web search timed out. Please try again.'),{status:504});
  throw Object.assign(new Error('The web search provider is unavailable.'),{status:502});
 }
 if(!response.ok)throw Object.assign(new Error('The web search provider returned HTTP '+response.status+'.'),{status:502});
 const out=await response.json().catch(()=>null),rows=[];
 if(!Array.isArray(out?.results))throw Object.assign(new Error('The web search provider returned an invalid response.'),{status:502});
 for(const result of out.results){
   if(!result||typeof result.url!=='string')continue;
   const domain=cleanDomain(result.url);if(!domain||rows.some(x=>x.domain===domain))continue;
   rows.push({name:result.entities?.[0]?.properties?.name||result.title||domain,domain,description:(Array.isArray(result.highlights)?result.highlights.join(' '):'').slice(0,4000),website:result.url,source:result.url});
 }
 return rows;
}
async function lookupContactEmail(state,input){
 const workspace=state.workspaces.find(x=>x.id===input.workspace);
 const project=workspace?.projects.find(x=>x.id===input.project);
 const lead=project?.leads.find(x=>x.id===input.lead&&!x.erasedAt);
 const contact=lead?.contacts.find(x=>x.id===input.contact);
 if(!contact)throw requestError(404,'Contact unavailable for lookup.');
 if(contact.email)throw requestError(409,'This contact already has a work email.');
 const result=await findLimaEmail(contact.name,lead.domain);
 return {...result,contact:contact.id,expectedName:contact.name,expectedDomain:lead.domain};
}
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
function exportAudit(ws,project,from,to,format){
 const rows=ws.audit.filter(e=>(!project||e.project===project)&&(!from||e.at.slice(0,10)>=from)&&(!to||e.at.slice(0,10)<=to)).map(e=>({
  time:e.at,project:e.project,action:e.type,channel:e.channel||'',lead:e.leadId?hash(e.leadId):'',contact:e.email?hash(e.email):''
 }));
 return format==='jsonl'?rows.map(x=>JSON.stringify(x)).join('\n'):['time,project,action,channel,lead,contact',...rows.map(r=>Object.values(r).map(csv).join(','))].join('\n');
}
const server=createServer(async(req,res)=>{
 try{
  const boundPort=server.address()?.port;
  if(!['127.0.0.1:'+boundPort,'localhost:'+boundPort].includes(req.headers.host)){send(res,403,{error:'Use the local app address.'});return;}
  const u=new URL(req.url,'http://localhost');
  if(u.pathname==='/api/auth/status'&&req.method==='GET'){
   send(res,200,{authenticated:Boolean(sessionFrom(req)),configured:Boolean(auth.configured)});
   return;
  }
  const publicFile=paths.get(u.pathname);
  if(req.method==='GET'&&publicFile){
   send(res,200,await readFile(join(root,'public',publicFile)),mime[publicFile.split('.').at(-1)]);
   return;
  }
  if(u.pathname==='/api/auth/login'){
   requirePost(req);
   const input=await body(req,50_000);
   if(input.username!==authUsername||!(await verifyPassword(dataDir,input.password)))throw requestError(401,'Incorrect username or password.');
   const token=createSession();
   res.setHeader('Set-Cookie','outreach_session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800');
   send(res,200,{ok:true});
   return;
  }
  if(u.pathname==='/api/auth/reset-status'&&req.method==='GET'){
   send(res,200,{configured:Boolean(await readAuth(dataDir))});
   return;
  }
  const session=sessionFrom(req);
  if(!session){send(res,401,{error:'Please log in.'});return;}
  if(u.pathname==='/api/auth/logout'){
   requirePost(req);destroySession(req);
   res.setHeader('Set-Cookie','outreach_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
   send(res,200,{ok:true});return;
  }
  if(u.pathname==='/api/auth/change-password'){
   requirePost(req);
   const input=await body(req,50_000);
   if(!(await verifyPassword(dataDir,input.currentPassword)))throw requestError(401,'Current password is incorrect.');
   await setPassword(dataDir,input.newPassword);clearSessions();
   const token=createSession();
   res.setHeader('Set-Cookie','outreach_session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800');
   send(res,200,{ok:true});return;
  }
  if(u.pathname==='/api/state'&&req.method==='GET'){send(res,200,stateResponse(await load()));return;}
  if(u.pathname==='/api/import-preview'){
    requirePost(req);
    const input=await body(req,10_000_000),state=await read();
    const result=perform(state,'import-preview',input);
    send(res,200,{result,revision:state.revision});return;
  }
  if(u.pathname==='/api/action'){
    requirePost(req);
    const input=await body(req,10_000_000);
    if(input.type==='jev-score'){send(res,200,await scoreLead(input.input,input.revision));return;}
    const state=await load();
    if(input.type==='import'&&input.input?.batchId){
      const {workspace,project,batchId}=input.input;
      if(typeof batchId!=='string'||!/^[\da-f-]{36}$/i.test(batchId))throw Object.assign(new Error('Invalid import batch ID.'),{status:400});
      const existing=state.workspaces.find(w=>w.id===workspace)?.projects.find(p=>p.id===project)?.imports.find(r=>r.batchId===batchId);
      if(existing){
       if(existing.batchHash&&existing.batchHash!==hash(JSON.stringify([input.input.label,input.input.rows]))){send(res,409,{error:'The import batch was already used for different rows.'});return;}
       send(res,200,stateResponse(state,existing));return;
      }
      input.input.batchHash=hash(JSON.stringify([input.input.label,input.input.rows]));
    }
    if(input.type==='import-preview'){send(res,400,{error:'Use the import preview endpoint.'});return;}
    if(input.revision!==state.revision){send(res,409,{error:'The workspace changed. Refresh and try again.'});return;}
    const result=perform(state,input.type,input.input);
    reconcileAssignments(state);
    const previous=state.revision;state.revision++;
    if(!(await store.save(state.revision,encodeState(state),previous))){send(res,409,{error:'The workspace changed. Refresh and try again.'});return;}
    send(res,200,stateResponse(state,result));return;
  }
  if(u.pathname==='/api/search'){
    requirePost(req);
    const input=await body(req);
    send(res,200,{rows:await search(input,['firecrawl','perplexity'].includes(input.source)?await read():await load())});return;
  }
  if(u.pathname==='/api/contact-email'){
    requirePost(req);
    const input=await body(req);
    send(res,200,await lookupContactEmail(await read(),input));return;
  }
  if(u.pathname==='/api/audit'&&req.method==='GET'){
    const ws=(await load()).workspaces.find(w=>w.id===u.searchParams.get('workspace'));if(!ws){send(res,404,{error:'Workspace unavailable.'});return;}
    const format=u.searchParams.get('format')==='jsonl'?'jsonl':'csv';
    res.setHeader('Content-Disposition','attachment; filename="outreach-audit.'+format+'"');
    send(res,200,exportAudit(ws,u.searchParams.get('project'),u.searchParams.get('from'),u.searchParams.get('to'),format),'text/plain; charset=utf-8');return;
  }
  if(req.method!=='GET'||!publicFile){send(res,404,{error:'Not found.'});return;}
 }catch(error){
  send(res,error.status||500,{error:error.status?error.message:'The local app could not complete that request.'});
  if(!error.status)console.error(error.stack);
 }
 });
// Cap stalled/slow-client connections so they cannot pile up on a low-resource machine.
server.requestTimeout=120_000;
server.headersTimeout=60_000;
server.keepAliveTimeout=5_000;
const dailyInterval=setInterval(()=>{maintain().catch(error=>console.error('Daily worklist:',error.message));},300_000);
dailyInterval.unref();
return {
 server,
 port,
 listen:()=>new Promise((resolveListen,rejectListen)=>{
  const onError=error=>{server.off('listening',onListening);rejectListen(error);};
  const onListening=()=>{server.off('error',onError);resolveListen(server);};
  server.once('error',onError);
  server.once('listening',onListening);
  server.listen(port,'127.0.0.1',()=>console.log('Outreach Desk · http://localhost:'+server.address().port+'/'));
 }),
 close:()=>new Promise(resolveClose=>{
  const finish=()=>{clearInterval(dailyInterval);Promise.resolve(store.close()).then(()=>resolveClose(),()=>resolveClose());};
  if(server.listening)server.close(finish);else finish();
 })
};
}

const isMain=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isMain){
 const app=await createApp();
 app.server.on('error',error=>{
  if(error.code==='EADDRINUSE')console.error('Outreach Desk could not start: port '+app.port+' is already in use. Close the other instance or set PORT to another port.');
  else if(error.code==='EACCES')console.error('Outreach Desk could not bind port '+app.port+': permission denied.');
  else console.error('Server error:',error.message);
  process.exitCode=1;
 });
 process.on('unhandledRejection',reason=>console.error('Unhandled rejection:',reason&&reason.stack||reason));
 // Keep the local app alive if an error escapes a request; log it and let the process continue.
 process.on('uncaughtException',error=>console.error('Uncaught exception:',error&&error.stack||error));
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
  app.server.closeAllConnections?.();
  app.server.close(()=>process.exit(0));
  setTimeout(()=>process.exit(0),5000).unref();
 });
 await app.listen();
}

