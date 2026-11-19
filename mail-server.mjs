// Real-time mail subsystem: the IDLE watcher, the live browser SSE stream, and the shared
// ingest path. Extracted from server.mjs so the request-handler closure no longer owns a
// stateful background resource. server.mjs wires this up with its store/read/encodeState/
// perform and calls the returned methods from the /api/mail/* routes.
//
// imap.mjs lazily imports imapflow/mailparser and mail-settings.mjs uses only node builtins,
// so importing them here keeps `node --test` (no npm install) working exactly as before.
import {loadMailSettings,assertSafeImapHost} from './mail-settings.mjs';
import {imapConfigured,watchMail} from './imap.mjs';

export function createMailServer({dataDir, store, read, encodeState, requestError, perform}){
  // ---- live browser stream (SSE) ----
  // The browser keeps one EventSource open on the Thread view; when the watcher (or a manual
  // fetch) ingests mail we push an event so the open tab updates without reload. send() always
  // ends a response, so the SSE route in server.mjs writes raw and registers via addSseClient.
  const sseClients=new Set();
  function broadcastMailUpdate(payload){
    const data='event: mail\ndata: '+JSON.stringify(payload)+'\n\n';
    for(const client of sseClients){try{client.write(data);}catch{sseClients.delete(client);}}
  }

  // ---- shared ingest (manual fetch + IDLE watcher) ----
  // Both paths use the SAME deduped compare-and-swap write. The reducer dedups by Message-ID
  // (falling back to uid), so a retry after a lost CAS never double-adds. The watcher passes
  // the mailbox's bound workspace; when none is set, ingest falls back to the FIRST workspace,
  // never state.active (which is mutated by unrelated browser actions). The bounded retry
  // loop coexists with the 5-minute maintain() interval, which bumps the revision under the
  // same CAS.
  async function ingestMail(messages,{workspace}={}){
    const settings=await loadMailSettings(dataDir);
    if(!settings||!imapConfigured(settings))return {added:0,skipped:'no-settings'};
    const list=Array.isArray(messages)?messages.filter(Boolean):[];
    if(!list.length)return {added:0,skipped:'all-dupes'};
    for(let attempt=0;attempt<4;attempt++){
      // read() (not load()/maintain()): ingest only needs the current state for the CAS.
      const state=await read();
      const target=(workspace&&state.workspaces.some(w=>w.id===workspace))?workspace:state.workspaces[0]?.id;
      const result=perform(state,'thread-ingest',{workspace:target,messages:list});
      if(!result.added)return {added:0,skipped:'all-dupes',revision:state.revision};
      const previous=state.revision;state.revision++;
      if(await store.save(state.revision,encodeState(state),previous)){
        broadcastMailUpdate({added:result.added,revision:state.revision});
        return {added:result.added,revision:state.revision};
      }
    }
    throw requestError(409,'The workspace changed. Please try again.');
  }

  // ---- one persistent IDLE connection per server process ----
  // Never started during createApp (only on listen) so tests that build the app without
  // listening never open a socket. The `starting` flag reserves the slot synchronously across
  // the awaits below, so two concurrent /api/mail/save calls (or a save racing listen()
  // startup) cannot leak a second watcher.
  let mailWatcher=null, mailWatcherStarting=false;
  async function startWatcher(attempt=0){
    if(mailWatcher||mailWatcherStarting)return;
    mailWatcherStarting=true;
    try{
      const settings=await loadMailSettings(dataDir);
      if(!settings||!imapConfigured(settings)){console.log('Mail watcher: not configured, skipping.');return;}
      try{await assertSafeImapHost(settings.host);}
      catch(error){console.error('Mail watcher: refusing unsafe host -',error.message);return;}
      mailWatcher=watchMail({
        ...settings,
        // onNew receives the whole `exists` batch and must be awaitable: ingestMail resolves
        // once the messages are committed and rejects on a CAS conflict, which tells the
        // watcher to keep its UID mark and retry instead of dropping the mail. The mailbox is
        // bound to settings.workspace so live intake never lands in the browser-driven active
        // workspace.
        onNew:(messages)=>ingestMail(messages,{workspace:settings.workspace}),
        onError:(error)=>console.error('Mail watcher error:',error.response||error.message||error),
      });
      console.log('Mail watcher: IDLE connected for',settings.user);
    }catch(error){
      // A transient boot failure (e.g. mail.json momentarily unreadable) must not strand live
      // intake until the next save or restart — retry with capped exponential backoff. The
      // "not configured" and "unsafe host" paths return above WITHOUT throwing and are NOT
      // retried (they are config states, not transient errors).
      console.error('Mail watcher start failed:',error.message||error);
      if(attempt<6)setTimeout(()=>startWatcher(attempt+1),Math.min(300000,15000*2**attempt)).unref?.();
    }finally{
      mailWatcherStarting=false;
    }
  }
  async function stopWatcher(){
    if(!mailWatcher)return;
    const watcher=mailWatcher;mailWatcher=null;
    try{await watcher.stop();}catch{/* ignore teardown errors */}
  }

  return {
    ingestMail, startWatcher, stopWatcher, broadcastMailUpdate,
    addSseClient:res=>{sseClients.add(res);},
    removeSseClient:res=>{sseClients.delete(res);},
  };
}
