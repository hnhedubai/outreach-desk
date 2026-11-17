// Dependency-free, DOM-free HTML sanitizer for stored message bodies.
// Imported by BOTH the browser (live editor preview) and model.mjs (authoritative store),
// so the client is never trusted to make content safe. CSP is script-src 'self', so a
// stored body must never carry script, event handlers, or unsafe URLs.
//
// Strategy: tokenise the markup, keep only an allowlist of formatting tags, drop every
// attribute except a strict safe href, and drop <script>/<style> content entirely.
// Text runs cannot contain '<' (the tokenizer splits on it), so they cannot open a tag;
// we still escape '>' and leave existing entities (&amp; etc.) untouched to avoid
// double-encoding what the editor produced.

const ALLOW=new Set(['p','br','hr','b','strong','i','em','u','s','strike','a','ul','ol','li',
  'blockquote','span','code','pre','div','h1','h2','h3',
  'table','thead','tbody','tfoot','tr','td','th','caption','font']);
// hr is emitted by the server when quoting a forwarded message (model.mjs thread-forward),
// so it must be both allowed and void — otherwise it is dropped and the stack flush appends
// a stray closing tag.
const VOID=new Set(['br','hr']);
const DROP_CONTENT=new Set(['script','style']);
const SAFE_HREF=/^(?:https?:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+)$/i;
// Scheme allowlist is not enough: an http/https link to localhost or a private/loopback
// host can point a recipient at the local app itself or probe the LAN. Block those hosts
// while leaving any public domain (and mailto) intact. Matched against the lowercased host.
const PRIVATE_HOST=/(^|\.)(localhost|internal|local\.test|home\.test|localhost\.localdomain)$|\.local$/;
const PRIVATE_IP=/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)|^(fc|fd)[0-9a-f]{2}:|^[0-9a-f:]*:(1|:)$|^::ffff:(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/i;
// authority = the part after scheme:// and before the first / ? #. The host is after any
// userinfo (last '@') and, for IPv6, inside brackets with the port outside them.
function hostOfAuthority(authority){
  const at=authority.lastIndexOf('@');
  const hostport=at>=0?authority.slice(at+1):authority;
  if(hostport.startsWith('[')){
    const close=hostport.indexOf(']');
    return close>=0?hostport.slice(1,close):hostport;
  }
  const colon=hostport.indexOf(':');
  return colon>=0?hostport.slice(0,colon):hostport;
}
function httpHostPrivate(value){
  const m=/^https?:\/\/([^\s"'<>]*)/i.exec(value);
  if(!m)return false;
  const authority=String(m[1]).split(/[/?#]/)[0];
  const host=hostOfAuthority(authority).toLowerCase().replace(/\.+$/,'');
  if(!host)return true;
  return PRIVATE_HOST.test(host)||PRIVATE_IP.test(host);
}
// Inline formatting styles the compose toolbar can produce. Only these properties survive,
// and only when their value carries none of the risky tokens below (url(), expression(),
// @import, behavior, protocol schemes, angle brackets). Everything else is dropped.
const SAFE_STYLE=new Set(['color','background-color','font-family','font-size','font-weight',
  'font-style','text-decoration','text-align']);
const RISKY_STYLE=/(url\s*\(|expression\s*\(|javascript:|vbscript:|data:|@|<|>|behavior)/i;
// Cells may carry colspan/rowspan; sanitised to a small positive integer.
const SPAN_TAGS=new Set(['td','th','table']);
// Chromium's execCommand('fontSize') emits legacy <font size="1..7"> even with
// styleWithCSS on. We keep the tag but translate the size into a safe inline font-size,
// so the editor's Size control survives the round-trip instead of being stripped.
const FONT_SIZE={1:'8pt',2:'10pt',3:'12pt',4:'14pt',5:'18pt',6:'24pt',7:'36pt'};

const escapeText=text=>text.replace(/>/g,'&gt;');

function hrefOf(rawAttrs){
  const match=/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(rawAttrs||'');
  if(!match)return '';
  const value=(match[1]??match[2]??match[3]??'').trim();
  return SAFE_HREF.test(value)&&!httpHostPrivate(value)?value.replace(/"/g,'&quot;'):'';
}

// Validate a URL the client is about to insert directly into the editor (createLink) or use
// as an href, applying the same scheme allowlist and private-host block the stored-body
// sanitizer enforces. Returns the trimmed value only when its protocol is safe and its host
// is not localhost/private, otherwise ''. The live editor's innerHTML
// is only run through sanitizeHtml on save, so without this gate a javascript:/data: URL typed
// into the link prompt would sit in the contenteditable — and the autosaved draft — clickable
// in-session before the save-time sanitizer ever strips it (self-XSS).
export function safeHref(raw){
  const value=String(raw??'').trim();
  return SAFE_HREF.test(value)&&!httpHostPrivate(value)?value:'';
}

// Keep only whitelisted CSS declarations with safe values; return a re-serialised
// style="..." value (without the attribute wrapper), or '' if nothing qualifies.
function styleOf(rawAttrs){
  const match=/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(rawAttrs||'');
  if(!match)return '';
  const raw=(match[1]??match[2]??'');
  const kept=[];
  for(const decl of raw.split(';')){
    const colon=decl.indexOf(':');if(colon<0)continue;
    const prop=decl.slice(0,colon).trim().toLowerCase();
    const value=decl.slice(colon+1).trim();
    if(!SAFE_STYLE.has(prop)||!value||RISKY_STYLE.test(value))continue;
    kept.push(prop+':'+value.replace(/["'<>]/g,''));
  }
  return kept.join(';');
}

function intOf(rawAttrs,name){
  const match=new RegExp('\\b'+name+'\\s*=\\s*(?:"(\\d+)"|\'(\\d+)\'|(\\d+))','i').exec(rawAttrs||'');
  if(!match)return '';
  const n=Number((match[1]??match[2]??match[3]??''));
  return (n>=1&&n<=50)?String(n):'';
}

export function sanitizeHtml(input){
  const html=String(input??'');
  const stack=[];let out='';let dropTag='';let dropDepth=0;
  const tokens=html.match(/<!--[\s\S]*?-->|<![^>]*>|<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>?|[^<]+/g)||[];
  for(const token of tokens){
    if(dropTag){
      // Inside a dropped element: track nesting, only honour its own closing tag.
      const close=/^<\/([a-zA-Z][a-zA-Z0-9]*)/i.exec(token);
      const open=/^<([a-zA-Z][a-zA-Z0-9]*)/i.exec(token);
      if(open&&open[1].toLowerCase()===dropTag)dropDepth++;
      else if(close&&close[1].toLowerCase()===dropTag){if(dropDepth===0){dropTag='';}else dropDepth--;}
      continue;
    }
    if(token.startsWith('<!--')||token.startsWith('<!'))continue;      // comments/doctype
    if(token[0]!=='<'){out+=escapeText(token);continue;}               // text run
    const closing=/^<\//.test(token);
    const nameMatch=/^<\/?([a-zA-Z][a-zA-Z0-9]*)/i.exec(token);
    if(!nameMatch)continue;                                            // stray '<'
    const name=nameMatch[1].toLowerCase();
    if(DROP_CONTENT.has(name)){if(!closing){dropTag=name;dropDepth=0;}continue;}
    if(!ALLOW.has(name))continue;                                      // disallowed tag: keep its text
    if(closing){
      if(VOID.has(name))continue;
      const index=stack.lastIndexOf(name);
      if(index<0)continue;
      while(stack.length>index){const openTag=stack.pop();out+='</'+openTag+'>';}
      continue;
    }
    if(VOID.has(name)){out+='<'+name+'>';continue;}
    if(name==='a'){
      const href=hrefOf(token);
      out+=href?'<a href="'+href+'">':'<a>';
    }else{
      let attrs='';
      let style=styleOf(token);
      if(name==='font'){
        const px=FONT_SIZE[intOf(token,'size')];
        if(px&&!/font-size/.test(style))style=(style?style+';':'')+'font-size:'+px;
      }
      if(style)attrs+=' style="'+style+'"';
      if(SPAN_TAGS.has(name)){
        const cs=intOf(token,'colspan');if(cs)attrs+=' colspan="'+cs+'"';
        const rs=intOf(token,'rowspan');if(rs)attrs+=' rowspan="'+rs+'"';
      }
      out+='<'+name+attrs+'>';
    }
    stack.push(name);
  }
  while(stack.length)out+='</'+stack.pop()+'>';
  return out;
}

// Plain-text projection for list snippets, search indexing and notifications.
export function htmlToText(html){
  const safe=sanitizeHtml(html)
    .replace(/<\/(p|div|li|h[1-3]|blockquote|pre|tr)>/gi,'\n')
    .replace(/<\/(td|th)>/gi,'\t')
    .replace(/<br\s*\/?>/gi,'\n')
    .replace(/<hr\s*\/?>/gi,'\n')
    .replace(/<[^>]+>/g,'');
  return safe
    .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<')
    .replace(/&gt;/gi,'>').replace(/&quot;/gi,'"')
    .replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
}
