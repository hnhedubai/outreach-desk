// Behavioural locks for the encrypted mailbox store (mail-settings.mjs) and the
// Thread IMAP ingest reducer (model.mjs thread-ingest).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {saveMailSettings,loadMailSettings,mailSettingsPublic,mailSecretAvailable,assertSafeImapHost,ipIsPrivateOrReserved} from '../mail-settings.mjs';
import {createState,perform} from '../model.mjs';

const SECRET='unit-test-secret-please-ignore';
const WS='grynh2';
async function tmp(){return mkdtemp(join(tmpdir(),'outreach-mail-'));}
async function withEnv(values,run){
  const previous={};
  for(const key of Object.keys(values))previous[key]=process.env[key];
  Object.assign(process.env,values);
  try{return await run();}
  finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
}

test('a saved password is encrypted at rest and never appears in the file or the public view',async()=>{
  const dir=await tmp();
  await withEnv({OUTREACH_SECRET:SECRET},async()=>{
    try{
      await saveMailSettings(dir,{host:'8.8.8.8',port:993,user:'me@example.com',password:'sup3r-s3cret',mailbox:'INBOX'});
      const raw=await readFile(join(dir,'mail.json'),'utf8');
      assert.ok(!raw.includes('sup3r-s3cret'),'the plaintext password must not be written to disk');
      assert.ok(/"sealed"/.test(raw),'the record must carry a sealed block');
      const loaded=await loadMailSettings(dir);
      assert.equal(loaded.password,'sup3r-s3cret','the password must decrypt back to the original');
      assert.equal(loaded.user,'me@example.com');
      const pub=await mailSettingsPublic(dir);
      assert.equal(pub.configured,true);
      assert.equal(pub.user,'me@example.com');
      assert.ok(!('password' in pub),'the public view must never include a password field');
      assert.ok(!('sealed' in pub)&&!('salt' in pub),'the public view must not leak ciphertext material');
      assert.ok(JSON.stringify(pub).indexOf('sup3r-s3cret')<0,'the public view must not contain the secret');
    }finally{await rm(dir,{recursive:true,force:true});}
  });
});

test('the mailbox records the workspace it is bound to, for deterministic live intake',async()=>{
  const dir=await tmp();
  await withEnv({OUTREACH_SECRET:SECRET},async()=>{
    try{
      await saveMailSettings(dir,{host:'8.8.8.8',user:'me@example.com',password:'p',workspace:'grynh2'});
      assert.equal((await loadMailSettings(dir)).workspace,'grynh2','loadMailSettings surfaces the bound workspace');
      assert.equal((await mailSettingsPublic(dir)).workspace,'grynh2','the public view carries the bound workspace');
      await saveMailSettings(dir,{host:'8.8.8.8',user:'me@example.com',password:'p'});
      assert.equal((await loadMailSettings(dir)).workspace,'','omitting workspace clears the binding');
    }finally{await rm(dir,{recursive:true,force:true});}
  });
});

test('re-saving with a blank password keeps the stored one; a new password re-seals',async()=>{
  const dir=await tmp();
  await withEnv({OUTREACH_SECRET:SECRET},async()=>{
    try{
      await saveMailSettings(dir,{host:'8.8.8.8',user:'me@example.com',password:'first-pass'});
      await saveMailSettings(dir,{host:'8.8.4.4',user:'me@example.com',password:''});
      let loaded=await loadMailSettings(dir);
      assert.equal(loaded.password,'first-pass','blank password keeps the existing one');
      assert.equal(loaded.host,'8.8.4.4','non-secret fields still update');
      await saveMailSettings(dir,{host:'8.8.4.4',user:'me@example.com',password:'second-pass'});
      loaded=await loadMailSettings(dir);
      assert.equal(loaded.password,'second-pass','a new password replaces the old');
    }finally{await rm(dir,{recursive:true,force:true});}
  });
});

test('without OUTREACH_SECRET a password cannot be saved and the UI is told why',async()=>{
  const dir=await tmp();
  await withEnv({OUTREACH_SECRET:undefined},async()=>{
    try{
      delete process.env.OUTREACH_SECRET;
      assert.equal(mailSecretAvailable(),false);
      await assert.rejects(()=>saveMailSettings(dir,{host:'8.8.8.8',user:'me@example.com',password:'x'}),/OUTREACH_SECRET/);
      const pub=await mailSettingsPublic(dir);
      assert.equal(pub.secretAvailable,false,'the public view must flag the missing secret');
    }finally{await rm(dir,{recursive:true,force:true});}
  });
});

test('a rotated secret makes a previously stored password unreadable rather than leaking it',async()=>{
  const dir=await tmp();
  try{
    process.env.OUTREACH_SECRET=SECRET;
    await saveMailSettings(dir,{host:'8.8.8.8',user:'me@example.com',password:'sup3r-s3cret'});
    process.env.OUTREACH_SECRET='a-completely-different-secret';
    const loaded=await loadMailSettings(dir);
    assert.equal(loaded.password,'','a wrong secret must not decrypt to the real password');
    assert.equal(loaded.user,'me@example.com','non-secret fields remain readable');
  }finally{delete process.env.OUTREACH_SECRET;await rm(dir,{recursive:true,force:true});}
});

const msg=(over={})=>({uid:1,messageId:'<a@b>',from:'Jane Doe <jane@lead.com>',to:'me@ws.com',subject:'Re: partnership',text:'Hello there',html:'',date:'2026-01-02T03:04:05.000Z',...over});

test('thread-ingest creates inbox threads and dedupes by Message-ID',()=>{
  const s=structuredClone(createState());
  const ws=s.workspaces.find(w=>w.id===WS);
  const before=ws.threads.length;
  const r1=perform(s,'thread-ingest',{workspace:WS,messages:[msg()]});
  assert.equal(r1.added,1,'first ingest adds one thread');
  const t=ws.threads[0];
  assert.equal(t.folder,'inbox');
  assert.equal(t.subject,'Re: partnership');
  assert.equal(t.messages[0].direction,'in');
  assert.equal(t.messages[0].from.email,'jane@lead.com','the sender address is parsed out of the header');
  assert.equal(t.messages[0].mailMessageId,'<a@b>');
  const r2=perform(s,'thread-ingest',{workspace:WS,messages:[msg()]});
  assert.equal(r2.added,0,'the same Message-ID is not imported twice');
  assert.equal(ws.threads.length,before+1,'exactly one new thread was created in total');
});

test('thread-ingest skips messages without a sender address and sanitises HTML bodies',()=>{
  const s=structuredClone(createState());
  const ws=s.workspaces.find(w=>w.id===WS);
  const r=perform(s,'thread-ingest',{workspace:WS,messages:[
    msg({messageId:'<x@y>',from:'Broken No Address',email:''}),
    msg({messageId:'<ok@z>',from:'Ok <ok@lead.com>',html:'<p>Hi</p><script>steal()</script>'}),
  ]});
  assert.equal(r.added,1,'only the message with a valid sender is imported');
  const body=ws.threads[0].messages[0].bodyHtml;
  assert.ok(!/script/i.test(body),'script tags are stripped from the ingested body');
  assert.ok(/Hi/.test(body),'the safe text survives');
});

test('ipIsPrivateOrReserved blocks internal ranges and allows public addresses',()=>{
  for(const bad of ['0.0.0.0','10.1.2.3','127.0.0.1','169.254.169.254','172.16.5.5','172.31.9.9','192.168.0.7','100.64.1.2','100.127.255.255','198.18.0.1','224.0.0.5','240.0.0.1','::1','::','fe80::1','fc00::1','fd12:3456::7891','ff02::1','100::1','2001:db8::1','::ffff:127.0.0.1','::ffff:7f00:1','2002:7f00:1::']){
    assert.equal(ipIsPrivateOrReserved(bad),true,`${bad} must be treated as private/reserved`);
  }
  for(const good of ['8.8.8.8','1.1.1.1','93.184.216.34','172.32.0.1','100.128.0.1','2606:4700:4700::1111','::ffff:8.8.8.8']){
    assert.equal(ipIsPrivateOrReserved(good),false,`${good} must be treated as public`);
  }
});

// M1: the SSRF validator must recognise internal addresses in EVERY textual form, not just
// the canonical compressed one. These non-canonical spellings all decode to loopback or a
// private/mapped IPv4 and must be rejected; the public long forms must still pass.
test('ipIsPrivateOrReserved canonicalises non-canonical IPv6 forms',()=>{
  for(const bad of [
    '0:0:0:0:0:0:0:1',        // long-form loopback
    '0:0:0:0:0:0:0:0',        // long-form unspecified
    '0:0:0:0:0:ffff:7f00:1',  // long-form IPv4-mapped loopback
    '0:0:0:0:0:ffff:127.0.0.1',
    '0:0:0:0:0:0:10.0.0.1',    // IPv4-compatible private
    '0:0:0:0:0:ffff:192.168.1.1',
    '2002:7f00:0001::',       // long-form 6to4 to 127.0.0.1
    '2002:0a00:0001::',       // 6to4 to 10.0.0.1
    'FE80::1',                // uppercase link-local
    'fe81::1',                // still inside fe80::/10
    'fe80::1%eth0',           // zone id
    '[fe80::1]',              // bracketed
    '0100::',                 // discard-only, zero-padded
    '2001:db8:1::',           // still inside 2001:db8::/32
    '2001:0db8::1',           // documentation, zero-padded
  ]){
    assert.equal(ipIsPrivateOrReserved(bad),true,`${bad} must be treated as private/reserved`);
  }
  for(const good of [
    '0:0:0:0:0:ffff:0808:0808', // long-form mapped to 8.8.8.8 (public)
    '2002:0808:0808::',         // 6to4 to 8.8.8.8 (public)
    '0100:abcd::',              // NOT in 100::/64 — public
    '2001:db9:1::',             // NOT in 2001:db8::/32 — public
    'fec0::1',                  // NOT in fe80::/10 or fc00::/7 — public
  ]){
    assert.equal(ipIsPrivateOrReserved(good),false,`${good} must be treated as public`);
  }
});

test('assertSafeImapHost rejects internal hosts and accepts a public IP literal',async()=>{
  await assert.rejects(()=>assertSafeImapHost('127.0.0.1'),/public address/);
  await assert.rejects(()=>assertSafeImapHost('169.254.169.254'),/public address/);
  await assert.rejects(()=>assertSafeImapHost('[::1]'),/public address/);
  await assert.rejects(()=>assertSafeImapHost('0:0:0:0:0:0:0:1'),/public address/);
  await assert.rejects(()=>assertSafeImapHost('[0:0:0:0:0:ffff:7f00:1]'),/public address/);
  await assert.rejects(()=>assertSafeImapHost('localhost'),/valid IMAP hostname/);
  await assert.rejects(()=>assertSafeImapHost('db.internal'),/Internal hostnames/);
  await assert.rejects(()=>assertSafeImapHost(''),/Enter an IMAP host/);
  assert.equal(await assertSafeImapHost('8.8.8.8'),'8.8.8.8','a public IP literal is returned as-is without DNS');
});

test('saveMailSettings refuses to persist an internal IMAP host',async()=>{
  const dir=await tmp();
  await withEnv({OUTREACH_SECRET:SECRET},async()=>{
    try{
      await assert.rejects(()=>saveMailSettings(dir,{host:'169.254.169.254',user:'me@example.com',password:'p'}),/public address/);
    }finally{await rm(dir,{recursive:true,force:true});}
  });
});
