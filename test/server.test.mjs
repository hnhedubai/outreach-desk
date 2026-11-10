import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {classifyStreamError,createApp} from '../server.mjs';

let dataDir;
let app;
let port;

function request({method='GET',path,headers={},body}={}){
 return new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port,method,path,headers:{Host:`127.0.0.1:${port}`,...headers}},res=>{
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
 assert.equal(typeof json(response).configured,'boolean');
});

test('GET /api/state requires a session cookie',async()=>{
 const response=await request({path:'/api/state'});
 assert.equal(response.status,401);
});

test('POST with a foreign Origin is rejected by the CSRF guard',async()=>{
 const response=await request({method:'POST',path:'/api/auth/login',headers:{Origin:'http://evil.example','Content-Type':'application/json'},body:'{}'});
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
