import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDesignation} from '../designation.mjs';

const L=t=>normalizeDesignation(t).label;

test('CEO primary over President',()=>assert.equal(L('Chief Executive Officer (CEO) & President'),'CEO'));
test('CBO keeps trailing scope',()=>assert.equal(L('Chief Business Officer Electrolyser'),'CBO · Electrolyser'));
test('CBO beats Managing Director, captures scope',()=>assert.equal(L('Chief Business Officer Reforming; Managing Director, Metacon GmbH'),'CBO · Reforming'));
test('exotic chief collapses to CXO · function',()=>assert.equal(L('Chief Project Management Officer'),'CXO · PM'));
test('project manager is PM',()=>assert.equal(L('Project Manager'),'PM'));
test('chief customer maps to CCO',()=>assert.equal(L('Chief Customer Solutions Officer'),'CCO'));
test('chairman is governance CHAIR',()=>assert.equal(L('Chairman of the Board'),'CHAIR'));
test('board member is BOARD',()=>assert.equal(L('Board member; Global Head of M&A at Systemair'),'BOARD'));
test('managing director is MD',()=>assert.equal(L('Managing Director'),'MD'));
test('functional director is DIR · function',()=>assert.equal(L('Director of Finance'),'DIR · Finance'));
test('interim CFO still CFO (fixes substring miss)',()=>assert.equal(L('Interim Chief Financial Officer'),'CFO'));
test('head of captures function',()=>assert.equal(L('Head of Human Resources'),'HEAD · Human Resources'));
test('country manager is OTHER',()=>assert.equal(L('Country Manager Sweden'),'OTHER'));
test('empty is dash',()=>assert.equal(L(''),'—'));
