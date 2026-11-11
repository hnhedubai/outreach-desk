// Single async interface over the workspace_state table.
// Backend is chosen by env: DATABASE_URL set -> Postgres (Neon); otherwise SQLite.
// pg is imported lazily so SQLite mode keeps the project dependency-free.
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const SQLITE_SCHEMA='PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS workspace_state(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, document TEXT NOT NULL)';
const PG_SCHEMA='CREATE TABLE IF NOT EXISTS workspace_state(id integer PRIMARY KEY CHECK(id=1), revision integer NOT NULL, document text NOT NULL)';

function openSqlite(providedDb,dataDir){
 const ownsDb=!providedDb;
 const db=providedDb||new DatabaseSync(join(dataDir,'outreach.sqlite'));
 db.exec(SQLITE_SCHEMA);
 const get=db.prepare('SELECT revision,document FROM workspace_state WHERE id=1');
 const ins=db.prepare('INSERT OR IGNORE INTO workspace_state VALUES (1,0,?)');
 const upd=db.prepare('UPDATE workspace_state SET revision=?,document=? WHERE id=1 AND revision=?');
 return {
  backend:'sqlite',
  async getState(){const r=get.get();return r?{revision:r.revision,document:r.document}:null;},
  async seed(document){ins.run(document);},
  async save(revision,document,expectedRevision){return upd.run(revision,document,expectedRevision).changes===1;},
  async close(){if(ownsDb)db.close();},
 };
}

async function openPostgres(url){
 const {Pool}=await import('pg');
 const pool=new Pool({connectionString:url,ssl:{require:true},max:5});
 await pool.query(PG_SCHEMA);
 return {
  backend:'postgres',
  async getState(){const r=await pool.query('SELECT revision,document FROM workspace_state WHERE id=1');return r.rows[0]?{revision:r.rows[0].revision,document:r.rows[0].document}:null;},
  async seed(document){await pool.query('INSERT INTO workspace_state(id,revision,document) VALUES (1,0,$1) ON CONFLICT (id) DO NOTHING',[document]);},
  async save(revision,document,expectedRevision){const r=await pool.query('UPDATE workspace_state SET revision=$1,document=$2 WHERE id=1 AND revision=$3',[revision,document,expectedRevision]);return r.rowCount===1;},
  async close(){await pool.end();},
 };
}

// Returns the active store. providedDb only honoured in SQLite mode (used by tests).
export async function openStore({providedDb,dataDir}={}){
 const url=process.env.DATABASE_URL;
 if(url)return openPostgres(url);
 if(!dataDir)throw Error('openStore requires dataDir when DATABASE_URL is not set.');
 return openSqlite(providedDb,dataDir);
}
