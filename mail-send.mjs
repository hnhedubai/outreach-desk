// Outbound mail transport for Thread.
//
// Vitalise runs on Render, which blocks outbound SMTP (ports 25/465/587), so the app can
// never talk to an SMTP server directly. Instead it POSTs the composed message over HTTPS
// (port 443) to a tiny relay hosted on the DreamHost account, which performs the actual
// SMTP AUTH submission to smtp.dreamhost.com:587. A reference relay lives in relay/send.php.
//
// Sending is opt-in and safe by default: nothing is transmitted unless BOTH env vars are
// set, so an unconfigured install keeps the previous local-only "Send" behaviour.
//   MAIL_RELAY_URL     the HTTPS endpoint of the relay (e.g. https://bulk.vitalise.io/send.php)
//   MAIL_RELAY_SECRET  a shared secret sent as X-Relay-Key; the relay must reject mismatches

// Normalise a list of recipients to a flat array of trimmed, de-duplicated address strings.
function tidyRecipients(list){
  const out=[];const seen=new Set();
  for(const item of Array.isArray(list)?list:[]){
    const email=String(item&&item.email!==undefined?item.email:item||'').trim();
    if(!email||seen.has(email.toLowerCase()))continue;
    seen.add(email.toLowerCase());out.push(email);
  }
  return out;
}

export function sendConfigured(){
  const url=process.env.MAIL_RELAY_URL, key=process.env.MAIL_RELAY_SECRET;
  return typeof url==='string'&&/^https?:\/\//i.test(url)&&typeof key==='string'&&key.length>0;
}

// message: { from, fromName?, to:[], cc:[], subject, html, text }
// Throws an Error carrying a .status on any failure so the caller can surface it.
export async function sendViaRelay(message){
  const url=process.env.MAIL_RELAY_URL, key=process.env.MAIL_RELAY_SECRET;
  if(!sendConfigured())throw Object.assign(new Error('Mail sending is not configured.'),{status:503});
  const to=tidyRecipients(message.to), cc=tidyRecipients(message.cc);
  if(!to.length)throw Object.assign(new Error('Add at least one recipient.'),{status:400});
  const payload={from:String(message.from||''),fromName:String(message.fromName||''),to,cc,
    subject:String(message.subject||''),html:String(message.html||''),text:String(message.text||'')};
  // The app already holds the mailbox login (it uses the same credential for IMAP), so pass it to
  // the relay per-request over HTTPS instead of storing it on the relay host. Included only when
  // present, so an unconfigured install (or a test that seeds no password) sends no credential fields.
  const smtpUser=String(message.smtpUser||''), smtpPass=String(message.smtpPass||'');
  if(smtpUser)payload.smtp_user=smtpUser;
  if(smtpPass)payload.smtp_pass=smtpPass;
  let response;
  try{
    response=await fetch(url,{method:'POST',
      headers:{'content-type':'application/json','x-relay-key':key},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(30_000)});
  }catch(error){
    if(error&&error.name==='TimeoutError')throw Object.assign(new Error('The mail relay timed out.'),{status:504});
    throw Object.assign(new Error('The mail relay is unreachable.'),{status:502});
  }
  const text=await response.text().catch(()=>'');
  if(!response.ok){
    let detail='';try{detail=String(JSON.parse(text).error||'').slice(0,200);}catch{/* non-JSON body */}
    throw Object.assign(new Error('The mail relay rejected the message.'+(detail?' '+detail:'')),{status:502});
  }
  return true;
}
