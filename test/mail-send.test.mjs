// Coverage for outbound sending via the mail relay. A local HTTP server stands in for the
// DreamHost PHP relay, so no real SMTP/IMAP is touched. The mailbox is seeded WITHOUT a sealed
// password, so imapConfigured() is false and the IDLE watcher never starts on boot — the send
// route only needs the From address, which loadMailSettings still returns.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
import {setPassword} from '../auth.mjs';
import {sendViaRelay,sendConfigured} from '../mail-send.mjs';

const PASSWORD='correct horse battery staple';
const RELAY_KEY='test-relay-key';
let dataDir, app, port, cookie, relay, relayPort, relayMode='ok', relayReceived=null;
const saved={};

function startRelay(){
  return new Promise(resolve=>{
    relay=http.createServer((req,res)=>{
      let body='';req.on('data',c=>{body+=c;});
      req.on('end',()=>{
        relayReceived={key:req.headers['x-relay-key'],json:JSON.parse(body||'{}')};
        if(relayMode==='fail'){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:'relay down'}));}
        else if(relayMode==='badkey'){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:'Invalid relay key.'}));}
        else{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({ok:true}));}
      });
    });
    relay.listen(0,'127.0.0.1',()=>{relayPort=relay.address().port;resolve();});
  });
}

function request({method='GET',path,headers={},body}={}){
  return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,method,path,headers:{
      Host:`127.0.0.1:${port}`,
      ...(method==='POST'?{Origin:`http://127.0.0.1:${port}`,'Content-Type':'application/json'}:{}),
      ...headers,
    }},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error',reject);
    if(body!==undefined)req.end(body);else req.end();
  });
}
const json=r=>JSON.parse(r.body);
async function revision(){const r=await request({path:'/api/state',headers:{Cookie:cookie}});return json(r).state.revision;}

before(async()=>{
  for(const k of ['MAIL_RELAY_URL','MAIL_RELAY_SECRET','OUTREACH_SECRET'])saved[k]=process.env[k];
  await startRelay();
  process.env.MAIL_RELAY_URL=`http://127.0.0.1:${relayPort}/send`;
  process.env.MAIL_RELAY_SECRET=RELAY_KEY;
  delete process.env.OUTREACH_SECRET;
  dataDir=await mkdtemp(join(tmpdir(),'outreach-send-'));
  await setPassword(dataDir,PASSWORD);
  await writeFile(join(dataDir,'mail.json'),JSON.stringify({host:'8.8.8.8',port:993,user:'me@example.com',mailbox:'INBOX',tls:true}));
  app=await createApp({dataDir,port:0});
  await app.listen();
  port=app.server.address().port;
  const login=await request({method:'POST',path:'/api/auth/login',body:JSON.stringify({username:'admin',password:PASSWORD})});
  cookie=login.headers['set-cookie'][0].split(';')[0];
});

after(async()=>{
  if(app?.server.listening)await app.close();
  await new Promise(r=>relay.close(r));
  await rm(dataDir,{recursive:true,force:true});
  for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
});

test('sendConfigured reflects the relay env vars',()=>{
  assert.equal(sendConfigured(),true);
});

test('sendViaRelay POSTs the message with the shared relay key',async()=>{
  relayMode='ok';
  await sendViaRelay({from:'me@example.com',fromName:'Me',to:['a@x.com'],cc:['c@y.com'],subject:'Hi',html:'<p>Hey</p>',text:'Hey'});
  assert.equal(relayReceived.key,RELAY_KEY);
  assert.deepEqual(relayReceived.json.to,['a@x.com']);
  assert.deepEqual(relayReceived.json.cc,['c@y.com']);
  assert.equal(relayReceived.json.subject,'Hi');
});

test('sendViaRelay maps relay errors to a 502 status',async()=>{
  relayMode='fail';
  await assert.rejects(()=>sendViaRelay({from:'me@example.com',to:['a@x.com'],subject:'Hi',html:'x',text:'x'}),e=>e.status===502);
});

test('POST /api/mail/send transmits a recorded message and stamps it sent',async()=>{
  relayMode='ok';
  const rec=await request({method:'POST',path:'/api/action',headers:{Cookie:cookie},
    body:JSON.stringify({type:'thread-send',input:{workspace:'grynh2',to:['lead@acme.com'],subject:'Hello there',bodyHtml:'<p>Body copy</p>'},revision:await revision()})});
  assert.equal(rec.status,200);
  const threadId=json(rec).result.thread;
  const sent=await request({method:'POST',path:'/api/mail/send',headers:{Cookie:cookie},
    body:JSON.stringify({workspace:'grynh2',threadId})});
  assert.equal(sent.status,200);
  assert.equal(relayReceived.json.subject,'Hello there');
  assert.deepEqual(relayReceived.json.to,['lead@acme.com']);
  assert.equal(relayReceived.json.from,'me@example.com');
  const st=await request({path:'/api/state',headers:{Cookie:cookie}});
  const thread=json(st).state.workspaces.find(w=>w.id==='grynh2').threads.find(t=>t.id===threadId);
  assert.equal(thread.messages.at(-1).sendStatus,'sent');
});

test('a relay failure records the message as failed and returns 502',async()=>{
  relayMode='fail';
  const rec=await request({method:'POST',path:'/api/action',headers:{Cookie:cookie},
    body:JSON.stringify({type:'thread-send',input:{workspace:'grynh2',to:['lead@acme.com'],subject:'Will fail',bodyHtml:'<p>x</p>'},revision:await revision()})});
  const threadId=json(rec).result.thread;
  const sent=await request({method:'POST',path:'/api/mail/send',headers:{Cookie:cookie},
    body:JSON.stringify({workspace:'grynh2',threadId})});
  assert.equal(sent.status,502);
  const st=await request({path:'/api/state',headers:{Cookie:cookie}});
  const thread=json(st).state.workspaces.find(w=>w.id==='grynh2').threads.find(t=>t.id===threadId);
  assert.equal(thread.messages.at(-1).sendStatus,'failed');
});

test('POST /api/mail/send requires a session',async()=>{
  const r=await request({method:'POST',path:'/api/mail/send',body:'{}'});
  assert.equal(r.status,401);
});
