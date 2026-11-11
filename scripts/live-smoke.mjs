// Live provider smoke test — proves each configured API key is valid and reachable.
// Run locally from outreach-desk with:
//   node --env-file-if-exists=.env scripts/live-smoke.mjs
//
// WARNING: Node's --env-file does NOT override variables that already exist in the
// process environment. A stale user-scope key silently shadows the .env value, which
// produces an auth failure that looks like a dead credential but is not. Clear any
// ambient provider variables before trusting a FAIL.
//
// Every endpoint, auth header and response shape below is copied from a call this
// application already makes. Do not add a probe that is not already proven in the app.

const timeoutMs = 15000;

const configured = name => typeof process.env[name] === 'string' && process.env[name].trim() !== '';
const okStatus = status => status >= 200 && status < 300;

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs)
  });
  // Read once, then parse. A parse failure is reported as unexpected-shape, never as auth.
  const text = await response.text();
  let body = null, malformed = false;
  try { body = JSON.parse(text); } catch { malformed = true; }
  return {response, body, malformed};
}

// Coarse, safe reasons. Never include key material or response bodies.
function classify({response, body, malformed}, shapeOk) {
  if(response.status === 401 || response.status === 403) return {pass: false, reason: 'auth'};
  if(!okStatus(response.status)) return {pass: false, reason: `http-${response.status}`};
  if(malformed || !shapeOk(body)) return {pass: false, reason: 'unexpected-shape'};
  return {pass: true, reason: ''};
}

const missingKey = () => ({pass: false, reason: 'missing-key'});

// Billable: performs a real search. Matches server.mjs:164.
async function checkExa() {
  if(!configured('EXA_API_KEY')) return missingKey();
  const r = await request('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.EXA_API_KEY.trim(),
      'content-type': 'application/json'
    },
    body: JSON.stringify({query: 'site:example.com', numResults: 1})
  });
  return classify(r, body => Array.isArray(body?.results));
}

// Free. Matches firecrawl.mjs:40.
async function checkFirecrawl() {
  if(!configured('FIRECRAWL_API_KEY')) return missingKey();
  const r = await request('https://api.firecrawl.dev/v2/team/credit-usage', {
    headers: {authorization: 'Bearer '+process.env.FIRECRAWL_API_KEY.trim()}
  });
  const shapeOk = body => body?.success === true && Number.isFinite(body?.data?.remainingCredits);
  const result = classify(r, shapeOk);
  if(result.pass && r.body.data.remainingCredits < 105) return {pass: false, reason: 'low-credits'};
  return result;
}

// Billable: performs a real search. Matches research-providers.mjs:72-73.
// The previous version probed GET /models, which returns HTTP 404 — that endpoint
// does not exist on this API.
async function checkPerplexity() {
  if(!configured('PERPLEXITY_API_KEY')) return missingKey();
  const r = await request('https://api.perplexity.ai/search', {
    method: 'POST',
    headers: {
      authorization: 'Bearer '+process.env.PERPLEXITY_API_KEY.trim(),
      'content-type': 'application/json'
    },
    body: JSON.stringify({query: 'example', max_results: 1, max_tokens_per_page: 32})
  });
  return classify(r, body => Array.isArray(body?.results));
}

// Free. Matches research-providers.mjs:85-89, including the app's own 4-credit floor.
async function checkLimaData() {
  if(!configured('LIMADATA_API_KEY')) return missingKey();
  const r = await request('https://api.limadata.com/api/v1/credits/balance', {
    headers: {'x-api-key': process.env.LIMADATA_API_KEY.trim()}
  });
  const result = classify(r, body => Number.isFinite(body?.balance));
  if(result.pass && r.body.balance < 4) return {pass: false, reason: 'low-credits'};
  return result;
}

// Free. TYPESAFE_MODEL is optional config, not a secret: jev.mjs:73 falls back to
// 'jev-latest' when it is unset, so an unset value must not fail this check.
async function checkTypeSafe() {
  if(!configured('TYPESAFE_API_KEY')) return missingKey();
  const model = process.env.TYPESAFE_MODEL?.trim() || 'jev-latest';
  const r = await request('https://api.typesafe.ai/v1/models', {
    headers: {authorization: 'Bearer '+process.env.TYPESAFE_API_KEY.trim()}
  });
  const result = classify(r, body => Array.isArray(body?.models));
  if(result.pass && !r.body.models.some(m => m?.name === model)) {
    return {pass: false, reason: 'unknown-model'};
  }
  return result;
}

const checks = [
  ['EXA', checkExa, true],
  ['Firecrawl', checkFirecrawl, false],
  ['Perplexity', checkPerplexity, true],
  ['LimaData', checkLimaData, false],
  ['TypeSafe', checkTypeSafe, false]
];

console.log(`TLS certificate verification: ${process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ? 'DISABLED (untrusted run)' : 'active'}`);

let failed = false;
for(const [name, check, billable] of checks){
  let outcome;
  try { outcome = await check(); }
  catch (error) { outcome = {pass: false, reason: error?.name === 'TimeoutError' ? 'timeout' : 'network'}; }
  if(!outcome.pass) failed = true;
  const tag = billable ? ' (billable)' : '';
  const detail = outcome.pass ? '' : ` [${outcome.reason}]`;
  console.log(`${name}: ${outcome.pass ? 'PASS' : 'FAIL'}${tag}${detail}`);
}

if(failed) process.exitCode = 1;
