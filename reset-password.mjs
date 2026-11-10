import {mkdir} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {dirname,join} from 'node:path';
import {stdin as input,stdout as output} from 'node:process';
import {fileURLToPath} from 'node:url';
import {setPassword,passwordRules} from './auth.mjs';

const dataDir=process.env.OUTREACH_DATA_DIR||join(dirname(fileURLToPath(import.meta.url)),'data');
await mkdir(dataDir,{recursive:true});
const rl=createInterface({input,output});
try{
 const first=await rl.question('New Outreach Desk password ('+passwordRules+'): ');
 const second=await rl.question('Confirm password: ');
 if(first!==second)throw Error('Passwords do not match.');
 await setPassword(dataDir,first);
 console.log('Password reset completed. Restart Outreach Desk and log in as admin.');
}finally{rl.close();}
