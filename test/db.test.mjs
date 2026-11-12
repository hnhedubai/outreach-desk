// Locks the Neon/Postgres resilience helpers: transient-fault detection, retry-on-transient
// only, and outage classification to a retryable 503. Also locks TLS enforcement and the
// SQLite-fallback guard. Pure — no live database required.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {classifyDbError, enforceTlsVerification, isTransientDbError, openStore, withRetry} from '../db.mjs';

const err=(message,code)=>Object.assign(new Error(message),code?{code}:{});

// Applies env for the duration of run, then restores it exactly (including deletion).
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

test('isTransientDbError recognises connection-layer faults',()=>{
  for(const e of [err('timeout exceeded when trying to connect'),err('boom','ETIMEDOUT'),err('boom','ECONNRESET'),
    err('boom','57P01'),err('boom','08006'),err('the server closed the connection unexpectedly'),
    err('the database system is starting up')]){
    assert.equal(isTransientDbError(e),true,String(e.message||e.code));
  }
});

test('isTransientDbError leaves genuine query errors alone',()=>{
  for(const e of [err('duplicate key value violates unique constraint','23505'),err('syntax error at or near "SELEK"','42601'),
    err('column "nope" does not exist','42703'),undefined,null,new Error('plain bug')]){
    assert.equal(isTransientDbError(e),false);
  }
});

test('classifyDbError turns a transient fault into a retryable 503, keeps the cause',()=>{
  const raw=err('timeout exceeded when trying to connect');
  const out=classifyDbError(raw);
  assert.equal(out.status,503);
  assert.equal(out.retryable,true);
  assert.equal(out.cause,raw);
  assert.match(out.message,/retry in a moment/i);
});

test('classifyDbError passes a genuine error through unchanged (statusless, so it logs)',()=>{
  const raw=err('duplicate key','23505');
  assert.equal(classifyDbError(raw),raw);
  assert.equal(raw.status,undefined);
});

test('withRetry succeeds after a transient fault clears',async()=>{
  let calls=0;
  const result=await withRetry(async()=>{calls++;if(calls<3)throw err('boom','ETIMEDOUT');return 'ok';},{retries:3,delay:1});
  assert.equal(result,'ok');
  assert.equal(calls,3);
});

test('withRetry does not retry a non-transient error',async()=>{
  let calls=0;
  await assert.rejects(withRetry(async()=>{calls++;throw err('bad sql','42601');},{retries:5,delay:1}),/bad sql/);
  assert.equal(calls,1);
});

test('withRetry gives up after exhausting transient retries',async()=>{
  let calls=0;
  await assert.rejects(withRetry(async()=>{calls++;throw err('boom','ECONNRESET');},{retries:2,delay:1}),/boom/);
  assert.equal(calls,3);
});

test('enforceTlsVerification discards an inherited NODE_TLS_REJECT_UNAUTHORIZED=0',async()=>{
  await withEnv({NODE_TLS_REJECT_UNAUTHORIZED:'0'},()=>{
    assert.equal(enforceTlsVerification(),true,'the caller must be able to report the override was dropped');
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED,undefined,'the override must not survive into the process');
  });
});

test('enforceTlsVerification leaves the environment alone when verification is already on',()=>{
  const saved=process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try{
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    assert.equal(enforceTlsVerification(),false);
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED,undefined);
    // Only the literal 0 is an override; anything else is the operator's own business.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED='1';
    assert.equal(enforceTlsVerification(),false);
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED,'1');
  }finally{
    if(saved===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED=saved;
  }
});

test('openStore refuses the SQLite fallback when Neon is required',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'outreach-desk-guard-'));
  try{
    await withEnv({DATABASE_URL:'',OUTREACH_REQUIRE_NEON:'1'},async()=>{
      await assert.rejects(()=>openStore({dataDir:dir}),/OUTREACH_REQUIRE_NEON/);
    });
  }finally{
    await rm(dir,{recursive:true,force:true});
  }
});

test('openStore still uses SQLite when the requirement is not set',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'outreach-desk-fallback-'));
  try{
    await withEnv({DATABASE_URL:'',OUTREACH_REQUIRE_NEON:''},async()=>{
      const store=await openStore({dataDir:dir});
      assert.equal(store.backend,'sqlite');
      await store.close();
    });
  }finally{
    await rm(dir,{recursive:true,force:true});
  }
});

test('the Neon requirement does not block an explicitly provided database handle',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'outreach-desk-provided-'));
  const db=new DatabaseSync(join(dir,'outreach.sqlite'));
  try{
    await withEnv({DATABASE_URL:'',OUTREACH_REQUIRE_NEON:'1'},async()=>{
      const store=await openStore({providedDb:db,dataDir:dir});
      assert.equal(store.backend,'sqlite','an injected handle is a deliberate choice, not a silent fallback');
      await store.close();
    });
  }finally{
    db.close();
    await rm(dir,{recursive:true,force:true});
  }
});
