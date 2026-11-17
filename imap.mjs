// Real-time IMAP intake for Thread.
// Connects to a mailbox over IMAPS (TLS), normalises recent messages, and can
// IDLE so new mail is pushed the moment it arrives. DreamHost root mailbox is
// the reference target: host imap.dreamhost.com, port 993, TLS.
//
// Settings come from the encrypted mailbox store (mail-settings.mjs) when the app
// calls these functions; when run standalone (scripts/imap-live.mjs) they fall back
// to env so the terminal test keeps working without the app:
//   IMAP_HOST   (default imap.dreamhost.com)
//   IMAP_PORT   (default 993)
//   IMAP_USER   the full mailbox address, e.g. you@yourdomain.com
//   IMAP_PASS   the mailbox password (DreamHost: the mail account password)
//   IMAP_MAILBOX (default INBOX)
// imapflow/mailparser are loaded lazily so that merely importing this module
// (server.mjs does, transitively, on every request) never requires the packages to
// be installed. CI runs `node --test` with no `npm install` — the same pattern used
// for pg in db.mjs — so the deps only resolve when a real IMAP call is made.
let _ImapFlow=null,_simpleParser=null;
async function imapflowLib(){if(!_ImapFlow)({ImapFlow:_ImapFlow}=await import('imapflow'));return _ImapFlow;}
async function mailparserLib(){if(!_simpleParser)({simpleParser:_simpleParser}=await import('mailparser'));return _simpleParser;}

const HOST_DEFAULT='imap.dreamhost.com';
const PORT_DEFAULT=993;
const MAILBOX_DEFAULT='INBOX';

// Resolve a settings object, defaulting each field from the environment so the
// standalone script needs no changes. `settings` may be partial or omitted.
function resolveSettings(settings={}){
  const host=settings.host||process.env.IMAP_HOST||HOST_DEFAULT;
  const port=Number(settings.port??process.env.IMAP_PORT??PORT_DEFAULT)||PORT_DEFAULT;
  const mailbox=settings.mailbox||process.env.IMAP_MAILBOX||MAILBOX_DEFAULT;
  const user=settings.user||process.env.IMAP_USER||'';
  const pass=settings.password??settings.pass??process.env.IMAP_PASS??'';
  const tls=settings.tls===undefined?!Boolean(process.env.IMAP_INSECURE):settings.tls!==false;
  return {host,port,mailbox,user,pass,tls};
}

// True when a usable user+password pair exists (settings first, then env).
export function imapConfigured(settings){
  const s=resolveSettings(settings);
  return Boolean(s.user&&s.pass);
}

async function newClient(settings){
  const s=resolveSettings(settings);
  const ImapFlow=await imapflowLib();
  return new ImapFlow({
    host:s.host,
    port:s.port,
    auth:{user:s.user,pass:s.pass},
    // Force certificate verification even if the process has
    // NODE_TLS_REJECT_UNAUTHORIZED=0 set globally.
    tls:s.tls,
    tlsOptions:{rejectUnauthorized:true},
    connTimeout:20000,
    greetingTimeout:20000,
    socketTimeout:60000,
    logger:false,
  });
}


// Turn one fetched message into the compact shape Thread's inbox expects.
async function normalize(msg) {
  const simpleParser = await mailparserLib();
  const parsed = msg.source ? await simpleParser(msg.source) : {};
  const text = (parsed.text || '').trim();
  return {
    uid: msg.uid,
    messageId: parsed.messageId || '',
    date: parsed.date ? parsed.date.toISOString()
      : (msg.internalDate ? new Date(msg.internalDate).toISOString() : ''),
    from: parsed.from?.text || '',
    to: parsed.to?.text || '',
    subject: parsed.subject || '(no subject)',
    text,
    html: typeof parsed.html === 'string' ? parsed.html : '',
    preview: text.replace(/\s+/g, ' ').slice(0, 160),
    seen: Boolean(msg.flags && [...msg.flags].includes('\\Seen')),
    attachments: (parsed.attachments || []).map(a => ({filename: a.filename, contentType: a.contentType, size: a.size})),
  };
}

const FETCH = {uid: true, source: true, flags: true, internalDate: true};

// Fetch the newest `limit` messages, newest-first. Pass mailbox settings in the same
// object as `limit` (e.g. from loadMailSettings); omit them to fall back to env.
export async function fetchRecentMail(options = {}) {
  const opts = options || {};
  const limit = Number(opts.limit) || 20;
  const s = resolveSettings(opts);
  const client = await newClient(opts);
  try {
    await client.connect();
    await client.mailboxOpen(s.mailbox);
    const total = client.mailbox.exists;
    if (!total) return []; // empty mailbox: nothing to fetch (avoids a bogus 1:* range error)
    const from = Math.max(1, total - limit + 1);
    const out = [];
    for await (const msg of client.fetch(`${from}:*`, FETCH)) out.push(await normalize(msg));
    out.sort((a, b) => (b.uid || 0) - (a.uid || 0));
    return out;
  } finally {
    // Close defensively: if connect() failed the socket may be half-open and
    // close() can return undefined or throw. Swallowing cleanup errors here is
    // what lets the *original* connection error propagate to the caller instead
    // of a misleading "reading 'catch' of undefined".
    try { await client.close(); } catch { /* ignore cleanup errors */ }
  }
}

// Open an IDLE watcher. Calls onNew(message) the instant mail lands, onError(err)
// on a drop (the watcher auto-reconnects). Returns {stop}.
export function watchMail({onNew, onError, ...settings} = {}) {
  const s=resolveSettings(settings);
  let stopped = false;
  let client = null;
  let timer = null;

  const start = async () => {
    if (stopped) return;
    client = await newClient(settings);
    try {
      await client.connect();
      await client.mailboxOpen(s.mailbox);
      client.on('exists', async (info) => {
        const seq = info.exists; // highest recent number
        try {
          for await (const msg of client.fetch(String(seq), FETCH)) {
            if (msg && msg.source) onNew && onNew(await normalize(msg));
          }
        } catch (err) { onError && onError(err); }
      });
      // client.idle() resolves when the IDLE session ends (server timeout / stop).
      await client.idle();
      if (!stopped) start(); // server closed IDLE — reopen
    } catch (err) {
      onError && onError(err);
      if (!stopped) timer = setTimeout(start, 5000);
    }
  };

  start();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer); // do not let a queued reconnect fire after stop
      try { client && (await client.close()); } catch {}
    },
  };
}
