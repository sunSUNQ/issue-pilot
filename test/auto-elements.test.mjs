import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTO_ELEMENTS, missingAutoElements } from '../scripts/lib.mjs';

test('AUTO_ELEMENTS keeps the five canonical elements', () => {
  assert.deepEqual(
    AUTO_ELEMENTS,
    ['观察证据', '期望行为', '反例或失败条件', '允许修改范围', '验收方式'],
  );
});

test('canonical 反例或失败条件 spelling satisfies all five elements', () => {
  const body = [
    '## 观察证据',
    'x',
    '## 期望行为',
    'x',
    '## 反例或失败条件',
    'x',
    '## 允许修改范围',
    'x',
    '## 验收方式',
    'x',
  ].join('\n');
  assert.deepEqual(missingAutoElements(body), []);
});

test('alternate 反例与失败条件 spelling satisfies all five elements', () => {
  const body = [
    '## 观察证据',
    '## 期望行为',
    '## 反例与失败条件',
    '## 允许修改范围',
    '## 验收方式',
  ].join('\n');
  assert.deepEqual(missingAutoElements(body), []);
});

test('missing a non-counterexample element is still rejected', () => {
  const body = [
    '## 观察证据',
    '## 期望行为',
    '## 反例与失败条件',
    '## 允许修改范围',
  ].join('\n');
  assert.deepEqual(missingAutoElements(body), ['验收方式']);
});

test('missing the counterexample element entirely is rejected', () => {
  const body = [
    '## 观察证据',
    '## 期望行为',
    '## 允许修改范围',
    '## 验收方式',
  ].join('\n');
  assert.deepEqual(missingAutoElements(body), ['反例或失败条件']);
});

test('null body reports every element missing', () => {
  assert.deepEqual(missingAutoElements(null), [...AUTO_ELEMENTS]);
});
