import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyLimaResult,findLimaEmail} from '../research-providers.mjs';

test('classifyLimaResult distinguishes a matching work email',()=>{
  assert.deepEqual(classifyLimaResult({email:'person@matrixrenewables.com'},'matrixrenewables.com'),{
    outcome:'match',email:'person@matrixrenewables.com',message:'LimaData returned a matching work email.'
  });
});

test('classifyLimaResult preserves a provider no-result message',()=>{
  assert.deepEqual(classifyLimaResult({found:false,message:'No work email found'},'example.com'),{
    outcome:'no_result',email:'',message:'No work email found'
  });
});

test('classifyLimaResult rejects an email from another domain',()=>{
  assert.deepEqual(classifyLimaResult({email:'person@other.example'},'example.com'),{
    outcome:'invalid_result',email:'',message:'LimaData returned an email outside the company domain.'
  });
});

test('classifyLimaResult rejects malformed provider data',()=>{
  assert.throws(()=>classifyLimaResult(null,'example.com'),/invalid response/);
});

test('findLimaEmail gates the full four-credit lookup cost',async()=>{
  const previousKey=process.env.LIMADATA_API_KEY;
  const previousFetch=globalThis.fetch;
  let calls=0;
  process.env.LIMADATA_API_KEY='test-key';
  globalThis.fetch=async(url)=>{
    calls++;
    assert.match(String(url),/credits\/balance/);
    return {status:200,ok:true,json:async()=>({balance:2})};
  };
  try{
    await assert.rejects(()=>findLimaEmail('A Person','example.com'),error=>{
      assert.equal(error.status,402);
      assert.equal(error.message,'LimaData needs at least 4 credits for a lookup.');
      return true;
    });
    assert.equal(calls,1,'the email endpoint must not be called below the threshold');
  }finally{
    if(previousKey===undefined)delete process.env.LIMADATA_API_KEY;else process.env.LIMADATA_API_KEY=previousKey;
    globalThis.fetch=previousFetch;
  }
});

test('findLimaEmail allows a balance of four credits to reach the lookup endpoint',async()=>{
  const previousKey=process.env.LIMADATA_API_KEY;
  const previousFetch=globalThis.fetch;
  const urls=[];
  process.env.LIMADATA_API_KEY='test-key';
  globalThis.fetch=async(url)=>{
    urls.push(String(url));
    if(urls.length===1)return {status:200,ok:true,json:async()=>({balance:4})};
    return {status:404,ok:false,json:async()=>({})};
  };
  try{
    assert.deepEqual(await findLimaEmail('A Person','example.com'),{outcome:'no_result',email:'',message:'LimaData found no matching work email.'});
    assert.equal(urls.length,2);
    assert.match(urls[1],/find\/email_work/);
  }finally{
    if(previousKey===undefined)delete process.env.LIMADATA_API_KEY;else process.env.LIMADATA_API_KEY=previousKey;
    globalThis.fetch=previousFetch;
  }
});
