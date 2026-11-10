import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';

const username='admin';
const passwordFile=dataDir=>join(dataDir,'auth.json');
const sessions=new Map();

const passwordBytes=(password,salt)=>scryptSync(password,salt,32);
const validPassword=password=>typeof password==='string'&&password.length>=10&&password.length<=200;
const storedHash=(password)=>{
 const salt=randomBytes(16);
 return {salt:salt.toString('base64'),hash:passwordBytes(password,salt).toString('base64'),changedAt:new Date().toISOString()};
};
const same=(a,b)=>{
 const left=Buffer.from(a),right=Buffer.from(b);
 return left.length===right.length&&timingSafeEqual(left,right);
};
export const authUsername=username;
export const passwordRules='Use at least 10 characters.';

export async function readAuth(dataDir){
 try{return JSON.parse(await readFile(passwordFile(dataDir),'utf8'));}catch(error){
  if(error.code!=='ENOENT')throw error;
  return null;
 }
}
export async function ensureAuth(dataDir){
 const saved=await readAuth(dataDir);
 return saved||{username,configured:false};
}
export async function verifyPassword(dataDir,password){
 if(typeof password!=='string')return false;
 const saved=await readAuth(dataDir);
 try{
  if(saved?.salt&&saved.hash){
   return same(passwordBytes(password,Buffer.from(saved.salt,'base64')),Buffer.from(saved.hash,'base64'));
  }
  return false;
 }catch{return false;}
}
export async function setPassword(dataDir,password){
 if(!validPassword(password))throw Object.assign(new Error(passwordRules),{status:400});
 const temp=passwordFile(dataDir)+'.tmp';
 await writeFile(temp,JSON.stringify({username,...storedHash(password)},null,2),{encoding:'utf8'});
 await rename(temp,passwordFile(dataDir));
}
export function createSession(){
 const token=randomBytes(32).toString('base64url');
 sessions.set(token,Date.now()+8*60*60*1000);
 return token;
}
export function sessionFrom(req){
 const value=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('outreach_session='));
 const token=value?.slice('outreach_session='.length);
 const expires=token&&sessions.get(token);
 if(!expires||expires<Date.now()){if(token)sessions.delete(token);return null;}
 return token;
}
export function destroySession(req){const token=sessionFrom(req);if(token)sessions.delete(token);}
export function clearSessions(){sessions.clear();}
