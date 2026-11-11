// Locks the Neon/Postgres resilience helpers: transient-fault detection, retry-on-transient
// only, and outage classification to a retryable 503. Pure — no live database required.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyDbError, isTransientDbError, withRetry} from '../db.mjs';

const err=(message,code)=>Object.assign(new Error(message),code?{code}:{});

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
