// Structural cleanup for INBOUND email HTML.
//
// Marketing and Gmail messages arrive as deeply nested layout tables
// (<table><tbody><tr><td><table>…) wrapped in empty <div>/<span>/<u> containers and
// presentational inline styles (font-family:Roboto, color:#3C4043, …). The security
// sanitizer (sanitize.js) keeps <table>/<td> and a few style props, so that mess is stored
// verbatim — bloating the document and rendering oddly in Thread.
//
// This flattens the LAYOUT back to readable flow before sanitising:
//   • drop non-content blocks/voids (style/head/script/title/meta/link) and comments;
//   • strip presentational attributes (style/align/width/height/cellpadding/…);
//   • collapse table scaffolding: rows → line breaks, cells → spaces (cell TEXT is kept);
//   • <div> boundaries → line breaks; unwrap inline containers (span/u/font/…) keeping text;
//   • collapse repeated whitespace.
// Semantic formatting that matters (p, h1-3, ul/ol/li, blockquote, a, strong/em, code) is
// preserved. The result is run through sanitizeHtml so the CSP script-src 'self' guarantee
// still holds (no script, no event handlers, no unsafe URLs).

import {sanitizeHtml} from './public/sanitize.js';

const DROP_CONTENT=/<(style|head|script|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const DROP_VOID=/<\/?(?:meta|link|base)\b[^>]*\/?>/gi;
const COMMENTS=/(<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>)/gi;
const PRESENTATIONAL=/\s+(?:style|align|valign|width|height|cellpadding|cellspacing|border|bgcolor|class|id|role|dir|lang|hspace|vspace|nowrap|background)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const INLINE_UNWRAP=/<\/?(?:span|u|font|nobr|bdi|center|section|article|aside|header|footer|main|nav|figure|figcaption|body|html|colgroup|col)\b[^>]*>/gi;

function flattenTables(html){
  return html
    .replace(/<tr\b[^>]*>/gi,'')
    .replace(/<\/tr>/gi,'\n')
    .replace(/<t[dh]\b[^>]*>/gi,'')
    .replace(/<\/t[dh]>/gi,' ')
    .replace(/<\/?(?:table|tbody|thead|tfoot)\b[^>]*>/gi,'');
}

function divToBreaks(html){
  return html
    .replace(/<div\b[^>]*>/gi,'')
    .replace(/<\/div>/gi,'\n');
}

function collapseWhitespace(html){
  return html
    .replace(/[ \t]+/g,' ')
    .replace(/ ?\n ?/g,'\n')
    .replace(/\n{3,}/g,'\n\n')
    .replace(/^[\n ]+|[\n ]+$/g,'');
}

export function normalizeInboundHtml(raw){
  const text=String(raw??'');
  if(!/<\w/.test(text))return sanitizeHtml(text); // no markup → leave to the text path
  let html=text
    .replace(DROP_CONTENT,'')
    .replace(DROP_VOID,'')
    .replace(COMMENTS,'')
    .replace(PRESENTATIONAL,'');
  html=flattenTables(html);
  html=divToBreaks(html);
  html=html.replace(INLINE_UNWRAP,'');
  // Convert the newlines produced by rows/divs into <br> so sanitizeHtml keeps the breaks.
  html=html.replace(/\n/g,'<br>');
  html=html.replace(/[ \t]+/g,' ').replace(/ ?<br> ?/g,'<br>').replace(/(?:<br>){2,}/g,'<br>');
  html=html.replace(/^(?:<br>|\s)+|(?:<br>|\s)+$/gi,'');
  return sanitizeHtml(html).replace(/^(?:<br>|\s)+|(?:<br>|\s)+$/gi,'');
}
