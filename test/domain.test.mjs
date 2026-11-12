import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifyDnsMx} from '../domain.mjs';

test('valid when an MX answer record is present',()=>{
  const r=classifyDnsMx({Status:0,Answer:[{name:'a.com.',type:15,data:'10 mx.a.com.'}]});
  assert.equal(r.status,'valid');assert.equal(r.mx,1);
});
test('no_mx when domain resolves (NOERROR) but has no MX record',()=>{
  const r=classifyDnsMx({Status:0,Answer:[{name:'a.com.',type:1,data:'1.2.3.4'}]});
  assert.equal(r.status,'no_mx');assert.equal(r.mx,0);
});
test('no_mx when NOERROR has no Answer section at all',()=>{
  assert.equal(classifyDnsMx({Status:0}).status,'no_mx');
});
test('not_found on NXDOMAIN (Status 3)',()=>{
  assert.equal(classifyDnsMx({Status:3}).status,'not_found');
});
test('error on non-zero non-NXDOMAIN status',()=>{
  assert.equal(classifyDnsMx({Status:2}).status,'error');
});
test('error on null / non-object response',()=>{
  assert.equal(classifyDnsMx(null).status,'error');
  assert.equal(classifyDnsMx('nope').status,'error');
});
