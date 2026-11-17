// Locks the HTML sanitizer used for stored message bodies (public/sanitize.js).
// The client is never trusted: model.mjs calls this authoritatively before saving.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeHtml,htmlToText,safeHref} from '../public/sanitize.js';

test('drops script and style elements with their content', ()=>{
  assert.equal(sanitizeHtml('<p>a</p><script>alert(1)</script>'), '<p>a</p>');
  assert.equal(sanitizeHtml('<style>body{}</style>keep'), 'keep');
});

test('removes event handlers and disallowed tags', ()=>{
  assert.equal(sanitizeHtml('<p onclick="evil()">hi</p>'), '<p>hi</p>');
  assert.equal(sanitizeHtml('<img src=x onerror=alert(1)>'), '');
  assert.equal(sanitizeHtml('<iframe src="https://evil"></iframe>text'), 'text');
});

test('keeps only safe link protocols', ()=>{
  assert.equal(sanitizeHtml('<a href="https://ok.com/p">x</a>'), '<a href="https://ok.com/p">x</a>');
  assert.equal(sanitizeHtml('<a href="mailto:me@x.com">x</a>'), '<a href="mailto:me@x.com">x</a>');
  assert.equal(sanitizeHtml('<a href="javascript:alert(1)">x</a>'), '<a>x</a>');
  assert.equal(sanitizeHtml('<a href="&#106;avascript:alert(1)">x</a>'), '<a>x</a>', 'entity-encoded javascript: must not pass');
  assert.equal(sanitizeHtml('<a href="data:text/html,x">x</a>'), '<a>x</a>');
});

test('preserves formatting tags and balances unclosed ones', ()=>{
  assert.equal(sanitizeHtml('<b>bold</b> <i>it</i> <u>u</u>'), '<b>bold</b> <i>it</i> <u>u</u>');
  assert.equal(sanitizeHtml('<ul><li>a</li><li>b</li></ul>'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(sanitizeHtml('<b>unclosed'), '<b>unclosed</b>');
  assert.equal(sanitizeHtml('<u>a</u></i>b'), '<u>a</u>b', 'stray closer ignored');
});

test('does not double-encode existing entities', ()=>{
  assert.equal(sanitizeHtml('<p>a &amp; b</p>'), '<p>a &amp; b</p>');
});

test('keeps hr as a void separator without a stray closer', ()=>{
  // model.mjs thread-forward builds sanitizeHtml(body)+'<hr>'+quote; the separator must survive.
  assert.equal(sanitizeHtml('note<hr>quote'), 'note<hr>quote');
  assert.equal(sanitizeHtml('<hr>'), '<hr>');
  assert.ok(!sanitizeHtml('a<hr>b').includes('</hr>'), 'no stray closing tag');
  assert.equal(htmlToText('a<hr>b'), 'a\nb');
});

test('preserves editor font size as an inline style', ()=>{
  // execCommand('fontSize') emits legacy <font size>; it must survive, mapped to font-size.
  assert.equal(sanitizeHtml('<font size="5">big</font>'), '<font style="font-size:18pt">big</font>');
  assert.equal(sanitizeHtml('<font size="3">x</font>'), '<font style="font-size:12pt">x</font>');
  assert.equal(sanitizeHtml('<font>plain</font>'), '<font>plain</font>', 'no size, no style');
  assert.ok(!/<font[^>]*size=/.test(sanitizeHtml('<font size="9">x</font>')), 'raw size attr never emitted');
});

test('htmlToText strips markup into a plain snippet', ()=>{
  assert.equal(htmlToText('<p>Hello <b>world</b><br>line2 &amp; more</p>'), 'Hello world\nline2 & more');
  assert.equal(htmlToText('<script>bad()</script>only'), 'only');
});

test('safeHref gates createLink insertion against the same allowlist (self-XSS)', ()=>{
  // The compose/signature toolbars feed the link prompt straight into execCommand('createLink');
  // the live editor is only sanitised on save, so the insertion itself must reject unsafe schemes.
  assert.equal(safeHref('https://ok.com/p'), 'https://ok.com/p');
  assert.equal(safeHref('http://ok.com'), 'http://ok.com');
  assert.equal(safeHref('mailto:me@x.com'), 'mailto:me@x.com');
  assert.equal(safeHref('  https://spaced.com  '), 'https://spaced.com', 'trims surrounding space');
  assert.equal(safeHref('javascript:alert(1)'), '', 'javascript: must never insert');
  assert.equal(safeHref('JaVaScRiPt:alert(1)'), '', 'scheme match is case-insensitive');
  assert.equal(safeHref('data:text/html,x'), '', 'data: rejected');
  assert.equal(safeHref('vbscript:msgbox'), '', 'vbscript: rejected');
  assert.equal(safeHref('example.com'), '', 'scheme-less is not a safe absolute link');
  assert.equal(safeHref(''), '', 'empty rejected');
  assert.equal(safeHref(null), '', 'null rejected');
});

test('blocks localhost and private/loopback hosts, keeps public domains and mailto', ()=>{
  // Public http/https hosts still pass.
  assert.equal(safeHref('https://ok.com/p'), 'https://ok.com/p');
  assert.equal(safeHref('http://203.0.113.9/path'), 'http://203.0.113.9/path', 'public IP allowed');
  assert.equal(safeHref('mailto:me@127.0.0.1'), 'mailto:me@127.0.0.1', 'mailto has no host to block');
  // localhost / special-use / mDNS / .test names are rejected.
  for(const u of ['http://localhost:8282/api','https://localhost/x','http://LOCALHOST./','https://app.local/x',
    'http://foo.internal/y','https://x.local.test/z','https://h.home.test/p'])
    assert.equal(safeHref(u), '', u+' must be blocked');
  // Loopback / private / link-local IPv4 and IPv6 are rejected.
  for(const u of ['http://127.0.0.1/','https://127.1/x','http://10.1.2.3/','http://192.168.0.5/',
    'http://172.16.0.1/','http://172.31.255.255/','http://169.254.1.1/','http://0.0.0.0/',
    'http://[::1]/','http://[::]/','http://[fd00::5]/','http://[fc00::1]/','http://[::ffff:127.0.0.1]/'])
    assert.equal(safeHref(u), '', u+' must be blocked');
  // Public 172.x outside 16-31 and a userinfo-decoy to a public host are allowed.
  assert.equal(safeHref('http://172.32.1.1/'), 'http://172.32.1.1/', '172.32 is public');
  assert.equal(safeHref('https://evil.com/x'), 'https://evil.com/x');
  // The stored-body sanitizer enforces the same rule.
  assert.equal(sanitizeHtml('<a href="http://127.0.0.1:8282/">x</a>'), '<a>x</a>');
  assert.equal(sanitizeHtml('<a href="https://ok.com/">x</a>'), '<a href="https://ok.com/">x</a>');
});
