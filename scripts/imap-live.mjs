// Live IMAP test for Thread — run from a terminal to verify real-time mail intake.
//   npm start is NOT required; this connects directly to the mailbox.
//
//   node scripts/imap-live.mjs            # fetch latest 10, then IDLE for new mail
//   node scripts/imap-live.mjs --no-idle  # fetch only, then exit
//
// Reads IMAP_USER / IMAP_PASS (and optional IMAP_HOST/PORT/MAILBOX) from .env.
import '../imap.mjs'; // ensures imapflow/mailparser resolve against the app deps
import {fetchRecentMail, watchMail, imapConfigured} from '../imap.mjs';

const noIdle = process.argv.includes('--no-idle');

if (!imapConfigured()) {
  console.error('IMAP_USER / IMAP_PASS are not set. Add them to .env first, e.g.');
  console.error('  IMAP_HOST=imap.dreamhost.com');
  console.error('  IMAP_PORT=993');
  console.error('  IMAP_USER=you@yourdomain.com');
  console.error('  IMAP_PASS=...');
  process.exit(1);
}

const line = '─'.repeat(72);
function show(m, tag) {
  console.log(`\n${line}\n[${tag}] ${m.seen ? 'READ' : 'UNREAD'}  uid=${m.uid}  ${m.date}`);
  console.log(`From: ${m.from}`);
  console.log(`To:   ${m.to}`);
  console.log(`Subj: ${m.subject}`);
  if (m.attachments.length) console.log(`Files: ${m.attachments.map(a => a.filename).join(', ')}`);
  console.log(m.preview || '(empty body)');
}

console.log(`Connecting to ${process.env.IMAP_HOST || 'imap.dreamhost.com'}:${process.env.IMAP_PORT || 993} as ${process.env.IMAP_USER} ...`);

try {
  const recent = await fetchRecentMail({limit: 10});
  console.log(`\nFetched ${recent.length} recent message(s) from ${process.env.IMAP_MAILBOX || 'INBOX'}.`);
  for (const m of recent) show(m, 'RECENT');
} catch (err) {
  console.error('\nFetch failed:', err.message || err);
  if (err.code) console.error('code:', err.code, '| response:', err.response || '');
  process.exit(2);
}

if (noIdle) process.exit(0);

console.log(`\n${line}\nIDLE: watching for new mail in real time. Send a message to ${process.env.IMAP_USER} now. Ctrl+C to stop.`);
const watcher = watchMail({
  onNew: m => show(m, 'NEW LIVE'),
  onError: e => console.error('watcher error:', e.message || e),
});
process.on('SIGINT', async () => { await watcher.stop(); console.log('\nStopped.'); process.exit(0); });
