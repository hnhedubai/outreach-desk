import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
import {setPassword} from '../auth.mjs';

const PUBLIC_HOST='desk.example.com';
const PASSWORD='correct horse battery staple';

function request({port,method='GET',path='/',host,origin,proto,body}={}){
  return new Promise((resolve,reject)=>{
    const headers={Host:host};
    if(origin)headers.Origin=origin;
    if(proto)headers['X-Forwarded-Proto']=proto;
    if(body!==undefined)headers['Content-Type']='application/json';
    const req=http.request({host:'127.0.0.1',port,method,path,headers},res=>{
      const chunks=[];
      res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error',reject);
    if(body!==undefined)req.end(JSON.stringify(body));else req.end();
  });
}

// Runs body with the given env applied, restoring it afterwards. The guards read
// OUTREACH_MODE at call time, so tests only need to set it before createApp().
async function withEnv(values,run){
  const previous={};
  for(const key of Object.keys(values))previous[key]=process.env[key];
  Object.assign(process.env,values);
  try{return await run();}
  finally{
    for(const [key,value] of Object.entries(previous)){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
}

async function serverModeApp(extraEnv={}){
  const dataDir=await mkdtemp(join(tmpdir(),'outreach-desk-mode-'));
  await setPassword(dataDir,PASSWORD);
  const app=await createApp({dataDir,port:0});
  await app.listen();
  return {app,dataDir,port:app.server.address().port};
}

async function withServerMode(run,extraEnv={}){
  return withEnv({OUTREACH_MODE:'server',OUTREACH_ALLOWED_HOSTS:PUBLIC_HOST,...extraEnv},async()=>{
    const {app,dataDir,port}=await serverModeApp();
    try{return await run({port,app});}
    finally{await app.close();await rm(dataDir,{recursive:true,force:true});}
  });
}

test('server mode refuses to start without an allowed-host list',async()=>{
  await withEnv({OUTREACH_MODE:'server',OUTREACH_ALLOWED_HOSTS:''},async()=>{
    const dataDir=await mkdtemp(join(tmpdir(),'outreach-desk-mode-'));
    try{
      await assert.rejects(()=>createApp({dataDir,port:0}),/OUTREACH_ALLOWED_HOSTS/);
    }finally{await rm(dataDir,{recursive:true,force:true});}
  });
});

test('server mode binds every interface so a proxy can reach it',async()=>{
  await withServerMode(async({app})=>{
    assert.equal(app.server.address().address,'0.0.0.0');
  });
});

test('server mode serves the configured public host',async()=>{
  await withServerMode(async({port})=>{
    const response=await request({port,host:PUBLIC_HOST});
    assert.equal(response.status,200);
    assert.match(response.body,/Outreach Desk/);
  });
});

test('server mode rejects a Host that is not in the allow list',async()=>{
  await withServerMode(async({port})=>{
    for(const host of ['evil.example.com','localhost:8282','127.0.0.1:8282']){
      const response=await request({port,host});
      assert.equal(response.status,403,`expected 403 for Host ${host}`);
    }
  });
});

test('server mode accepts an https Origin behind a TLS-terminating proxy',async()=>{
  await withServerMode(async({port})=>{
    const response=await request({
      port,method:'POST',path:'/api/auth/login',host:PUBLIC_HOST,
      origin:`https://${PUBLIC_HOST}`,proto:'https',
      body:{username:'admin',password:PASSWORD},
    });
    assert.equal(response.status,200);
  });
});

test('server mode still rejects a mismatched Origin',async()=>{
  await withServerMode(async({port})=>{
    const response=await request({
      port,method:'POST',path:'/api/auth/login',host:PUBLIC_HOST,
      origin:`http://${PUBLIC_HOST}`,proto:'https',
      body:{username:'admin',password:PASSWORD},
    });
    assert.equal(response.status,403);
  });
});

test('server mode accepts a comma-separated host list, ignoring case and spacing',async()=>{
  await withServerMode(async({port})=>{
    const response=await request({port,host:'desk-2.example.com'});
    assert.equal(response.status,200);
  },{OUTREACH_ALLOWED_HOSTS:`${PUBLIC_HOST}, Desk-2.Example.com `});
});

test('local mode still blocks a public Host when the flag is unset',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'outreach-desk-local-'));
  await setPassword(dataDir,PASSWORD);
  const app=await createApp({dataDir,port:0});
  await app.listen();
  try{
    assert.equal(app.server.address().address,'127.0.0.1');
    const response=await request({port:app.server.address().port,host:PUBLIC_HOST});
    assert.equal(response.status,403);
    assert.match(response.body,/local app address/);
  }finally{
    await app.close();
    await rm(dataDir,{recursive:true,force:true});
  }
});
