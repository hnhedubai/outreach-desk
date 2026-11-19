// Thread / conversation action handlers, extracted from model.mjs's perform() so the
// reducer stays focused on lead/workspace state. model.mjs still owns the shared
// primitives (tidy, byId, invalid, …) and the conversation helpers (newMessage, makeThread,
// …); this module imports them and dispatches ONLY the `thread-*` action types. Behaviour is
// identical to the previous inline `if (type === 'thread-*')` blocks.
//
// Note the deliberate module cycle: model.mjs imports threadAction from here, and here we
// import helpers from model.mjs. ES modules resolve these bindings at call time, and every
// reference below is inside a function body (never at module-eval time), so the cycle is safe.
import {sanitizeHtml} from './public/sanitize.js';
import {
  byId,invalid,tidy,list,isRecord,now,audit,
  parseAddress,parseAddressList,esc,newMessage,threadActor,makeThread,pruneThreads,
  uniquePeople,personList,leadInWorkspace,touchThread,findMessage,withoutSelf,emailOf,
  quoteHtml,tidyPerson,FOLDERS,
} from './model.mjs';

export function threadAction(ws,type,input){
  if(type==='thread-ingest'){
    // Turn fetched IMAP messages into inbox threads. Deduped by RFC Message-ID (falling
    // back to the IMAP uid) so repeated "Fetch new mail" pulls never duplicate a thread.
    const known=new Set();
    for(const t of ws.threads)for(const m of t.messages){if(m.mailMessageId)known.add(m.mailMessageId);if(m.mailUid!==undefined)known.add('uid:'+m.mailUid);}
    let added=0;
    for(const raw of list(input.messages,100)){
      if(!isRecord(raw))continue;
      const from=parseAddress(raw.from);if(!from.email)continue;
      const to=parseAddressList(raw.to);
      // Build a dedup key only from a real identifier: Message-ID, else the IMAP uid.
      // A message with neither gets an empty key (so it is never falsely collapsed onto the
      // single 'uid:' entry a missing uid would otherwise produce) and is still ingested.
      const key=raw.messageId?String(raw.messageId):(raw.uid!==undefined?'uid:'+raw.uid:'');
      if(key&&known.has(key))continue;
      const bodyHtml=String(raw.html||'').trim()
        ?String(raw.html)
        :'<div>'+esc(String(raw.text||'')).replace(/\r?\n/g,'<br>')+'</div>';
      const message=newMessage({direction:'in',from,to,bodyHtml,kind:'message'});
      if(raw.messageId)message.mailMessageId=String(raw.messageId).slice(0,500);
      if(raw.uid!==undefined)message.mailUid=raw.uid;
      if(raw.date)message.at=tidy(raw.date,40)||message.at;
      const self=threadActor(ws);
      const thread=makeThread(ws,{subject:raw.subject||'(no subject)',folder:'inbox',
        participants:[from,...to,self],first:message});
      if(message.mailMessageId)known.add(message.mailMessageId);
      if(message.mailUid!==undefined)known.add('uid:'+message.mailUid);
      thread.updatedAt=message.at;thread.createdAt=message.at;
      added++;
    }
    // Bound the document: drop the oldest auto-ingested mail if the cap is exceeded.
    pruneThreads(ws);
    return {added};
  }
  if(type==='thread-save-draft'){
    const self=threadActor(ws);
    const subject=tidy(input.subject,300);
    const to=uniquePeople(personList(input.to)),cc=uniquePeople(personList(input.cc));
    const message=newMessage({direction:'out',from:self,to,cc,bodyHtml:input.bodyHtml});
    const lead=leadInWorkspace(ws,input.leadId);
    if(input.threadId){
      const thread=byId(ws.threads,input.threadId,'Draft unavailable.');
      if(thread.folder!=='drafts')invalid('That conversation is not a draft.');
      thread.subject=subject||'(no subject)';
      thread.messages=[message];
      thread.leadId=lead?lead.lead.id:thread.leadId;thread.projectId=lead?lead.project.id:thread.projectId;
      thread.participants=uniquePeople([self,...to,...cc]);thread.updatedAt=now();
      return {thread:thread.id};
    }
    const thread=makeThread(ws,{subject,folder:'drafts',leadId:input.leadId,
      participants:[self,...to,...cc],first:message});
    return {thread:thread.id};
  }
  if(type==='thread-send'){
    const self=threadActor(ws);
    const to=uniquePeople(personList(input.to)),cc=uniquePeople(personList(input.cc));
    if(!to.length)invalid('Add at least one recipient.');
    const message=newMessage({direction:'out',from:self,to,cc,bodyHtml:input.bodyHtml});
    const lead=leadInWorkspace(ws,input.leadId);
    let thread;
    if(input.threadId){
      thread=byId(ws.threads,input.threadId,'Conversation unavailable.');
      thread.subject=tidy(input.subject,300)||thread.subject;
      if(thread.folder==='drafts')thread.messages=[message];else thread.messages.push(message);
      if(lead){thread.leadId=lead.lead.id;thread.projectId=lead.project.id;}
      touchThread(thread,self);
    }else{
      thread=makeThread(ws,{subject:tidy(input.subject,300),folder:'sent',leadId:input.leadId,
        participants:[self,...to,...cc],first:message});
    }
    thread.folder='sent';thread.unread=false;thread.updatedAt=now();
    audit(ws,null,'Thread sent',{threadId:thread.id,recipients:[...to,...cc].map(p=>p.email)});
    return {thread:thread.id};
  }
  if(type==='thread-reply'||type==='thread-reply-all'){
    const self=threadActor(ws);
    const thread=byId(ws.threads,input.threadId,'Conversation unavailable.');
    const original=findMessage(thread,input.messageId);
    const to=uniquePeople(withoutSelf([original.from,...original.to],emailOf(self)));
    const cc=type==='thread-reply-all'?uniquePeople(withoutSelf(original.cc,emailOf(self))):[];
    if(!to.length&&!cc.length)invalid('There is no one to reply to.');
    const message=newMessage({direction:'out',from:self,to,cc,bodyHtml:input.bodyHtml,inReplyTo:original.id});
    thread.messages.push(message);touchThread(thread,self);
    thread.unread=false;thread.folder=thread.folder==='drafts'?'inbox':thread.folder;
    audit(ws,null,'Thread reply sent',{threadId:thread.id,all:type==='thread-reply-all'});
    return {thread:thread.id,messageId:message.id};
  }
  if(type==='thread-forward'){
    const self=threadActor(ws);
    const thread=byId(ws.threads,input.threadId,'Conversation unavailable.');
    const original=findMessage(thread,input.messageId);
    const to=uniquePeople(personList(input.to)),cc=uniquePeople(personList(input.cc));
    if(!to.length)invalid('Add at least one recipient.');
    const bodyHtml=sanitizeHtml(input.bodyHtml)+'<hr>'+quoteHtml(original);
    const message=newMessage({direction:'out',from:self,to,cc,bodyHtml});
    const forwarded=makeThread(ws,{subject:'Fwd: '+(thread.subject||'(no subject)'),folder:'sent',leadId:thread.leadId,
      participants:[self,...to,...cc],first:message});
    audit(ws,null,'Thread forwarded',{threadId:forwarded.id,from:thread.id});
    return {thread:forwarded.id};
  }
  if(type==='thread-receive'){
    // Record an inbound reply logged inside the app (no external mail sync).
    const thread=byId(ws.threads,input.threadId,'Conversation unavailable.');
    const from=tidyPerson(input.from)||thread.participants.find(p=>emailOf(p)!==emailOf(threadActor(ws)))||invalid('Enter the sender.',400);
    const message=newMessage({direction:'in',from,to:[threadActor(ws)],bodyHtml:input.bodyHtml});
    thread.messages.push(message);touchThread(thread,from);
    thread.unread=true;
    if(thread.folder==='archive'||thread.folder==='trash')thread.folder='inbox';
    if(thread.leadId){const found=leadInWorkspace(ws,thread.leadId);if(found)found.lead.lifecycle=found.lead.lifecycle==='Prospect'?'Engaged':found.lead.lifecycle;}
    audit(ws,null,'Inbound reply logged',{threadId:thread.id});
    return {thread:thread.id,messageId:message.id};
  }
  if(type==='thread-read'){
    const thread=byId(ws.threads,input.threadId,'Conversation unavailable.');
    thread.unread=!!input.unread;return {};
  }
  if(type==='thread-star'){
    const thread=byId(ws.threads,input.threadId,'Conversation unavailable.');
    thread.starred=!!input.starred;return {};
  }
  if(type==='thread-important'){
    const thread=byId(ws.threads,input.threadId,'Conversation unavailable.');
    thread.important=!!input.important;return {};
  }
  if(type==='thread-move'){
    const folder=String(input.folder||'');
    if(!FOLDERS.has(folder))invalid('Unknown folder.');
    const thread=byId(ws.threads,input.threadId,'Conversation unavailable.');
    thread.folder=folder;thread.unread=folder==='inbox'?thread.unread:false;return {};
  }
  if(type==='thread-label'){
    const thread=byId(ws.threads,input.threadId,'Conversation unavailable.');
    thread.labels=[...new Set(list(input.labels,20).map(x=>tidy(x,60)).filter(Boolean))];return {};
  }
  if(type==='thread-delete'){
    const thread=byId(ws.threads,input.threadId,'Conversation unavailable.');
    ws.threads=ws.threads.filter(x=>x.id!==thread.id);
    audit(ws,null,'Thread deleted',{threadId:thread.id});return {};
  }
  invalid('Unknown action.',404);
}
