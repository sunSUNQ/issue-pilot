import assert from 'node:assert/strict';
import test from 'node:test';
import { labelsOf, parseArgs, slugify } from '../scripts/lib.mjs';

test('parseArgs separates positionals and flags', () => {
  assert.deepEqual(
    parseArgs(['12', '--verdict', 'lgtm', '--mine']),
    { positionals: ['12'], flags: { verdict: 'lgtm', mine: true } },
  );
});

test('slugify produces bounded branch-safe names', () => {
  assert.equal(slugify('[候选] Fix Parser: ESM + CJS'), 'fix-parser-esm-cjs');
  assert.ok(slugify('a'.repeat(100)).length <= 42);
});

test('labelsOf accepts GitHub label objects', () => {
  assert.deepEqual(labelsOf({ labels: [{ name: 'status:approved' }, { name: 'repo:tasco' }] }), ['status:approved', 'repo:tasco']);
});
