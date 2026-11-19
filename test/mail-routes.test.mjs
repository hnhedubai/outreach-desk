// Coverage for the /api/mail routes after the mail subsystem was extracted into
// mail-server.mjs. These exercise the request wiring and validation WITHOUT a live IMAP
// connection or a started watcher (every path below fails validation before saveMailSettings
// can restart the watcher, and the app boots unconfigured so startWatcher returns early).
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
import {setPassword} from '../auth.mjs';

const PASSWORD='correct horse battery staple';
let dataDir, app, port, cookie, savedSecret;

function request({method='GET',path,headers={},body}={}){
  return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,method,path,headers:{
      Host:`127.0.0.1:${port}`,
      ...(method==='POST'?{Origin:`http://127.0.0.1:${port}`,'Content-Type':'application/json'}:{}),
      ...headers,
    }},res=>{
      const chunks=[];
      res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error',reject);
    if(body!==undefined)req.end(body);else req.end();
  });
}
const json=r=>JSON.parse(r.body);

before(async()=>{
  savedSecret=process.env.OUTREACH_SECRET;
  delete process.env.OUTREACH_SECRET; // force secretAvailable:false so a password save is refused
  dataDir=await mkdtemp(join(tmpdir(),'outreach-desk-mailroutes-'));
  await setPassword(dataDir,PASSWORD);
  app=await createApp({dataDir,port:0});
  await app.listen();
  port=app.server.address().port;
  const login=await request({method:'POST',path:'/api/auth/login',body:JSON.stringify({username:'admin',password:PASSWORD})});
  cookie=login.headers['set-cookie'][0].split(';')[0];
});

after(async()=>{
  if(app?.server.listening)await app.close();
  await rm(dataDir,{recursive:true,force:true});
  if(savedSecret===undefined)delete process.env.OUTREACH_SECRET;else process.env.OUTREACH_SECRET=savedSecret;
});

test('GET /api/mail requires a session',async()=>{
  const r=await request({path:'/api/mail'});
  assert.equal(r.status,401);
});

test('GET /api/mail returns a masked view with no password material',async()=>{
  const r=await request({path:'/api/mail',headers:{Cookie:cookie}});
  assert.equal(r.status,200);
  const m=json(r);
  assert.equal(m.configured,false,'nothing saved yet');
  assert.equal(m.secretAvailable,false,'no OUTREACH_SECRET in this environment');
  assert.equal(m.user,'');
  assert.ok(!('password' in m)&&!('sealed' in m)&&!('salt' in m),'the public view never leaks credentials');
});

test('POST /api/mail/save rejects an unknown workspace before storing anything',async()=>{
  const r=await request({method:'POST',path:'/api/mail/save',headers:{Cookie:cookie},body:JSON.stringify({workspace:'does-not-exist',host:'8.8.8.8',user:'me@example.com',password:'p'})});
  assert.equal(r.status,400);
  assert.match(json(r).error,/workspace/i);
});

test('POST /api/mail/save rejects a private IMAP host (SSRF guard)',async()=>{
  const r=await request({method:'POST',path:'/api/mail/save',headers:{Cookie:cookie},body:JSON.stringify({workspace:'grynh2',host:'127.0.0.1',user:'me@example.com',password:'p'})});
  assert.equal(r.status,400);
  assert.match(json(r).error,/public address/i);
});

test('POST /api/mail/save refuses to seal a password without OUTREACH_SECRET',async()=>{
  const r=await request({method:'POST',path:'/api/mail/save',headers:{Cookie:cookie},body:JSON.stringify({workspace:'grynh2',host:'8.8.8.8',user:'me@example.com',password:'p'})});
  assert.equal(r.status,503);
  assert.match(json(r).error,/OUTREACH_SECRET/);
});

test('POST /api/mail/test and /fetch report unconfigured without dialing',async()=>{
  const t=await request({method:'POST',path:'/api/mail/test',headers:{Cookie:cookie},body:'{}'});
  assert.equal(t.status,400);
  assert.match(json(t).error,/Save a mailbox/i);
  const f=await request({method:'POST',path:'/api/mail/fetch',headers:{Cookie:cookie},body:'{}'});
  assert.equal(f.status,400);
  assert.match(json(f).error,/Save a mailbox/i);
});
