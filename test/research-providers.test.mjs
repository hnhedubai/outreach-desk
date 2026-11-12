import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyLimaResult,findLimaEmail,perplexitySearch,classifyReoonResult} from '../research-providers.mjs';
import {firecrawlSearch} from '../firecrawl.mjs';

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

test('classifyReoonResult maps safe to valid and keeps the raw status',()=>{
  assert.deepEqual(classifyReoonResult({status:'safe',overall_score:98,is_safe_to_send:true}),
    {outcome:'valid',status:'safe',score:98,safeToSend:true,message:'Reoon: safe'});
});

test('classifyReoonResult flags catch-all as send-with-caution',()=>{
  const r=classifyReoonResult({status:'catch_all',overall_score:70,is_safe_to_send:false});
  assert.equal(r.outcome,'catchall');assert.equal(r.status,'catch_all');assert.equal(r.safeToSend,false);
});

test('classifyReoonResult collapses the invalid family to invalid',()=>{
  for(const status of ['invalid','disabled','spamtrap','disposable','inbox_full','role_account']){
    assert.equal(classifyReoonResult({status,is_safe_to_send:false}).outcome,'invalid',status);
  }
});

test('classifyReoonResult treats unknown as unknown',()=>{
  assert.equal(classifyReoonResult({status:'unknown'}).outcome,'unknown');
});

test('classifyReoonResult tolerates null booleans and extra fields',()=>{
  const r=classifyReoonResult({status:'safe',is_disposable:null,is_forwarded:false,overall_score:98,is_safe_to_send:true,verification_mode:'power'});
  assert.equal(r.outcome,'valid');assert.equal(r.score,98);
});

test('classifyReoonResult rejects a response without a status',()=>{
  assert.throws(()=>classifyReoonResult({email:'a@b.com'}),/invalid verification response/);
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

test('findLimaEmail reports a missing API key before making a request',async()=>{
 const previousKey=process.env.LIMADATA_API_KEY;
 const previousFetch=globalThis.fetch;
 delete process.env.LIMADATA_API_KEY;
 globalThis.fetch=async()=>{throw Error('fetch must not run');};
 try{await assert.rejects(()=>findLimaEmail('A Person','example.com'),error=>error.status===503&&/LIMADATA_API_KEY/.test(error.message));}
 finally{if(previousKey===undefined)delete process.env.LIMADATA_API_KEY;else process.env.LIMADATA_API_KEY=previousKey;globalThis.fetch=previousFetch;}
});

test('findLimaEmail maps provider rate limits without swallowing them',async()=>{
 const previousKey=process.env.LIMADATA_API_KEY;
 const previousFetch=globalThis.fetch;
 process.env.LIMADATA_API_KEY='test-key';
 globalThis.fetch=async(url)=>String(url).endsWith('/credits/balance')
  ?{status:200,ok:true,json:async()=>({balance:4})}
  :{status:429,ok:false,json:async()=>({})};
 try{await assert.rejects(()=>findLimaEmail('A Person','example.com'),error=>error.status===429&&/rate limit/.test(error.message));}
 finally{if(previousKey===undefined)delete process.env.LIMADATA_API_KEY;else process.env.LIMADATA_API_KEY=previousKey;globalThis.fetch=previousFetch;}
});

test('firecrawl reports missing keys and preserves its 105-credit reserve',async()=>{
 const previousKey=process.env.FIRECRAWL_API_KEY;
 const previousFetch=globalThis.fetch;
 delete process.env.FIRECRAWL_API_KEY;
 try{await assert.rejects(()=>firecrawlSearch('renewable projects'),error=>error.status===503&&/FIRECRAWL_API_KEY/.test(error.message));}
 finally{if(previousKey===undefined)delete process.env.FIRECRAWL_API_KEY;else process.env.FIRECRAWL_API_KEY=previousKey;}
 process.env.FIRECRAWL_API_KEY='test-key';
 let calls=0;
 globalThis.fetch=async()=>{calls++;return {status:200,ok:true,json:async()=>({success:true,data:{remainingCredits:106}})};};
 try{await assert.rejects(()=>firecrawlSearch('renewable projects'),error=>error.status===402&&/105-credit reserve/.test(error.message));assert.equal(calls,1);}
 finally{if(previousKey===undefined)delete process.env.FIRECRAWL_API_KEY;else process.env.FIRECRAWL_API_KEY=previousKey;globalThis.fetch=previousFetch;}
});

test('perplexity reports a missing key and upstream rate limit clearly',async()=>{
 const previousKey=process.env.PERPLEXITY_API_KEY;
 const previousFetch=globalThis.fetch;
 delete process.env.PERPLEXITY_API_KEY;
 try{await assert.rejects(()=>perplexitySearch('renewable projects'),error=>error.status===503&&/PERPLEXITY_API_KEY/.test(error.message));}
 finally{if(previousKey===undefined)delete process.env.PERPLEXITY_API_KEY;else process.env.PERPLEXITY_API_KEY=previousKey;}
 process.env.PERPLEXITY_API_KEY='test-key';
 globalThis.fetch=async()=>({status:429,ok:false,json:async()=>({})});
 try{await assert.rejects(()=>perplexitySearch('renewable projects'),error=>error.status===429&&/rate limit/.test(error.message));}
 finally{if(previousKey===undefined)delete process.env.PERPLEXITY_API_KEY;else process.env.PERPLEXITY_API_KEY=previousKey;globalThis.fetch=previousFetch;}
});
