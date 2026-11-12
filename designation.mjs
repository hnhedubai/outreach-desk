// Standard designation convention — collapses free-text job titles into a compact
// tiered vocabulary (CODE [+ " · function"]). Raw title is always preserved separately.
// Precedence picks ONE primary role from multi-role titles; exotic "Chief X Officer"
// collapse to CXO · <function>; "Director" is disambiguated BOARD vs MD vs DIR.

const SPECIFIC=[
  ['CHAIR', /\bchair(?:man|woman|person|of the board|,? the board)\b/i],
  ['CEO',   /\bchief executive\b|\bceo\b/i],
  ['CFO',   /\bchief financial\b|\bcfo\b/i],
  ['COO',   /\bchief operating\b|\bcoo\b/i],
  ['CTO',   /\bchief technolog|\bchief technical\b|\bcto\b/i],
  ['CMO',   /\bchief marketing\b|\bcmo\b/i],
  ['CPO',   /\bchief product\b|\bcpo\b/i],
  ['CHRO',  /\bchief human resources\b|\bchro\b|\bchief people\b/i],
  ['CISO',  /\bchief information security\b|\bciso\b/i],
  ['CRO',   /\bchief risk\b|\bchief revenue\b|\bcro\b/i],
  ['CCO',   /\bchief commercial\b|\bchief customer\b|\bccmo?\b/i],
  ['CBO',   /\bchief business officer\b|\bcbo\b/i],
  ['PRES',  /\bpresident\b/i],
  ['MD',    /\bmanaging director\b/i],
  ['BOARD', /\bboard member\b|\bmember of the board\b|\bon the board\b|\bnon-?executive director\b|\bboard of directors\b/i],
  ['VP',    /\bvice president\b|\bvp\b/i],
  ['DIR',   /\bdirector\b/i],
  ['HEAD',  /\bhead of\b|\bhead,\s|\bhead\s+\w+\s+of\b/i],
  ['PM',    /\bproject manager\b/i],
  ['BDM',   /\bbusiness development manager\b|\bbdm\b|\bbd (?:manager|lead|director)\b/i],
];

// function-qualifier abbreviations (extend as needed)
const FUNC_ABBREV={ 'project management':'PM' };

const trim=s=>(s||'').replace(/\s+/g,' ').trim();

function functionOf(raw, code){
  // generic chief → the words between "chief" and "officer"
  if(code==='CXO'){
    const m=raw.match(/chief\s+(.+?)\s+officer/i);
    return m?trim(m[1]):'';
  }
  // specific chief with a trailing scope word after "officer" (e.g. "…Officer Electrolyser")
  if(/^(CEO|CFO|COO|CTO|CMO|CPO|CHRO|CISO|CRO|CCO|CBO)$/.test(code)){
    const m=raw.match(/officer\s+([a-zÀ-ÿ][a-zÀ-ÿ ]{2,40}?)(?:[;,]|$)/i);
    return m?trim(m[1]):'';
  }
  // functional roles → "of <x>"
  const of=raw.match(/\bof\s+([a-zÀ-ÿ][a-zÀ-ÿ ,&]{2,40}?)(?:[;,(]|$)/i);
  if(of&&['DIR','HEAD','VP'].includes(code)) return trim(of[1]);
  return '';
}

export function normalizeDesignation(raw){
  const t=trim(raw);
  if(!t) return {code:'OTHER', label:'—'};
  let code='OTHER';
  for(const [c,re] of SPECIFIC){ if(re.test(t)){ code=c; break; } }
  if(code==='OTHER'){
    const generic=t.match(/chief\s+.+?\s+officer/i);
    if(generic) code='CXO';
  }
  let fn=functionOf(t, code);
  if(FUNC_ABBREV[fn.toLowerCase()]) fn=FUNC_ABBREV[fn.toLowerCase()];
  const label = (code==='OTHER'||!fn) ? code : `${code} · ${fn}`;
  return {code, label, raw:t};
}
