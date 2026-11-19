// Encrypted mailbox (IMAP) settings for Thread.
//
// The workspace document is serialised in full to the browser on every /api/state,
// so a mailbox password must NEVER live inside it. Instead the credentials sit in a
// separate file in the data dir, with the password encrypted at rest using AES-256-GCM.
// The key is derived from the OUTREACH_SECRET env var (scrypt), so the ciphertext is
// useless without that secret and the password can never be read back out to the client.
//
// On an ephemeral host (Render) the data dir is wiped on redeploy, so OUTREACH_SECRET
// must be set in the environment for a saved password to survive a redeploy. It is read
// here from the process env, never stored.
import {randomBytes,scryptSync,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {isIP} from 'node:net';
import {lookup} from 'node:dns/promises';

const FILE='mail.json';
const HOST_DEFAULT='imap.dreamhost.com';
const PORT_DEFAULT=993;
const MAILBOX_DEFAULT='INBOX';
const tidy=value=>String(value??'').trim();

// ---- SSRF guard ------------------------------------------------------------
// The app dials whatever IMAP host the settings name, so an attacker who can
// write the settings (or a hand-edited mail.json) could otherwise point the
// server at internal services. We only allow a public, resolvable host: reject
// IP literals in private/loopback/link-local/CGNAT/metadata/multicast/reserved
// ranges, reject internal hostnames, and reject hostnames that resolve to any
// non-public address.
const hostInvalid=message=>Object.assign(new Error(message),{status:400});
const V4_BAD=[[0,0,0,0,8],[10,0,0,0,8],[100,64,0,0,10],[127,0,0,0,8],[169,254,0,0,16],
  [172,16,0,0,12],[192,0,0,0,24],[192,0,2,0,24],[192,88,99,0,24],[192,168,0,0,16],
  [198,18,0,0,15],[198,51,100,0,24],[203,0,113,0,24],[224,0,0,0,4],[240,0,0,0,4]];
const toLong=(a,b,c,d)=>(((a<<24)|(b<<16)|(c<<8)|d)>>>0);
function ipv4Bad(ip){
  const parts=ip.split('.');
  if(parts.length!==4||parts.some(p=>!/^\d{1,3}$/.test(p)||Number(p)>255))return true;
  const n=toLong(...parts.map(Number));
  for(const [a,b,c,d,bits] of V4_BAD){
    const mask=bits===0?0:(((~0)<<(32-bits))>>>0);
    if(((n&mask)>>>0)===((toLong(a,b,c,d)&mask)>>>0))return true;
  }
  return false;
}
// Parse an IPv6 string into its eight 16-bit hextets, so every textual form
// ('::1', '0:0:0:0:0:0:0:1', '0:0:0:0:0:ffff:7f00:1', '[::1]', 'fe80::1%eth0',
// '::ffff:127.0.0.1', …) canonicalises to the SAME groups before the range checks.
// This is what closes the long-form loopback / IPv4-mapped bypass that string
// matching alone cannot: the checks below run on the numeric groups, not the text.
// Returns null on anything malformed so the caller fails closed.
function parseV6Groups(raw){
  let s=String(raw).toLowerCase().replace(/^\[|\]$/g,'');
  const zi=s.indexOf('%');if(zi>=0)s=s.slice(0,zi);          // strip zone id
  if(!s)return null;
  const dot=s.lastIndexOf('.');
  if(dot>=0){                                                // embedded IPv4 → two hextets
    const ci=s.lastIndexOf(':');if(ci<0||ci>dot)return null;
    const p=s.slice(ci+1).split('.');
    if(p.length!==4||p.some(x=>!/^\d{1,3}$/.test(x)||Number(x)>255))return null;
    const hi=(Number(p[0])<<8|Number(p[1])).toString(16);
    const lo=(Number(p[2])<<8|Number(p[3])).toString(16);
    s=s.slice(0,ci+1)+hi+':'+lo;
  }
  const hex=v=>/^[0-9a-f]{1,4}$/.test(v),n=v=>parseInt(v,16);
  const dbl=s.indexOf('::');
  if(dbl<0){                                                 // no compression: exactly 8 groups
    const g=s.split(':');if(g.length!==8)return null;
    const out=[];for(const h of g){if(!hex(h))return null;out.push(n(h));}return out;
  }
  if(s.indexOf('::',dbl+1)>=0)return null;                   // a second '::' is invalid
  const head=s.slice(0,dbl).split(':').filter(Boolean);
  const tail=s.slice(dbl+2).split(':').filter(Boolean);
  if(!head.every(hex)||!tail.every(hex))return null;
  const fill=8-head.length-tail.length;
  if(fill<0)return null;
  return [...head.map(n),...Array(fill).fill(0),...tail.map(n)];
}
// Map a pair of hextets back to dotted-quad text so the IPv4 bad-range check applies
// to IPv4-mapped (::ffff:x) and 6to4 (2002:x) addresses.
const v4From=(hi,lo)=>`${(hi>>8)&255}.${hi&255}.${(lo>>8)&255}.${lo&255}`;
function ipv6Bad(raw){
  const g=parseV6Groups(raw);
  if(!g)return true;                 // unparseable — fail closed
  const zeros=(from,to)=>g.slice(from,to).every(x=>x===0);
  if(zeros(0,8))return true;         // :: unspecified
  if(zeros(0,7)&&g[7]===1)return true; // ::1 loopback (any textual form)
  if((g[0]&0xFE00)===0xFC00)return true;  // fc00::/7 unique-local
  if((g[0]&0xFFC0)===0xFE80)return true;  // fe80::/10 link-local
  if((g[0]&0xFF00)===0xFF00)return true;  // ff00::/8 multicast
  if(g[0]===0x0100&&zeros(1,4))return true; // 100::/64 discard-only
  if(g[0]===0x2001&&g[1]===0x0DB8)return true; // 2001:db8::/32 documentation
  if(zeros(0,5)&&g[5]===0xFFFF)return ipv4Bad(v4From(g[6],g[7])); // ::ffff:a.b.c.d / ::a.b.c.d mapped
  if(zeros(0,6))return ipv4Bad(v4From(g[6],g[7]));  // IPv4-compatible ::a.b.c.d (deprecated)
  if(g[0]===0x2002)return ipv4Bad(v4From(g[1],g[2])); // 2002::/16 6to4
  return false;
}
export function ipIsPrivateOrReserved(ip){
  const family=isIP(ip);
  if(family===4)return ipv4Bad(ip);
  if(family===6)return ipv6Bad(ip);
  return true; // not a valid IP literal — fail closed
}
// Validate + normalise a user-supplied IMAP host. Throws a 400 on anything that
// could reach an internal address. Returns the cleaned host string.
export async function assertSafeImapHost(rawHost){
  const host=String(rawHost??'').trim().toLowerCase().replace(/\.+$/,'');
  if(!host)throw hostInvalid('Enter an IMAP host.');
  if(host.length>253)throw hostInvalid('The IMAP host is too long.');
  const bare=host.replace(/^\[|\]$/g,'');
  if(isIP(bare)){
    if(ipIsPrivateOrReserved(bare))throw hostInvalid('The IMAP host must be a public address — private, loopback and link-local addresses are not allowed.');
    return bare;
  }
  if(!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host))throw hostInvalid('Enter a valid IMAP hostname.');
  if(host==='localhost'||/(\.localhost|\.local|\.internal|\.home\.arpa|\.localdomain)$/.test(host))throw hostInvalid('Internal hostnames are not allowed for the IMAP host.');
  // Residual risk (accepted for a single-user install): this resolves the hostname here,
  // but ImapFlow re-resolves at connect, so a fast-rebinding DNS record could differ
  // between the two lookups (TOCTOU). Pinning the validated IP would break TLS cert
  // hostname verification, so instead every dial path re-runs this check immediately
  // before connecting (see /api/mail/test and /api/mail/fetch), narrowing the window.
  let addresses;
  try{addresses=await lookup(host,{all:true,verbatim:true});}
  catch{throw hostInvalid('The IMAP host could not be resolved.');}
  if(!Array.isArray(addresses)||!addresses.length)throw hostInvalid('The IMAP host could not be resolved.');
  for(const a of addresses){if(ipIsPrivateOrReserved(a.address))throw hostInvalid('The IMAP host resolves to a private or internal address, which is not allowed.');}
  return host;
}


// True when the encryption secret is present. Without it we can neither seal nor open a
// password, so the Settings page surfaces this and refuses to save a new password.
export function mailSecretAvailable(){
  const secret=process.env.OUTREACH_SECRET;
  return typeof secret==='string'&&secret.length>0;
}

function deriveKey(salt){
  const secret=process.env.OUTREACH_SECRET;
  if(typeof secret!=='string'||secret.length===0)throw Object.assign(new Error('Set OUTREACH_SECRET to encrypt mailbox credentials.'),{status:503});
  return scryptSync(secret,salt,32);
}

const seal=(password,key)=>{
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  const data=Buffer.concat([cipher.update(String(password),'utf8'),cipher.final()]);
  return {iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};
};

const open=(sealed,key)=>{
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(sealed.iv,'base64'));
  decipher.setAuthTag(Buffer.from(sealed.tag,'base64'));
  return Buffer.concat([decipher.update(Buffer.from(sealed.data,'base64')),decipher.final()]).toString('utf8');
};

const portOf=value=>{const n=Math.trunc(Number(value));return n>=1&&n<=65535?n:PORT_DEFAULT;};
// TLS is on unless the caller explicitly turns it off (value === false / 'false' / '0').
const tlsOn=value=>!(value===false||value==='false'||value===0||value==='0');
// A mailbox login is a full address for DreamHost, but be permissive — some hosts use a
// bare username. Reject only obvious whitespace, let the server validate on connect.
const userOf=value=>{const u=tidy(value).replace(/\s+/g,'');return u.slice(0,254);};

async function readRaw(dataDir){
  try{return JSON.parse(await readFile(join(dataDir,FILE),'utf8'));}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}

// Full decrypted settings for server-side use only — includes the plaintext password.
// Returns null when nothing has been saved yet.
export async function loadMailSettings(dataDir){
  const saved=await readRaw(dataDir);
  if(!saved||!saved.user)return null;
  let password='';
  if(saved.sealed&&mailSecretAvailable()){
    try{password=open(saved.sealed,deriveKey(Buffer.from(saved.salt,'base64')));}
    catch{password='';} // wrong/rotated secret or tampered file — treat as not configured
  }
  return {host:saved.host||HOST_DEFAULT,port:portOf(saved.port),user:saved.user,
    mailbox:saved.mailbox||MAILBOX_DEFAULT,tls:tlsOn(saved.tls),workspace:saved.workspace||'',password};
}

// Masked settings safe to send to the browser: never the password, never the ciphertext.
export async function mailSettingsPublic(dataDir){
  const saved=await readRaw(dataDir);
  const configured=Boolean(saved&&saved.user&&saved.sealed);
  return {configured,secretAvailable:mailSecretAvailable(),
    host:(saved&&saved.host)||HOST_DEFAULT,port:portOf(saved&&saved.port),
    user:(saved&&saved.user)||'',mailbox:(saved&&saved.mailbox)||MAILBOX_DEFAULT,
    tls:tlsOn(saved&&saved.tls),workspace:(saved&&saved.workspace)||''};
}

// Persist settings. A blank `password` keeps the previously stored one (so editing the
// host or mailbox does not require retyping the secret). Saving any password requires the
// encryption secret; without it we refuse rather than store anything in the clear.
export async function saveMailSettings(dataDir,input={}){
  const user=userOf(input.user);
  if(!user)throw Object.assign(new Error('Enter the mailbox address (username).'),{status:400});
  const host=await assertSafeImapHost(input.host||HOST_DEFAULT);
  const mailbox=tidy(input.mailbox).slice(0,120)||MAILBOX_DEFAULT;
  const workspace=tidy(input.workspace,120);
  const password=typeof input.password==='string'?input.password:'';

  const existing=await readRaw(dataDir);
  let sealed=existing&&existing.sealed?existing.sealed:null;
  let salt=existing&&existing.salt?existing.salt:null;

  if(password){
    if(!mailSecretAvailable())throw Object.assign(new Error('Set OUTREACH_SECRET in the server environment before saving a mailbox password.'),{status:503});
    salt=randomBytes(16).toString('base64');
    sealed=seal(password,deriveKey(Buffer.from(salt,'base64')));
  }
  if(!sealed)throw Object.assign(new Error('Enter the mailbox password.'),{status:400});

  const record={host,port:portOf(input.port),user,mailbox,tls:tlsOn(input.tls),workspace,salt,sealed,savedAt:new Date().toISOString()};
  // Use a unique temp name so two overlapping saves cannot write the same scratch file
  // before the atomic rename; the rename itself is the only point that swaps mail.json.
  const temp=join(dataDir,FILE+'.'+randomBytes(6).toString('hex')+'.tmp');
  await writeFile(temp,JSON.stringify(record,null,2),{encoding:'utf8'});
  await rename(temp,join(dataDir,FILE));
  return {configured:true};
}

export async function clearMailSettings(dataDir){
  await writeFile(join(dataDir,FILE),JSON.stringify({clearedAt:new Date().toISOString()}),{encoding:'utf8'});
  return {configured:false};
}
