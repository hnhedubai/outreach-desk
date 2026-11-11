import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {classifyStreamError,createApp,csv} from '../server.mjs';
import {ensureAuth,setPassword} from '../auth.mjs';

let dataDir;
let app;
let port;

function request({method='GET',path,headers={},body}={}){
 return new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port,method,path,headers:{Host:`127.0.0.1:${port}`,...(method==='POST'?{Origin:`http://127.0.0.1:${port}`}:{}),...headers}},res=>{
   const chunks=[];
   res.on('data',chunk=>chunks.push(chunk));
   res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('utf8')}));
  });
  req.on('error',reject);
  if(body!==undefined)req.end(body);else req.end();
 });
}

function json(response){return JSON.parse(response.body);}

before(async()=>{
 dataDir=await mkdtemp(join(tmpdir(),'outreach-desk-server-'));
 await setPassword(dataDir,'correct horse battery staple');
 app=await createApp({dataDir,port:0});
 await app.listen();
 port=app.server.address().port;
});

after(async()=>{
 if(app?.server.listening)await app.close();
 await rm(dataDir,{recursive:true,force:true});
});

test('GET /api/auth/status returns the public authentication shape',async()=>{
 const response=await request({path:'/api/auth/status'});
 assert.equal(response.status,200);
 assert.deepEqual(Object.keys(json(response)).sort(),['authenticated','configured']);
 assert.equal(typeof json(response).authenticated,'boolean');
 // before() sets a password, so this must be true. Asserting only the type is what let
 // a hardcoded false slip through: auth.configured was never written by setPassword.
 assert.equal(json(response).configured,true);
 assert.match(response.headers['content-security-policy']||'',/default-src 'self'/);
 assert.equal(response.headers['x-content-type-options'],'nosniff');
 assert.equal(response.headers['referrer-policy'],'no-referrer');
 assert.equal(response.headers['cache-control'],'no-store');
});

test('ensureAuth derives configured from the stored password rather than a missing field',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'outreach-desk-authcfg-'));
 try{
  assert.equal((await ensureAuth(dir)).configured,false,'no auth.json yet means unconfigured');
  await setPassword(dir,'correct horse battery staple');
  const saved=await ensureAuth(dir);
  assert.equal(saved.configured,true,'a stored salt+hash must report configured');
  assert.equal(saved.username,'admin');
  assert.ok(saved.salt&&saved.hash,'password material is preserved on the returned object');
 }finally{
  await rm(dir,{recursive:true,force:true});
 }
});

test('reset status reports configured and login sets a strict HttpOnly session cookie',async()=>{
 const reset=await request({path:'/api/auth/reset-status'});
 assert.deepEqual(json(reset),{configured:true});
 const response=await request({method:'POST',path:'/api/auth/login',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'correct horse battery staple'})});
 assert.equal(response.status,200);
 assert.match(response.headers['set-cookie']?.[0]||'',/^outreach_session=[^;]+; HttpOnly; SameSite=Strict; Path=\/; Max-Age=28800$/);
 return response.headers['set-cookie'][0].split(';')[0];
});

test('GET /api/state requires a session cookie',async()=>{
 const response=await request({path:'/api/state'});
 assert.equal(response.status,401);
});

test('POST with a foreign Origin is rejected by the CSRF guard',async()=>{
 const response=await request({method:'POST',path:'/api/auth/login',headers:{Origin:'http://evil.example','Content-Type':'application/json'},body:'{}'});
 assert.equal(response.status,403);
});

test('POST without an Origin is rejected by the CSRF guard',async()=>{
 const response=await request({method:'POST',path:'/api/auth/login',headers:{Origin:'', 'Content-Type':'application/json'},body:'{}'});
 assert.equal(response.status,403);
});

test('POST with a non-JSON content type is rejected',async()=>{
 const response=await request({method:'POST',path:'/api/auth/login',headers:{'Content-Type':'text/plain'},body:'{}'});
 assert.equal(response.status,405);
});

test('malformed JSON returns the body parser 400 message',async()=>{
 const response=await request({method:'POST',path:'/api/auth/login',headers:{'Content-Type':'application/json'},body:'not json'});
 assert.equal(response.status,400);
 assert.equal(json(response).error,'Expected a valid JSON object.');
});

test('an oversized JSON body returns the existing 413 message',async()=>{
 const body=JSON.stringify({padding:'x'.repeat(50_001)});
 const response=await request({method:'POST',path:'/api/auth/login',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},body});
 assert.equal(response.status,413);
 assert.equal(json(response).error,'The request is too large. Split the import into smaller batches.');
});

test('a foreign Host is rejected by the loopback guard',async()=>{
 const response=await request({path:'/api/auth/status',headers:{Host:'evil.example'}});
 assert.equal(response.status,403);
});

test('send returns well-formed JSON and remains safe after a client abort',async()=>{
 const response=await request({path:'/api/auth/status'});
 assert.equal(response.status,200);
 assert.equal(json(response).authenticated,false);

 await new Promise(resolve=>{
  const req=http.request({host:'127.0.0.1',port,path:'/api/auth/status',headers:{Host:`127.0.0.1:${port}`}});
  req.on('error',()=>resolve());
  req.end();
  req.destroy();
  setImmediate(resolve);
 });
 const afterAbort=await request({path:'/api/auth/status'});
 assert.equal(afterAbort.status,200);
});

test('an aborted request body is handled without taking down the server',async()=>{
 await new Promise(resolve=>{
  const req=http.request({host:'127.0.0.1',port,method:'POST',path:'/api/auth/login',headers:{Host:`127.0.0.1:${port}`,'Content-Type':'application/json','Content-Length':100}},()=>resolve());
  req.on('error',()=>resolve());
  req.write('{"username":"');
  req.destroy();
  setImmediate(resolve);
 });
 const afterAbort=await request({path:'/api/auth/status'});
 assert.equal(afterAbort.status,200);
});

test('classifyStreamError maps interrupted streams and leaves unrelated errors alone',()=>{
 const interrupted=[
  classifyStreamError({code:'ERR_STREAM_PREMATURE_CLOSE'},{headers:{}}),
  classifyStreamError({code:'ECONNRESET'},{headers:{}}),
  classifyStreamError(new Error('destroyed'),{destroyed:true,headers:{}}),
 ];
 for(const result of interrupted)assert.deepEqual(result,{status:400,message:'The request was interrupted. Please try again.'});
 const tooLarge=Object.assign(new Error('The request is too large.'),{status:413});
 assert.deepEqual(classifyStreamError(tooLarge,{headers:{}}),{status:413,message:'The request is too large.'});
 assert.throws(()=>classifyStreamError(new Error('unrelated'),{headers:{}}),/unrelated/);
});

test('a second listener reports EADDRINUSE without an uncaught exception',async()=>{
 const secondDir=await mkdtemp(join(tmpdir(),'outreach-desk-server-conflict-'));
 const second=await createApp({dataDir:secondDir,port});
 const exitCodeBefore=process.exitCode;
 try{
  await assert.rejects(second.listen(),error=>error?.code==='EADDRINUSE');
  assert.equal(second.server.listening,false);
  assert.equal(process.exitCode,exitCodeBefore);
 }finally{
  await second.close();
  await rm(secondDir,{recursive:true,force:true});
 }
});

test('stale action revision is rejected instead of overwriting newer state',async()=>{
 const login=await request({method:'POST',path:'/api/auth/login',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'correct horse battery staple'})});
 const cookie=login.headers['set-cookie'][0].split(';')[0];
 const current=await request({path:'/api/state',headers:{Cookie:cookie}});
 const revision=json(current).state.revision;
 const first=await request({method:'POST',path:'/api/action',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({type:'cookie',input:{workspace:'grynh2',value:'accepted'},revision})});
 assert.equal(first.status,200);
 const stale=await request({method:'POST',path:'/api/action',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({type:'cookie',input:{workspace:'grynh2',value:'necessary'},revision})});
 assert.equal(stale.status,409);
});

test('change-password enforces the minimum and rotates the session',async()=>{
 const login=await request({method:'POST',path:'/api/auth/login',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'correct horse battery staple'})});
 const oldCookie=login.headers['set-cookie'][0].split(';')[0];
 const short=await request({method:'POST',path:'/api/auth/change-password',headers:{Cookie:oldCookie,'Content-Type':'application/json'},body:JSON.stringify({currentPassword:'correct horse battery staple',newPassword:'short'})});
 assert.equal(short.status,400);
 const changed=await request({method:'POST',path:'/api/auth/change-password',headers:{Cookie:oldCookie,'Content-Type':'application/json'},body:JSON.stringify({currentPassword:'correct horse battery staple',newPassword:'new correct horse battery staple'})});
 assert.equal(changed.status,200);
 const newCookie=changed.headers['set-cookie'][0].split(';')[0];
 assert.equal((await request({path:'/api/state',headers:{Cookie:oldCookie}})).status,401);
 assert.equal((await request({path:'/api/state',headers:{Cookie:newCookie}})).status,200);
 const logout=await request({method:'POST',path:'/api/auth/logout',headers:{Cookie:newCookie,'Content-Type':'application/json'},body:'{}'});
 assert.equal(logout.status,200);
 assert.match(logout.headers['set-cookie']?.[0]||'',/^outreach_session=; HttpOnly; SameSite=Strict; Path=\/; Max-Age=0$/);
});

test('Exa without a key returns a configure error, not a fake result',async()=>{
 const previous=process.env.EXA_API_KEY;delete process.env.EXA_API_KEY;
 const login=await request({method:'POST',path:'/api/auth/login',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'new correct horse battery staple'})});
 const cookie=login.headers['set-cookie'][0].split(';')[0];
 try{
  const response=await request({method:'POST',path:'/api/search',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({workspace:'grynh2',source:'web',query:'renewable energy'})});
  assert.equal(response.status,503);assert.match(json(response).error,/EXA_API_KEY/);
 }finally{if(previous===undefined)delete process.env.EXA_API_KEY;else process.env.EXA_API_KEY=previous;}
});

test('audit CSV neutralizes spreadsheet formula prefixes',()=>{
 for(const value of ['=SUM(1,1)','+1','-1','@cmd','\tformula','\rformula']){
  assert.equal(csv(value),`"'${value.replace(/"/g,'""')}"`);
 }
 assert.equal(csv('ordinary'), '"ordinary"');
});
