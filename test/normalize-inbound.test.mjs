import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeInboundHtml} from '../normalize-inbound.mjs';

const GMAIL=`<div>
  <table><tr><td>
    <table style="text-align:left"><tbody><tr><td>
      <p style="color:#3C4043;font-family:Roboto">Hello there, welcome to our product</p>
      <a href="https://example.com/go">Read more</a>
      <img src="https://example.com/x.png">
    </td></tr></tbody></table>
  </td></tr></table>
</div>`;

test('flattens nested layout tables and drops presentational styles',()=>{
  const out=normalizeInboundHtml(GMAIL);
  assert.ok(!/<table|<tr|<td|<th|<tbody/i.test(out),'no table scaffolding remains');
  assert.ok(!/style=/i.test(out),'no inline style attributes');
  assert.ok(out.includes('Hello there, welcome to our product'),'body text preserved');
  assert.ok(out.includes('<a href="https://example.com/go">Read more</a>'),'link preserved');
  assert.ok(out.length<GMAIL.length,'output is smaller than input');
});

test('keeps semantic formatting (p, lists, headings, emphasis)',()=>{
  const out=normalizeInboundHtml('<p>Intro</p><ul><li>One</li><li>Two</li></ul><h3>Head</h3><strong>bold</strong>');
  assert.ok(/<p>Intro<\/p>/.test(out));
  assert.ok(/<li>One<\/li>/.test(out)&&/<li>Two<\/li>/.test(out));
  assert.ok(/<h3>Head<\/h3>/.test(out));
  assert.ok(/<strong>bold<\/strong>/.test(out));
});

test('enforces the sanitizer allowlist on inbound (CSP-safe)',()=>{
  const out=normalizeInboundHtml('<p>Hi</p><script>steal()</script><a href="javascript:alert(1)">x</a><img src="y.png"><b onclick="evil()">bold</b>');
  assert.ok(!/script/i.test(out),'no script');
  assert.ok(!/javascript:/i.test(out),'no javascript: url');
  assert.ok(!/onclick/i.test(out),'no event handler');
  assert.ok(!/<img/i.test(out),'images dropped by allowlist');
  assert.ok(/<b>bold<\/b>/.test(out),'inline formatting kept, attribute stripped');
});

test('plain text without markup is passed through, not mangled',()=>{
  assert.equal(normalizeInboundHtml('Just a line of text'),'Just a line of text');
  assert.equal(normalizeInboundHtml(''),'');
});

test('div-based line structure becomes breaks, not run-on text',()=>{
  const out=normalizeInboundHtml('<div>Line one</div><div>Line two</div>');
  assert.ok(/Line one/.test(out)&&/Line two/.test(out));
  assert.ok(out.includes('<br>'),'div boundaries become <br>');
});
