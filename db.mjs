// Single async interface over the workspace_state table.
// Backend is chosen by env: DATABASE_URL set -> Postgres (Neon); otherwise SQLite.
// The SQLite file is a fallback, not a replica - see openStore and OUTREACH_REQUIRE_NEON.
// pg is imported lazily: the SQLite path loads no packages at all, and pg is only required
// when DATABASE_URL selects Postgres. It is the project's one approved dependency (AGENTS.md §5).
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

// An inherited NODE_TLS_REJECT_UNAUTHORIZED=0 - set by CI sandboxes and agent shells for their
// own proxying - silently disables certificate verification for every HTTPS request this process
// makes, including the Neon connection and each provider call that carries lead PII. This app does
// not honour it: verification is always enforced, and the variable is deleted so the lazily
// imported pg client cannot inherit it either. Returns true when an override was discarded.
export function enforceTlsVerification(){
 const wasDisabled=process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0';
 if(wasDisabled)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
 return wasDisabled;
}

const SQLITE_SCHEMA='PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS workspace_state(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, document TEXT NOT NULL); CREATE TABLE IF NOT EXISTS verification_audit(id INTEGER PRIMARY KEY AUTOINCREMENT, workspace TEXT, project TEXT, lead TEXT, contact TEXT, email TEXT, status TEXT, score INTEGER, safe_to_send INTEGER, source TEXT, verified_at TEXT NOT NULL)';
const PG_SCHEMA='CREATE TABLE IF NOT EXISTS workspace_state(id integer PRIMARY KEY CHECK(id=1), revision integer NOT NULL, document text NOT NULL); CREATE TABLE IF NOT EXISTS verification_audit(id bigserial PRIMARY KEY, workspace text, project text, lead text, contact text, email text, status text, score integer, safe_to_send boolean, source text, verified_at timestamptz NOT NULL DEFAULT now()); CREATE OR REPLACE FUNCTION record_verification(p_workspace text, p_project text, p_lead text, p_contact text, p_email text, p_status text, p_score integer, p_safe boolean, p_source text) RETURNS void AS $$ BEGIN INSERT INTO verification_audit(workspace,project,lead,contact,email,status,score,safe_to_send,source) VALUES (p_workspace,p_project,p_lead,p_contact,p_email,p_status,p_score,p_safe,p_source); END $$ LANGUAGE plpgsql';

function openSqlite(providedDb,dataDir){
 const ownsDb=!providedDb;
 const db=providedDb||new DatabaseSync(join(dataDir,'outreach.sqlite'));
 db.exec(SQLITE_SCHEMA);
  const get=db.prepare('SELECT revision,document FROM workspace_state WHERE id=1');
  const ins=db.prepare('INSERT OR IGNORE INTO workspace_state VALUES (1,0,?)');
  const upd=db.prepare('UPDATE workspace_state SET revision=?,document=? WHERE id=1 AND revision=?');
  const insAudit=db.prepare('INSERT INTO verification_audit(workspace,project,lead,contact,email,status,score,safe_to_send,source,verified_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  return {
   backend:'sqlite',
   async getState(){const r=get.get();return r?{revision:r.revision,document:r.document}:null;},
   async seed(document){ins.run(document);},
   async save(revision,document,expectedRevision){return upd.run(revision,document,expectedRevision).changes===1;},
   async recordVerification(v){insAudit.run(v.workspace,v.project,v.lead,v.contact,v.email,v.status,v.score??null,v.safeToSend?1:0,v.source,new Date().toISOString());},
   async close(){if(ownsDb)db.close();},
  };
}

// Neon/Postgres resilience. A transient fault is a connection-layer failure (cold wake,
// network blip, server shutdown), not a bug in our query — so it is retried, and a
// sustained outage is surfaced as a retryable 503 rather than an opaque 500.
const TRANSIENT_CODES=new Set(['ETIMEDOUT','ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','53300','57P01','57P02','57P03','58000','58006','08000','08001','08003','08006','08007','08P01']);
const TRANSIENT_MESSAGE=/connection timeout|timeout exceeded|could not connect|server closed the connection|retry transaction|terminating connection|no connection to the server|starting up|in recovery mode|cannot connect now/i;
export function isTransientDbError(error){
 if(!error)return false;
 if(TRANSIENT_CODES.has(error.code))return true;
 return TRANSIENT_MESSAGE.test(String(error.message||''));
}
// Genuine errors (bad SQL, constraint violations) stay statusless so the server logs the
// stack; only transient faults become a friendly, retryable 503.
export function classifyDbError(error){
 if(!isTransientDbError(error))return error;
 return Object.assign(new Error('The database is unavailable, likely waking from idle. Please retry in a moment.'),{status:503,retryable:true,cause:error});
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Exponential backoff on transient faults only; a non-transient error rethrows immediately.
export async function withRetry(fn,{retries=2,delay=400}={}){
 let lastError;
 for(let attempt=0;attempt<=retries;attempt++){
  try{return await fn();}
  catch(error){
   lastError=error;
   if(!isTransientDbError(error)||attempt===retries)break;
   await sleep(delay*2**attempt);
  }
 }
 throw lastError;
}

async function openPostgres(url){
 const {Pool}=await import('pg');
 // Neon serverless autosuspends when idle; the first connection can take far longer than
 // pg's 10s default connect timeout — that is what surfaces as a "connection timeout".
 // Widen the connect window to cover a cold wake, bound every query, and cap the pool.
 const pool=new Pool({
  connectionString:url,ssl:{require:true},max:5,
  connectionTimeoutMillis:30_000,
  idleTimeoutMillis:30_000,
  query_timeout:15_000,
  statement_timeout:15_000,
 });
 // Every pool call is retried on transient faults and classified on final failure.
 const run=(sql,params)=>withRetry(()=>pool.query(sql,params)).catch(classifyDbError);
 await run(PG_SCHEMA);
 return {
  backend:'postgres',
  async getState(){const r=await run('SELECT revision,document FROM workspace_state WHERE id=1');return r.rows[0]?{revision:r.rows[0].revision,document:r.rows[0].document}:null;},
  async seed(document){await run('INSERT INTO workspace_state(id,revision,document) VALUES (1,0,$1) ON CONFLICT (id) DO NOTHING',[document]);},
   async save(revision,document,expectedRevision){const r=await run('UPDATE workspace_state SET revision=$1,document=$2 WHERE id=1 AND revision=$3',[revision,document,expectedRevision]);return r.rowCount===1;},
   async recordVerification(v){await run('SELECT record_verification($1,$2,$3,$4,$5,$6,$7,$8,$9)',[v.workspace,v.project,v.lead,v.contact,v.email,v.status,v.score??null,v.safeToSend===true,v.source]);},
  // Bound shutdown so a connection stuck mid-wake cannot hang process exit.
  async close(){await Promise.race([pool.end(),sleep(10_000)]);},
 };
}

// Returns the active store. providedDb only honoured in SQLite mode (used by tests).
export async function openStore({providedDb,dataDir}={}){
 const url=process.env.DATABASE_URL;
 if(url)return openPostgres(url);
 // SQLite is where a missing DATABASE_URL lands, not where it is meant to be: the local file can
 // hold an older document while Neon holds the live one. Set OUTREACH_REQUIRE_NEON=1 wherever the
 // Neon store is the source of truth, and startup fails loudly instead of serving stale state.
 if(!providedDb&&process.env.OUTREACH_REQUIRE_NEON==='1')throw Error('DATABASE_URL is not set, but OUTREACH_REQUIRE_NEON=1 forbids the local SQLite fallback. Refusing to start: the SQLite document may be stale and would otherwise be served as current. Set DATABASE_URL, or unset OUTREACH_REQUIRE_NEON to use the local store deliberately.');
 if(!dataDir)throw Error('openStore requires dataDir when DATABASE_URL is not set.');
 return openSqlite(providedDb,dataDir);
}
