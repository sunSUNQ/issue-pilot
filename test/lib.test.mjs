import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { labelsOf, mintAppToken, parseArgs, slugify, tokenState } from '../scripts/lib.mjs';

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

test('tokenState passes through outside enforced sessions', () => {
  const state = tokenState({}, 0);
  assert.equal(state.enforced, false);
  assert.equal(state.action, 'passthrough');
});

test('tokenState fails closed when enforced session lacks pinned identity', () => {
  const state = tokenState({ PL_ENFORCE_APP: '1', PL_APP_ID: '5394867' }, 0);
  assert.equal(state.action, 'fail');
  assert.match(state.reason, /PL_APP_(INSTALLATION_)?ID|PL_APP_KEY_PATH/);
});

test('tokenState renews when GH_TOKEN is absent', () => {
  const env = {
    PL_ENFORCE_APP: '1', PL_APP_ID: '1', PL_APP_INSTALLATION_ID: '2', PL_APP_KEY_PATH: 'pem',
  };
  assert.equal(tokenState(env, 0).action, 'renew');
});

test('tokenState renews on missing or malformed PL_TOKEN_EXPIRES_AT', () => {
  const base = { PL_ENFORCE_APP: '1', PL_APP_ID: '1', PL_APP_INSTALLATION_ID: '2', PL_APP_KEY_PATH: 'pem', GH_TOKEN: 'tok' };
  assert.equal(tokenState({ ...base }, 0).action, 'renew');
  assert.equal(tokenState({ ...base, PL_TOKEN_EXPIRES_AT: 'not-a-date' }, 0).action, 'renew');
});

test('tokenState renews inside the renewal margin and is ok outside it', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  const base = { PL_ENFORCE_APP: '1', PL_APP_ID: '1', PL_APP_INSTALLATION_ID: '2', PL_APP_KEY_PATH: 'pem', GH_TOKEN: 'tok' };
  assert.equal(tokenState({ ...base, PL_TOKEN_EXPIRES_AT: new Date(now + 9 * 60 * 1000).toISOString() }, now).action, 'renew');
  const outside = tokenState({ ...base, PL_TOKEN_EXPIRES_AT: new Date(now + 11 * 60 * 1000).toISOString() }, now);
  assert.equal(outside.action, 'ok');
});

test('mintAppToken fails closed without emitting any token when identity is unpinned', () => {
  const minted = mintAppToken({});
  assert.equal(minted.ok, false);
  assert.match(minted.reason, /PL_TOKEN_FAIL/);
  assert.equal(minted.env, undefined);
});

test('control plane keeps no silent OAuth fallback path (R16)', async () => {
  const source = await readFile(new URL('../scripts/lib.mjs', import.meta.url), 'utf8');
  assert.ok(!source.includes('credential fill'), 'git credential fill fallback must stay removed');
  assert.ok(!source.includes('parseGitCredential'), 'credential parsing helper must stay removed');
});
