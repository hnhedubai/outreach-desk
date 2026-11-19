import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {enforceTlsVerification,openStore} from './db.mjs';
import {createState,perform,cleanDomain,runDaily,reconcileAssignments,recordJevFit,ensureThreads} from './model.mjs';
import {currentJevFit,jevAvailable,jevInput,scoreWithJev} from './jev.mjs';
import {firecrawlAvailable,firecrawlSearch} from './firecrawl.mjs';
import {perplexityAvailable,perplexitySearch,limaAvailable,findLimaEmail,reoonAvailable,verifyReoonEmail,reoonBalance} from './research-providers.mjs';
import {verifyDomains} from './domain.mjs';
import {mailSettingsPublic,saveMailSettings,loadMailSettings,assertSafeImapHost} from './mail-settings.mjs';
 import {fetchRecentMail,imapConfigured,watchMail} from './imap.mjs';
import {authUsername,clearSessions,createSession,destroySession,ensureAuth,ensureAdminPassword,initSessions,readAuth,sessionFrom,setPassword,verifyPassword} from './auth.mjs';
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
// OUTREACH_MODE=server relaxes the loopback-only guards so the app can sit behind a
// hosting proxy. It is opt-in: with the flag unset every guard below behaves exactly
// as it does for a local single-user install.
const serverMode=()=>process.env.OUTREACH_MODE==='server';
const allowedHosts=()=>new Set(String(process.env.OUTREACH_ALLOWED_HOSTS??'').split(',').map(host=>host.trim().toLowerCase()).filter(Boolean));
// A proxy terminates TLS, so the visible request scheme is http:// but the browser's
// Origin header carries https://. Trust the forwarded proto, never the raw socket.
const requestScheme=req=>serverMode()?(String(req.headers['x-forwarded-proto']??'').split(',')[0].trim()||'https'):'http';
// Build the session Set-Cookie value. The Secure flag is added only when the request
// actually arrived over https (server mode behind a TLS-terminating proxy), so the cookie
// can never be sent in cleartext there. A local http://localhost install must NOT set
// Secure, or the browser drops the cookie and login breaks entirely.
const sessionCookie=(req,token,maxAge)=>`outreach_session=${token}; HttpOnly; SameSite=Strict;${requestScheme(req)==='https'?' Secure;':''} Path=/; Max-Age=${maxAge}`;
export async function createApp({db:providedDb,dataDir:providedDataDir,port:requestedPort}={}){
 const root=dirname(fileURLToPath(import.meta.url));
 const port=Number(requestedPort??process.env.PORT??8282);
 const dataDir=providedDataDir||process.env.OUTREACH_DATA_DIR||join(root,'data');
 if(serverMode()&&allowedHosts().size===0)throw new Error('OUTREACH_MODE=server requires OUTREACH_ALLOWED_HOSTS to list the public hostnames, comma-separated.');
 await mkdir(dataDir,{recursive:true});
 initSessions(dataDir);
 const store=await openStore({providedDb,dataDir});
 const auth=await ensureAuth(dataDir);
 await ensureAdminPassword(dataDir,process.env.OUTREACH_ADMIN_PASSWORD);
await store.seed(JSON.stringify(createState()));
const read=async()=>{
 const row=await store.getState();
 if(!row)throw requestError(500,'Saved workspace data is unreadable. Restore it from a backup.');
 try{const state={...JSON.parse(row.document),revision:row.revision};for(const w of state.workspaces||[])ensureThreads(w);return state;}
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
 const verified=await verifyPendingDomains(state,30);
 if(!reconciled&&!generated&&!verified)return state;
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
   res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow',
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
const paths=new Map([['/','index.html'],['/index.html','index.html'],['/robots.txt','robots.txt'],['/app.js','app.js'],['/compat.js','compat.js'],['/css/style.css','css/style.css'],['/spreadsheet.js','spreadsheet.js'],['/ui.js','ui.js'],['/eligibility.js','eligibility.js'],['/project.js','project.js'],['/workspace.js','workspace.js'],['/sanitize.js','sanitize.js'],['/flow.js','flow.js'],['/favicon.ico','favicon.ico'],['/apple-icon.png','apple-icon.png'],['/icon-192.png','icon-192.png'],['/icon-384.png','icon-384.png'],['/fonts/Inter.ttf','fonts/Inter.ttf'],['/fonts/SpaceGrotesk.ttf','fonts/SpaceGrotesk.ttf']]);
const mime={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',txt:'text/plain; charset=utf-8',ttf:'font/ttf',ico:'image/x-icon',png:'image/png'};
const keyAvailable=()=>Boolean(process.env.EXA_API_KEY);
const scoring=new Set();
const requestError=(status,message)=>Object.assign(new Error(message),{status});
function stateResponse(state,result){
 for(const workspace of state.workspaces)for(const project of workspace.projects)for(const lead of project.leads){
  if(lead.jevFit)lead.jevFit.stale=!currentJevFit(project,lead);
 }
  return {state,result,webSearch:keyAvailable(),jevAvailable:jevAvailable(),firecrawlAvailable:firecrawlAvailable(),
   perplexityAvailable:perplexityAvailable(),limaAvailable:limaAvailable(),reoonAvailable:reoonAvailable()};
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
 if(req.headers.origin!==requestScheme(req)+'://'+req.headers.host)throw Object.assign(new Error('Cross-origin requests are unavailable.'),{status:403});
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
// Verify a lead's contact emails with Reoon POWER. input.contact → one contact; omit it to
// verify every contact that has an email on the lead. Runs the HTTP here (Neon SQL cannot),
// gates credits up front, persists the raw status under CAS, then records an audit row each.
async function verifyContactEmails(input){
  if(!reoonAvailable())throw requestError(503,'Set REOON_API_KEY to enable Reoon verification.');
  if(typeof input.workspace!=='string'||typeof input.project!=='string'||typeof input.lead!=='string')throw requestError(400,'Specify workspace, project and lead.');
  const state=await load();
  if(input.revision!==undefined&&input.revision!==state.revision)throw requestError(409,'The workspace changed. Refresh and try again.');
  const ws=state.workspaces.find(x=>x.id===input.workspace);
  const project=ws?.projects.find(x=>x.id===input.project);
  const lead=project?.leads.find(x=>x.id===input.lead&&!x.erasedAt);
  if(!lead)throw requestError(404,'Lead unavailable.');
  const targets=(input.contact?lead.contacts.filter(c=>c.id===input.contact):lead.contacts).filter(c=>c.email);
  if(!targets.length)throw requestError(400,'No contact with an email to verify on this lead.');
  if(targets.length>25)throw requestError(400,'Verify at most 25 emails at a time.');
  const balance=await reoonBalance();
  if(balance.total<targets.length)throw requestError(402,`Reoon needs at least ${targets.length} credits; ${balance.total} remain.`);
  // Reoon allows ≤5 concurrent single verifies; keep a small pool so a batch fits the request timeout.
  const results=[];const queue=[...targets];
  await Promise.all(Array.from({length:Math.min(3,queue.length)},async()=>{
    while(queue.length){
      const c=queue.shift();
      try{const r=await verifyReoonEmail(c.email);results.push({contact:c.id,email:c.email,status:r.status,score:r.score,safeToSend:r.safeToSend,outcome:r.outcome});}
      catch(error){results.push({contact:c.id,email:c.email,status:'unknown',score:null,safeToSend:false,outcome:'error',error:error.message});}
    }
  }));
  const persisted=results.filter(r=>r.outcome!=='error').map(r=>({contact:r.contact,status:r.status}));
  if(persisted.length)perform(state,'record-verification',{workspace:input.workspace,project:input.project,lead:input.lead,results:persisted});
  const previous=state.revision;state.revision++;
  if(!(await store.save(state.revision,encodeState(state),previous)))throw requestError(409,'The workspace changed. Refresh and try again.');
  for(const r of results){
    try{await store.recordVerification({workspace:input.workspace,project:input.project,lead:input.lead,contact:r.contact,email:r.email,status:r.status,score:r.score,safeToSend:r.safeToSend,source:'Reoon'});}
    catch(error){console.error('Verification audit:',error.message);}
  }
  return stateResponse(state,{verified:persisted.length,attempted:results.length,results});
}
// Verify domains of leads whose MX status is not yet resolved (newly landed, or a
// prior error). Mutates state in place; returns true if any lead changed. Bounded so
// bulk imports stay fast — stragglers finish on the next maintain()/action.
async function verifyPendingDomains(state,limit=120){
  const pending=[];
  for(const ws of state.workspaces||[])for(const p of ws.projects||[])for(const l of p.leads||[]){
    if(l.domain&&(!l.domainVerified||l.domainVerified==='pending'||l.domainVerified==='error'))pending.push(l);
  }
  if(!pending.length)return false;
  const batch=pending.slice(0,limit);
  const results=await verifyDomains(batch.map(l=>l.domain));
  const at=new Date().toISOString();
  for(const l of batch){const r=results.get(l.domain);if(r){l.domainVerified=r.status;l.domainCheckedAt=at;}}
  return true;
}
const hash=value=>createHash('sha256').update(String(value)).digest('hex');
function exportAudit(ws,project,from,to,format){
 const rows=ws.audit.filter(e=>(!project||e.project===project)&&(!from||e.at.slice(0,10)>=from)&&(!to||e.at.slice(0,10)<=to)).map(e=>({
  time:e.at,project:e.project,action:e.type,channel:e.channel||'',lead:e.leadId?hash(e.leadId):'',contact:e.email?hash(e.email):''
 }));
  return format==='jsonl'?rows.map(x=>JSON.stringify(x)).join('\n'):['time,project,action,channel,lead,contact',...rows.map(r=>Object.values(r).map(csv).join(','))].join('\n');
 }
 // ---- Real-time mail: shared ingest + IDLE watcher + live browser stream ----
 // DreamHost has no webhook; the IMAP push primitive is IDLE — one persistent
 // authenticated connection that fires only when a message lands (no polling, no
 // manual fetch). watchMail already auto-reconnects on drop, so we never add our own.
 // The browser keeps one EventSource open on the Thread view; when the watcher (or a
 // manual fetch) ingests mail we push an event so the open tab updates without reload.
 // send() always ends the response, so the SSE route below writes raw and bypasses it.
 const sseClients=new Set();
 function broadcastMailUpdate(payload){
  const data='event: mail\ndata: '+JSON.stringify(payload)+'\n\n';
  for(const client of sseClients){try{client.write(data);}catch{sseClients.delete(client);}}
 }
 // Ingest normalized IMAP messages into the workspace. Shared by /api/mail/fetch and the
 // IDLE watcher so both use the SAME deduped compare-and-swap write path. The reducer
  // dedups by Message-ID (falling back to uid), so a retry after a lost CAS never
  // double-adds. The watcher passes the mailbox's bound workspace (settings.workspace);
  // when none is set, ingestMail falls back to the FIRST workspace, never state.active —
  // that value is mutated by unrelated browser actions and must not steer live intake.
  // The bounded retry loop coexists with the 5-minute maintain() interval, which bumps
  // the revision under the same CAS.
 async function ingestMail(messages,{workspace}={}){
  const settings=await loadMailSettings(dataDir);
  if(!settings||!imapConfigured(settings))return {added:0,updated:0,skipped:'no-settings'};
  const list=Array.isArray(messages)?messages.filter(Boolean):[];
  if(!list.length)return {added:0,updated:0,skipped:'all-dupes'};
   for(let attempt=0;attempt<4;attempt++){
    // read() (not load()/maintain()): ingest only needs the current state for the CAS.
    // maintain() runs runDaily + verifyPendingDomains, and the IDLE watcher calls this on
    // every inbound email — doing full maintenance per message is needless latency and
    // network cost. The manual /api/mail/fetch path still runs maintain() once (its own
    // revision precheck), so scheduled maintenance is unaffected.
    const state=await read();
    // Resolve the target workspace deterministically: an explicit id (the mailbox's bound
    // workspace, or the browser's for a manual fetch), else the first workspace — never
    // state.active. The reducer honours a concrete id, so live intake lands predictably.
    const target=(workspace&&state.workspaces.some(w=>w.id===workspace))?workspace:state.workspaces[0]?.id;
    const result=perform(state,'thread-ingest',{workspace:target,messages:list});
   if(!result.added&&!result.updated)return {added:0,updated:0,skipped:'all-dupes',revision:state.revision};
   const previous=state.revision;state.revision++;
   if(await store.save(state.revision,encodeState(state),previous)){
    broadcastMailUpdate({added:result.added,updated:result.updated,revision:state.revision});
    return {added:result.added,updated:result.updated,revision:state.revision};
   }
  }
  throw requestError(409,'The workspace changed. Please try again.');
 }
  // One persistent IDLE connection per server process. Guarded against a double start;
  // never started during createApp (only on listen) so tests that build the app without
  // listening never open a socket, and imapflow/mailparser stay lazy. The `starting`
  // flag reserves the slot synchronously across the awaits below, so two concurrent
  // /api/mail/save calls (or a save racing listen() startup) cannot leak a second watcher.
  let mailWatcher=null, mailWatcherStarting=false;
  async function startMailWatcher(){
   if(mailWatcher||mailWatcherStarting)return;
   mailWatcherStarting=true;
   try{
    const settings=await loadMailSettings(dataDir);
    if(!settings||!imapConfigured(settings)){console.log('Mail watcher: not configured, skipping.');return;}
    try{await assertSafeImapHost(settings.host);}
    catch(error){console.error('Mail watcher: refusing unsafe host -',error.message);return;}
    mailWatcher=watchMail({
     ...settings,
     // onNew receives the whole `exists` batch and must be awaitable: ingestMail resolves
     // once the messages are committed and rejects on a CAS conflict, which tells the
     // watcher to keep its UID mark and retry instead of dropping the mail. The mailbox is
     // bound to settings.workspace so live intake never lands in the browser-driven active
     // workspace.
     onNew:(messages)=>ingestMail(messages,{workspace:settings.workspace}),
     onError:(error)=>console.error('Mail watcher error:',error.response||error.message||error),
    });
    console.log('Mail watcher: IDLE connected for',settings.user);
   }finally{mailWatcherStarting=false;}
  }
 async function stopMailWatcher(){
  if(!mailWatcher)return;
  const watcher=mailWatcher;mailWatcher=null;
  try{await watcher.stop();}catch{/* ignore teardown errors */}
 }
 const server=createServer(async(req,res)=>{
 try{
   const boundPort=server.address()?.port;
   const hostHeader=String(req.headers.host??'').toLowerCase();
   const hostAllowed=serverMode()?allowedHosts().has(hostHeader):['127.0.0.1:'+boundPort,'localhost:'+boundPort].includes(hostHeader);
   if(!hostAllowed){send(res,403,{error:serverMode()?'Unknown app address.':'Use the local app address.'});return;}
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
   // Client-side routes are real paths now (no '#'), so any other GET returns the app shell
   // and the browser router resolves it on load. Extension-less segments are treated as
   // routes (route ids never contain a dot); a dotted last segment is a missing file → 404.
   // Only /api/* responses are gated by session.
   if(req.method==='GET'&&!u.pathname.startsWith('/api/')){
    const last=u.pathname.split('/').pop()||'';
    if(!last.includes('.')){send(res,200,await readFile(join(root,'public','index.html')),mime.html);return;}
   }
  if(u.pathname==='/api/auth/login'){
   requirePost(req);
   const input=await body(req,50_000);
   if(input.username!==authUsername||!(await verifyPassword(dataDir,input.password)))throw requestError(401,'Incorrect username or password.');
    const token=createSession();
    res.setHeader('Set-Cookie',sessionCookie(req,token,31536000));
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
    res.setHeader('Set-Cookie',sessionCookie(req,'',0));
   send(res,200,{ok:true});return;
  }
  if(u.pathname==='/api/auth/change-password'){
   requirePost(req);
   const input=await body(req,50_000);
   if(!(await verifyPassword(dataDir,input.currentPassword)))throw requestError(401,'Current password is incorrect.');
    await setPassword(dataDir,input.newPassword);clearSessions();
    const token=createSession();
    res.setHeader('Set-Cookie',sessionCookie(req,token,31536000));
   send(res,200,{ok:true});return;
  }
  if(u.pathname==='/api/state'&&req.method==='GET'){send(res,200,stateResponse(await load()));return;}
  // Mailbox (IMAP) settings for Thread. The password is stored encrypted in the data dir
  // and never returned to the browser — only a masked view comes back here.
  if(u.pathname==='/api/mail'&&req.method==='GET'){send(res,200,await mailSettingsPublic(dataDir));return;}
  if(u.pathname==='/api/mail/save'){
    requirePost(req);
    const input=await body(req,50_000);
    // Bind the mailbox to a concrete workspace so the IDLE watcher ingests there instead
    // of the browser-driven active workspace. Default to the first workspace and reject an
    // unknown id, so live intake can never be stranded on a stale or hand-typed value.
    const state=await read();
    const workspace=String(input.workspace||state.workspaces[0]?.id||'');
    if(!state.workspaces.some(w=>w.id===workspace))throw requestError(400,'Unknown workspace for the mailbox.');
     await saveMailSettings(dataDir,{...input,workspace});
     await stopMailWatcher();await startMailWatcher(); // apply the new mailbox without a process restart
     send(res,200,{ok:true,settings:await mailSettingsPublic(dataDir)});return;
  }
  if(u.pathname==='/api/mail/test'){
    requirePost(req);await body(req,10_000);
    const settings=await loadMailSettings(dataDir);
    if(!settings||!imapConfigured(settings))throw requestError(400,'Save a mailbox address and password first.');
    await assertSafeImapHost(settings.host); // re-validate before dialing (mail.json could be hand-edited)
    try{
      const out=await fetchRecentMail({...settings,limit:5});
      send(res,200,{ok:true,fetched:out.length,latest:out[0]?{subject:out[0].subject,date:out[0].date}:null});
    }catch(error){
      // Log the real upstream detail server-side only; never reflect it to the browser
      // (it could turn the connect into an internal-service oracle).
      console.error('IMAP test connection failed:',error.response||error.message||error);
      throw requestError(502,'Could not connect to the mailbox. Check the host, port and credentials, then try again.');
    }
    return;
  }
  if(u.pathname==='/api/mail/fetch'){
    requirePost(req);
    const input=await body(req,10_000);
    const settings=await loadMailSettings(dataDir);
    if(!settings||!imapConfigured(settings))throw requestError(400,'Save a mailbox address and password first.');
    await assertSafeImapHost(settings.host); // re-validate before dialing (mail.json could be hand-edited)
    // Check the client's revision BEFORE the (slow) IMAP fetch so a stale request is
    // rejected without spending a network round-trip. ingestMail re-loads and CAS-saves,
    // so a concurrent write (including the IDLE watcher) is still handled safely.
    const state=await load();
    if(input.revision!==undefined&&input.revision!==state.revision)throw requestError(409,'The workspace changed. Refresh and try again.');
    let messages;
    try{messages=await fetchRecentMail({...settings,limit:Math.min(50,Number(input.limit)||20)});}
    catch(error){
      console.error('IMAP fetch failed:',error.response||error.message||error);
      throw requestError(502,'Could not fetch mail. Check the mailbox settings and try again.');
    }
    const result=await ingestMail(messages,{workspace:input.workspace});
    send(res,200,stateResponse(await read(),result));return;
  }
  if(u.pathname==='/api/mail/stream'&&req.method==='GET'){
    // Live inbox updates for the Thread view. send() always ends the response, so this
    // route writes the SSE headers/body directly and keeps the socket open. It sits after
    // the session gate (sessionFrom → 401), so it is never exposed unauthenticated.
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform',Connection:'keep-alive','X-Accel-Buffering':'no'});
    res.write('retry: 3000\n\n');
    res.write('data: '+JSON.stringify({hello:true})+'\n\n');
    sseClients.add(res);
    const ping=setInterval(()=>{try{res.write(': ping\n\n');}catch{/* removed on close below */}},25_000);
    ping.unref?.();
    req.on('close',()=>{clearInterval(ping);sseClients.delete(res);});
    return;
  }
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
    await verifyPendingDomains(state);
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
  if(u.pathname==='/api/verify-emails'){
    requirePost(req);
    const input=await body(req);
    send(res,200,await verifyContactEmails(input));return;
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
   server.listen(port,serverMode()?'0.0.0.0':'127.0.0.1',()=>{
    const where=serverMode()?'listening on 0.0.0.0:'+server.address().port+' (server mode)':'http://localhost:'+server.address().port+'/';
    const storeLabel=store.backend==='postgres'?'Neon Postgres (DATABASE_URL)':'local SQLite '+join(dataDir,'outreach.sqlite');
     console.log('Vitalise · '+where+' · store: '+storeLabel);
     startMailWatcher().catch(error=>console.error('Mail watcher start failed:',error.message||error));
    });
 }),
 close:()=>new Promise(resolveClose=>{
   const finish=async()=>{clearInterval(dailyInterval);await stopMailWatcher();Promise.resolve(store.close()).then(()=>resolveClose(),()=>resolveClose());};
  if(server.listening)server.close(finish);else finish();
 })
};
}

const isMain=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isMain){
 if(enforceTlsVerification())console.log('Note: NODE_TLS_REJECT_UNAUTHORIZED=0 was inherited from the environment; TLS certificate verification is enforced regardless.');
 const app=await createApp();
 app.server.on('error',error=>{
  if(error.code==='EADDRINUSE')console.error('Vitalise could not start: port '+app.port+' is already in use. Close the other instance or set PORT to another port.');
  else if(error.code==='EACCES')console.error('Vitalise could not bind port '+app.port+': permission denied.');
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

