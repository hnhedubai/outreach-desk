// Locks the HTML sanitizer used for stored message bodies (public/sanitize.js).
// The client is never trusted: model.mjs calls this authoritatively before saving.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeHtml,htmlToText} from '../public/sanitize.js';

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

test('htmlToText strips markup into a plain snippet', ()=>{
  assert.equal(htmlToText('<p>Hello <b>world</b><br>line2 &amp; more</p>'), 'Hello world\nline2 & more');
  assert.equal(htmlToText('<script>bad()</script>only'), 'only');
});
