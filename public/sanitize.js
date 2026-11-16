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

const ALLOW=new Set(['p','br','b','strong','i','em','u','s','strike','a','ul','ol','li',
  'blockquote','span','code','pre','div','h1','h2','h3']);
const VOID=new Set(['br']);
const DROP_CONTENT=new Set(['script','style']);
const SAFE_HREF=/^(?:https?:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+)$/i;

const escapeText=text=>text.replace(/>/g,'&gt;');

function hrefOf(rawAttrs){
  const match=/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(rawAttrs||'');
  if(!match)return '';
  const value=(match[1]??match[2]??match[3]??'').trim();
  return SAFE_HREF.test(value)?value.replace(/"/g,'&quot;'):'';
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
    }else out+='<'+name+'>';
    stack.push(name);
  }
  while(stack.length)out+='</'+stack.pop()+'>';
  return out;
}

// Plain-text projection for list snippets, search indexing and notifications.
export function htmlToText(html){
  const safe=sanitizeHtml(html)
    .replace(/<\/(p|div|li|h[1-3]|blockquote|pre)>/gi,'\n')
    .replace(/<br\s*\/?>/gi,'\n')
    .replace(/<[^>]+>/g,'');
  return safe
    .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<')
    .replace(/&gt;/gi,'>').replace(/&quot;/gi,'"')
    .replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
}
