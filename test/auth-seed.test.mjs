import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
import {ensureAdminPassword,ensureAuth,verifyPassword} from '../auth.mjs';

const PASSWORD='@zxcv@1234@';
const PUBLIC_HOST='desk.example.com';

async function tmp(){return mkdtemp(join(tmpdir(),'outreach-desk-seed-'));}
async function withEnv(values,run){
  const previous={};
  for(const key of Object.keys(values))previous[key]=process.env[key];
  Object.assign(process.env,values);
  try{return await run();}
  finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}

test('ensureAdminPassword seeds once and never clobbers an existing password',async()=>{
  const dir=await tmp();
  try{
    assert.equal(await ensureAdminPassword(dir,PASSWORD),true,'first call must seed');
    assert.equal((await ensureAuth(dir)).configured,true,'password must now be configured');
    assert.equal(await verifyPassword(dir,PASSWORD),true,'seeded password must verify');
    assert.equal(await ensureAdminPassword(dir,'a-different-password'),false,'second call must not overwrite');
    assert.equal(await verifyPassword(dir,PASSWORD),true,'original password still valid after a second call');
    assert.equal(await verifyPassword(dir,'a-different-password'),false,'the rejected second password must not have taken');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('ensureAdminPassword is a no-op for an empty or missing password',async()=>{
  const dir=await tmp();
  try{
    assert.equal(await ensureAdminPassword(dir,undefined),false);
    assert.equal(await ensureAdminPassword(dir,''),false);
    assert.equal((await ensureAuth(dir)).configured,false,'nothing should be written for an empty password');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('ensureAdminPassword rejects a password shorter than the minimum',async()=>{
  const dir=await tmp();
  try{
    await assert.rejects(()=>ensureAdminPassword(dir,'short'),/at least 10 characters/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

function request({port,method='GET',path='/',host,origin,proto,body}={}){
  return new Promise((resolve,reject)=>{
    const headers={Host:host};
    if(origin)headers.Origin=origin;
    if(proto)headers['X-Forwarded-Proto']=proto;
    if(body!==undefined)headers['Content-Type']='application/json';
    const req=http.request({host:'127.0.0.1',port,method,path,headers},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));
      res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString('utf8')}));
    });
    req.on('error',reject);
    if(body!==undefined)req.end(JSON.stringify(body));else req.end();
  });
}

test('a deployed app seeds its login from OUTREACH_ADMIN_PASSWORD on a fresh data dir',async()=>{
  const dir=await tmp();
  await withEnv({OUTREACH_MODE:'server',OUTREACH_ALLOWED_HOSTS:PUBLIC_HOST,OUTREACH_ADMIN_PASSWORD:PASSWORD},async()=>{
    const app=await createApp({dataDir:dir,port:0});
    await app.listen();
    try{
      const port=app.server.address().port;
      const status=await request({port,host:PUBLIC_HOST,path:'/api/auth/reset-status'});
      assert.equal(status.status,200);
      assert.equal(JSON.parse(status.body).configured,true,'fresh boot with the env password must be configured');
      const login=await request({port,method:'POST',path:'/api/auth/login',host:PUBLIC_HOST,origin:`https://${PUBLIC_HOST}`,proto:'https',body:{username:'admin',password:PASSWORD}});
      assert.equal(login.status,200,'login with the seeded password must succeed');
    }finally{await app.close();await rm(dir,{recursive:true,force:true});}
  });
});

test('without OUTREACH_ADMIN_PASSWORD a fresh data dir stays unconfigured (local dev unaffected)',async()=>{
  const dir=await tmp();
  const saved=process.env.OUTREACH_ADMIN_PASSWORD;
  delete process.env.OUTREACH_ADMIN_PASSWORD;
  await withEnv({OUTREACH_MODE:'server',OUTREACH_ALLOWED_HOSTS:PUBLIC_HOST},async()=>{
    const app=await createApp({dataDir:dir,port:0});
    await app.listen();
    try{
      const status=await request({port:app.server.address().port,host:PUBLIC_HOST,path:'/api/auth/reset-status'});
      assert.equal(JSON.parse(status.body).configured,false,'no env password means no seeding');
    }finally{await app.close();await rm(dir,{recursive:true,force:true});
      if(saved===undefined)delete process.env.OUTREACH_ADMIN_PASSWORD;else process.env.OUTREACH_ADMIN_PASSWORD=saved;}
  });
});
