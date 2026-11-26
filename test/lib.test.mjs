import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  appendStateBlock, atomicWriteJson, canonicalJson, encodeStateBlock, extractStateBlocks,
  foldStateEvents, makeStateEnvelope, normalizeBodyForHash, parseStateComments, removeStateBlockLines,
  sha256Hex, stateRebuildSummary, validateStateComment, STATE_SCHEMA,
  assertOwnerIdentity, auditFooter, bindingRecord, controlRepoAlias, controlRepoSubmitRefusal, findPr,
  isApprovedReleaseGateFile, labelsOf, mergeFailureHint, mintAppToken,
  missingRequiredChecks, normalizeGhIdentity, outstandingBlocks, parseArgs, prIdentityViolations, prRepositoryFromUrl,
  repoAliasOf, repoDescriptor, requiredChecksFromRuleset, resolveProposeRepo, planReviewRecord, reviewKey,
  slugify, soloMode, soloScopeAllows, parseSoloScope, tokenState, validReviewerLgtm, verifyLauncherIdentity, writeAudit,
} from '../scripts/lib.mjs';

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

// ---- issue #132: control-repo identity wins over local registration ----
const controlConfig132 = {
  issueRepository: 'sunSUNQ/issue-pilot',
  repositories: {
    'issue-pilot': { path: 'D:/issue-pilot', github: 'sunSUNQ/issue-pilot', base: 'main', policy: 'solo-mode', checks: [] },
    provenlattice: { path: 'D:/pl', github: 'sunSUNQ/provenlattice', base: 'main', policy: 'codegraph', checks: ['npm test'] },
  },
};

test('normalizeGhIdentity trims and lowercases whole owner/repo', () => {
  assert.equal(normalizeGhIdentity(' sunSUNQ/Issue-Pilot '), 'sunsunq/issue-pilot');
  assert.equal(normalizeGhIdentity(null), '');
});

test('repoDescriptor: unregistered control alias still resolves to control repo', () => {
  const config = { issueRepository: 'sunSUNQ/issue-pilot', repositories: { provenlattice: controlConfig132.repositories.provenlattice } };
  const d = repoDescriptor(config, 'issue-pilot');
  assert.equal(d.isControlRepo, true);
  assert.equal(d.github, 'sunSUNQ/issue-pilot');
  assert.equal(d.policy, 'governance-v2');
});

test('repoDescriptor: registered control alias stays control (the #132 bug case)', () => {
  const d = repoDescriptor(controlConfig132, 'issue-pilot');
  assert.equal(d.isControlRepo, true);
  assert.equal(d.github, 'sunSUNQ/issue-pilot');
  assert.equal(d.base, 'main');
  assert.equal(d.policy, 'governance-v2');   // registered 'solo-mode' must NOT win
  assert.deepEqual(d.checks, []);
});

test('repoDescriptor: registered product repo is unchanged', () => {
  const d = repoDescriptor(controlConfig132, 'provenlattice');
  assert.equal(d.isControlRepo, false);
  assert.equal(d.github, 'sunSUNQ/provenlattice');
  assert.equal(d.policy, 'codegraph');
  assert.deepEqual(d.checks, ['npm test']);
});

test('repoDescriptor: unknown alias fails closed', () => {
  assert.throws(() => repoDescriptor(controlConfig132, 'nope'), /未注册仓库 nope/);
});

test('repoDescriptor: identity conflict resolves to control authority', () => {
  const config = {
    issueRepository: 'sunSUNQ/issue-pilot',
    repositories: { ...controlConfig132.repositories, control: { path: 'D:/x', github: 'sunSUNQ/issue-pilot', base: 'dev', policy: 'other', checks: [] } },
  };
  const d = repoDescriptor(config, 'control');
  assert.equal(d.isControlRepo, true);
  assert.equal(d.github, 'sunSUNQ/issue-pilot');
  assert.equal(d.base, 'main');               // registered base 'dev' must NOT win
});

test('repoDescriptor: case/whitespace differences normalize to control', () => {
  const config = {
    issueRepository: 'sunSUNQ/issue-pilot',
    repositories: { ...controlConfig132.repositories, 'weird-alias': { path: 'D:/x', github: ' sunSUNQ/Issue-Pilot ', base: 'main', policy: 'other', checks: [] } },
  };
  const d = repoDescriptor(config, 'weird-alias');
  assert.equal(d.isControlRepo, true);
  const d2 = repoDescriptor(controlConfig132, 'ISSUE-PILOT');
  assert.equal(d2.isControlRepo, true);
});

test('repoAliasOf: control alias comparison is case-insensitive', () => {
  const issue = { number: 132, labels: [{ name: 'repo:ISSUE-PILOT' }] };
  assert.equal(repoAliasOf(issue, controlConfig132), 'ISSUE-PILOT');
  assert.throws(() => repoAliasOf({ number: 1, labels: [{ name: 'repo:nope' }] }, controlConfig132), /未注册仓库 nope/);
});

test('release gate authorization is exact to PR #103 and six documents', () => {
  const docs = [
    'acceptance-matrix.md', 'consistency-report.md', 'design.md',
    'reviewer-bot-design.md', 'revision-notes.md', 'sha256-list.md',
  ];
  for (const name of docs) {
    assert.equal(isApprovedReleaseGateFile('sunSUNQ/issue-pilot', 103, `policies/governance-v2/${name}`), true);
    assert.equal(isApprovedReleaseGateFile('sunSUNQ/issue-pilot', 104, `policies/governance-v2/${name}`), false);
  }
  assert.equal(isApprovedReleaseGateFile('sunSUNQ/provenlattice', 103, 'policies/governance-v2/design.md'), false);
  assert.equal(isApprovedReleaseGateFile('sunSUNQ/issue-pilot', 103, 'policies/solo-mode.md'), false);
  assert.equal(isApprovedReleaseGateFile('sunSUNQ/issue-pilot', 103, 'policies/governance-v2/extra.md'), false);
  assert.equal(isApprovedReleaseGateFile('sunSUNQ/issue-pilot', 103, '.github/workflows/control-plane-policy.yml'), false);
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

// --- G11: control-repo write audit (role -> principal -> writer_login -> repo -> operation) ---
const CAST_CFG = { issueRepository: 'sunSUNQ/issue-pilot' };

// Hard-pinned identity constants (mirror scripts/lib.mjs; launchers hardcode the same).
const READ_BOTS = {
  reviewer: 'pl-issue-reviewer-read[bot]',
  owner: 'pl-owner-reviewer[bot]',
  worker: 'pl-issue-worker[bot]',
};
const WRITE_BOTS = {
  reviewer: 'pl-issue-reviewer-write[bot]',
  owner: 'pl-owner-control-write[bot]',
  worker: 'pl-worker-control-write[bot]',
};
const PRINCIPALS = {
  reviewer: 'pl-issue-reviewer[bot]',
  owner: 'sunSUNQ',
  worker: 'pl-issue-worker[bot]',
};

function g11Env(role, writeBot) {
  return {
    PL_ENFORCE_APP: '1', PL_ROLE: role, PL_PRINCIPAL: PRINCIPALS[role],
    PL_GITHUB_LOGIN: READ_BOTS[role],
    PL_GIT_TOKEN: 'read-token',
    PL_WRITE_GIT_TOKEN: 'write-token',
    PL_WRITE_TOKEN_BOT: writeBot, PL_WRITE_EXPECTED_BOT: writeBot,
  };
}

// Stub identity resolver: maps the placeholder tokens to the role's real bots.
// No network — mirrors what resolveTokenLoginDefault would answer.
function resolveStub(readBot, writeBot) {
  return (token) => (token === 'read-token' ? readBot : token === 'write-token' ? writeBot : null);
}

test('G11 writeAudit exposes the full traceable chain', () => {
  const a = writeAudit(CAST_CFG, 'propose', g11Env('worker', WRITE_BOTS.worker),
    { resolveTokenLogin: resolveStub(READ_BOTS.worker, WRITE_BOTS.worker) });
  assert.equal(a.role, 'worker');
  assert.equal(a.principal, 'pl-issue-worker[bot]');
  assert.equal(a.writer_login, 'pl-worker-control-write[bot]');
  assert.equal(a.repository, 'sunSUNQ/issue-pilot');
  assert.equal(a.operation, 'propose');
});

test('G11 owner audit binds writer_login to the control-write App bot, not the principal', () => {
  const a = writeAudit(CAST_CFG, 'merge', g11Env('owner', WRITE_BOTS.owner),
    { resolveTokenLogin: resolveStub(READ_BOTS.owner, WRITE_BOTS.owner) });
  assert.equal(a.principal, 'sunSUNQ');
  assert.equal(a.writer_login, 'pl-owner-control-write[bot]');
});

test('G11 auditFooter embeds all five fields', () => {
  const footer = auditFooter(CAST_CFG, 'ci', g11Env('worker', WRITE_BOTS.worker),
    { resolveTokenLogin: resolveStub(READ_BOTS.worker, WRITE_BOTS.worker) });
  assert.ok(footer.includes('role=`worker`'));
  assert.ok(footer.includes('principal=`pl-issue-worker[bot]`'));
  assert.ok(footer.includes('writer_login=`pl-worker-control-write[bot]`'));
  assert.ok(footer.includes('repository=`sunSUNQ/issue-pilot`'));
  assert.ok(footer.includes('operation=`ci`'));
});

test('G11 writeAudit fails closed outside a launcher session', () => {
  assert.throws(() => writeAudit(CAST_CFG, 'propose', { PL_ENFORCE_APP: '0' }), /PL_ENFORCE_APP/);
  const noPrincipal = { ...g11Env('worker', WRITE_BOTS.worker) };
  delete noPrincipal.PL_PRINCIPAL;
  assert.throws(() => writeAudit(CAST_CFG, 'propose', noPrincipal), /PL_PRINCIPAL/);
});

// --- Finding 5: ruleset required-checks extraction (LIST endpoint has no rules/conditions) ---
const RS_DETAIL = {
  id: 25471662,
  name: 'provenlattice-main-protection',
  target: 'branch',
  enforcement: 'active',
  conditions: { ref_name: { exclude: [], include: ['~DEFAULT_BRANCH'] } },
  rules: [
    { type: 'deletion' },
    { type: 'non_fast_forward' },
    { type: 'pull_request', parameters: { required_approving_review_count: 0 } },
    {
      type: 'required_status_checks',
      parameters: {
        required_status_checks: [
          { context: 'test-windows', integration_id: 15368 },
          { context: 'test-linux', integration_id: 15368 },
          { context: 'linux-jdt-verify', integration_id: 15368 },
        ],
      },
    },
  ],
};

test('requiredChecksFromRuleset extracts required_status_checks with integration_id', () => {
  assert.deepEqual(requiredChecksFromRuleset(RS_DETAIL, 'e2e-validation'), [
    { context: 'test-windows', integration_id: 15368 },
    { context: 'test-linux', integration_id: 15368 },
    { context: 'linux-jdt-verify', integration_id: 15368 },
  ]);
});

test('requiredChecksFromRuleset ignores non-status rules and non-applying rulesets', () => {
  const detail = {
    ...RS_DETAIL,
    rules: [
      { type: 'deletion' },
      { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'x', integration_id: 1 }] } },
    ],
  };
  assert.deepEqual(requiredChecksFromRuleset(detail, 'e2e-validation'), [{ context: 'x', integration_id: 1 }]);
  assert.deepEqual(requiredChecksFromRuleset({ ...detail, enforcement: 'disabled' }, 'e2e-validation'), []);
  assert.deepEqual(requiredChecksFromRuleset({ ...detail, target: 'tag' }, 'e2e-validation'), []);
  assert.deepEqual(requiredChecksFromRuleset({ ...detail, conditions: { ref_name: { include: ['main'] } } }, 'e2e-validation'), []);
});

// --- P1-1: verifyLauncherIdentity binds the ACTUAL token identity to the role ---
// (stub resolver replaces the real `gh api graphql`; no network in tests)

function idEnv(role, readToken, writeToken) {
  return {
    PL_ENFORCE_APP: '1',
    PL_ROLE: role,
    PL_PRINCIPAL: PRINCIPALS[role],
    PL_GITHUB_LOGIN: READ_BOTS[role],
    PL_GIT_TOKEN: readToken,
    PL_WRITE_GIT_TOKEN: writeToken,
  };
}

const reviewerResolve = resolveStub(READ_BOTS.reviewer, WRITE_BOTS.reviewer);
const workerResolve = resolveStub(READ_BOTS.worker, WRITE_BOTS.worker);
const ownerResolve = resolveStub(READ_BOTS.owner, WRITE_BOTS.owner);

test('P1-1 reviewer session resolves to reviewer identity with both bots bound', () => {
  const id = verifyLauncherIdentity(idEnv('reviewer', 'read-token', 'write-token'), { resolveTokenLogin: reviewerResolve });
  assert.equal(id.role, 'reviewer');
  assert.equal(id.principal, 'pl-issue-reviewer[bot]');
  assert.equal(id.tokenBot, 'pl-issue-reviewer-read[bot]');
  assert.equal(id.writeTokenBot, 'pl-issue-reviewer-write[bot]');
});

test('P1-1 worker session resolves to worker identity', () => {
  const id = verifyLauncherIdentity(idEnv('worker', 'read-token', 'write-token'), { resolveTokenLogin: workerResolve });
  assert.equal(id.role, 'worker');
  assert.equal(id.tokenBot, 'pl-issue-worker[bot]');
  assert.equal(id.writeTokenBot, 'pl-worker-control-write[bot]');
});

test('P1-1 owner session resolves to owner identity (human principal + bot tokens)', () => {
  const id = verifyLauncherIdentity(idEnv('owner', 'read-token', 'write-token'), { resolveTokenLogin: ownerResolve });
  assert.equal(id.role, 'owner');
  assert.equal(id.principal, 'sunSUNQ');
  assert.equal(id.tokenBot, 'pl-owner-reviewer[bot]');
  assert.equal(id.writeTokenBot, 'pl-owner-control-write[bot]');
});

test('P1-1 worker cannot impersonate reviewer (real token identity mismatch)', () => {
  // Attacker holds worker tokens but declares reviewer role + principal.
  assert.throws(
    () => verifyLauncherIdentity(idEnv('reviewer', 'read-token', 'write-token'), { resolveTokenLogin: workerResolve }),
    /主 token 真实身份 .* 与 role=reviewer 不符/,
  );
});

test('P1-1 forged write token is rejected (write bot mismatch)', () => {
  const badWrite = (token) => (token === 'read-token' ? READ_BOTS.reviewer : 'pl-worker-control-write[bot]');
  assert.throws(
    () => verifyLauncherIdentity(idEnv('reviewer', 'read-token', 'write-token'), { resolveTokenLogin: badWrite }),
    /写侧 token 真实身份 .* 与 role=reviewer 不符/,
  );
});

test('P1-1 missing primary token fails closed', () => {
  const env = idEnv('worker', 'read-token', 'write-token');
  delete env.PL_GIT_TOKEN;
  assert.throws(() => verifyLauncherIdentity(env, { resolveTokenLogin: workerResolve }), /主 token 缺失/);
});

test('P1-1 caller-set PL_TOKEN_BOT/PL_EXPECTED_BOT are ignored (no trust in env self-assertion)', () => {
  // Even with a self-consistent PL_TOKEN_BOT===PL_EXPECTED_BOT that lies about the
  // bot, the real token resolution is authoritative and wins.
  const env = {
    ...idEnv('reviewer', 'read-token', 'write-token'),
    PL_TOKEN_BOT: 'pl-issue-reviewer-read[bot]',
    PL_EXPECTED_BOT: 'pl-issue-reviewer-read[bot]',
  };
  const id = verifyLauncherIdentity(env, { resolveTokenLogin: reviewerResolve });
  assert.equal(id.tokenBot, 'pl-issue-reviewer-read[bot]');
});

test('P1-1 write identity is resolved from the exact token used for control writes', () => {
  // The audit's writer_login must reflect the SAME token that controlGh()/
  // writeTokenEnv() uses for the actual write — i.e. env.PL_WRITE_GIT_TOKEN.
  const env = idEnv('reviewer', 'read-token', 'write-token');
  const seen = [];
  const resolve = (token, kind) => {
    seen.push([kind, token]);
    return token === 'read-token' ? READ_BOTS.reviewer : token === 'write-token' ? WRITE_BOTS.reviewer : null;
  };
  const id = verifyLauncherIdentity(env, { resolveTokenLogin: resolve });
  assert.deepEqual(seen, [['read', 'read-token'], ['write', 'write-token']]);
  assert.equal(env.PL_WRITE_GIT_TOKEN, 'write-token');
  assert.equal(id.writeTokenBot, WRITE_BOTS.reviewer);
});

// --- P1-2: validReviewerLgtm — later CHANGES/BLOCKED invalidates an earlier LGTM ---

function review(verdict, principal, sha, at) {
  return {
    reviewer_verdict: verdict, launcher_role: 'reviewer', principal,
    reviewed_head_sha: sha, reviewed_at: at,
  };
}

const R = 'pl-issue-reviewer[bot]';
const OTHER = 'pl-issue-reviewer-2[bot]';

test('P1-2 LGTM then CHANGES on same SHA invalidates the LGTM', () => {
  const state = { reviews: [review('lgtm', R, 'sha1', '2026-11-24T00:00:00Z'), review('changes', R, 'sha1', '2026-11-24T00:01:00Z')] };
  assert.equal(validReviewerLgtm(state, 'sha1'), null);
});

test('P1-2 LGTM then BLOCKED on same SHA invalidates the LGTM', () => {
  const state = { reviews: [review('lgtm', R, 'sha1', '2026-11-24T00:00:00Z'), review('blocked', R, 'sha1', '2026-11-24T00:01:00Z')] };
  assert.equal(validReviewerLgtm(state, 'sha1'), null);
});

test('P1-2 historical LGTM on a different SHA is isolated', () => {
  const state = { reviews: [review('lgtm', R, 'sha-old', '2026-11-24T00:00:00Z'), review('changes', R, 'sha-new', '2026-11-24T00:01:00Z')] };
  assert.equal(validReviewerLgtm(state, 'sha-new'), null);
  assert.equal(validReviewerLgtm(state, 'sha-old').reviewer_verdict, 'lgtm');
});

test('P1-2 records from different reviewers are isolated', () => {
  const state = { reviews: [review('lgtm', R, 'sha1', '2026-11-24T00:00:00Z'), review('changes', OTHER, 'sha1', '2026-11-24T00:01:00Z')] };
  const lgtm = validReviewerLgtm(state, 'sha1');
  assert.equal(lgtm.principal, R);
});

test('P1-2 a standalone valid LGTM is returned', () => {
  const state = { reviews: [review('lgtm', R, 'sha1', '2026-11-24T00:00:00Z')] };
  assert.equal(validReviewerLgtm(state, 'sha1').reviewer_verdict, 'lgtm');
});

test('P1-2 owner self-review (non-reviewer role) never counts as valid LGTM', () => {
  const state = { reviews: [{ reviewer_verdict: 'lgtm', launcher_role: 'owner', principal: 'sunSUNQ', reviewed_head_sha: 'sha1', reviewed_at: '2026-11-24T00:00:00Z' }] };
  assert.equal(validReviewerLgtm(state, 'sha1'), null);
});

// --- P1-2 (cross-reviewer): outstandingBlocks — CHANGES or BLOCKED from any reviewer blocks merge ---

test('P1-2 cross-reviewer: another reviewer CHANGES surfaces as blocking without invalidating the LGTM', () => {
  const state = { reviews: [review('lgtm', R, 'sha1', 'T0'), review('changes', OTHER, 'sha1', 'T1')] };
  assert.equal(validReviewerLgtm(state, 'sha1').principal, R); // per-reviewer isolation preserved
  assert.deepEqual(outstandingBlocks(state, 'sha1'), [{ principal: OTHER, verdict: 'changes' }]); // but the objection blocks merge
});

test('P1-2 cross-reviewer: CHANGES later superseded by the same reviewer LGTM no longer blocks', () => {
  const state = { reviews: [review('changes', OTHER, 'sha1', 'T0'), review('lgtm', OTHER, 'sha1', 'T1')] };
  assert.deepEqual(outstandingBlocks(state, 'sha1'), []);
});

test('P1-2 cross-reviewer: CHANGES on a different SHA is isolated (does not block current head)', () => {
  const state = { reviews: [review('changes', OTHER, 'sha-old', 'T0')] };
  assert.deepEqual(outstandingBlocks(state, 'sha1'), []);
});

test('P1-2 cross-reviewer: BLOCKED blocks merge even with another reviewer LGTM (unfinished review, not a defect)', () => {
  const state = { reviews: [review('lgtm', R, 'sha1', 'T0'), review('blocked', OTHER, 'sha1', 'T1')] };
  assert.deepEqual(outstandingBlocks(state, 'sha1'), [{ principal: OTHER, verdict: 'blocked' }]);
});

test('P1-2 cross-reviewer: BLOCKED later superseded by the same reviewer LGTM no longer blocks', () => {
  const state = { reviews: [review('blocked', OTHER, 'sha1', 'T0'), review('lgtm', OTHER, 'sha1', 'T1')] };
  assert.deepEqual(outstandingBlocks(state, 'sha1'), []);
});

// --- G10: missingRequiredChecks — re-run / order / same-name-different-App aggregation ---

const REQUIRED_ONE = [{ context: 'contract', integration_id: 15368 }];
const T0 = '2026-11-24T10:00:00Z';
const T1 = '2026-11-24T11:00:00Z';
const run = (over = {}) => ({
  id: 1, name: 'contract', app: { id: 15368 }, status: 'completed',
  conclusion: 'success', started_at: T0, completed_at: T0, ...over,
});

test('G10 failure then success re-run satisfies (newest run id wins)', () => {
  const runs = [run({ id: 1, conclusion: 'failure' }), run({ id: 2, conclusion: 'success' })];
  assert.deepEqual(missingRequiredChecks(REQUIRED_ONE, runs, []), []);
});

test('G10 success then failure does not satisfy (newest run id wins)', () => {
  const runs = [run({ id: 1, conclusion: 'success' }), run({ id: 2, conclusion: 'failure' })];
  assert.deepEqual(missingRequiredChecks(REQUIRED_ONE, runs, []).length, 1);
});

test('G10 result is independent of API order (shuffled input)', () => {
  const success = run({ id: 2, conclusion: 'success' });
  const failure = run({ id: 1, conclusion: 'failure' });
  assert.deepEqual(missingRequiredChecks(REQUIRED_ONE, [failure, success], []), []);
  assert.deepEqual(missingRequiredChecks(REQUIRED_ONE, [success, failure], []), []);
});

test('G10 pending run fails closed', () => {
  const runs = [run({ status: 'in_progress', conclusion: null })];
  const missing = missingRequiredChecks(REQUIRED_ONE, runs, []);
  assert.equal(missing.length, 1);
  assert.match(missing[0], /未完成/);
});

test('G10 pending re-run is not masked by an earlier success', () => {
  // The reviewer's key case: a success completed earlier (lower id), then a re-run
  // still in_progress (higher id). The newest run is authoritative -> not ready.
  const success = run({ id: 1, conclusion: 'success' });
  const reRunInProgress = run({ id: 2, status: 'in_progress', conclusion: null, completed_at: null });
  const missing = missingRequiredChecks(REQUIRED_ONE, [success, reRunInProgress], []);
  assert.equal(missing.length, 1);
  assert.match(missing[0], /未完成/);
  assert.equal(missingRequiredChecks(REQUIRED_ONE, [reRunInProgress, success], []).length, 1);
});

test('G10 skipped / neutral conclusions fail closed', () => {
  assert.equal(missingRequiredChecks(REQUIRED_ONE, [run({ conclusion: 'skipped' })], []).length, 1);
  assert.equal(missingRequiredChecks(REQUIRED_ONE, [run({ conclusion: 'neutral' })], []).length, 1);
});

test('G10 missing check fails closed', () => {
  assert.equal(missingRequiredChecks(REQUIRED_ONE, [], []).length, 1);
});

test('G10 same-name checks from different Apps are independent', () => {
  const required = [
    { context: 'contract', integration_id: 15368 },
    { context: 'contract', integration_id: 99999 },
  ];
  const runs = [run({ app: { id: 15368 }, conclusion: 'success' })];
  // App 99999 has no run -> its required check is missing, even though 15368 passed.
  const missing = missingRequiredChecks(required, runs, []);
  assert.equal(missing.length, 1);
  assert.match(missing[0], /integration_id=99999/);
});

test('G10 commit-status fallback only applies when integration_id is null', () => {
  const required = [{ context: 'legacy', integration_id: null }];
  assert.deepEqual(missingRequiredChecks(required, [], [{ context: 'legacy', state: 'success', updated_at: T0 }]), []);
  assert.equal(missingRequiredChecks(required, [], [{ context: 'legacy', state: 'pending', updated_at: T0 }]).length, 1);
  // integration_id != null ignores commit statuses entirely.
  assert.equal(missingRequiredChecks(REQUIRED_ONE, [], [{ context: 'contract', state: 'success', updated_at: T0 }]).length, 1);
});

// --- R3: control-repo self-route + PR identity / uniqueness validation ---

const R3_CFG = {
  issueRepository: 'sunSUNQ/issue-pilot',
  worktreeRoot: 'D:\\tasco-temp\\issue-pilot\\worktrees',
  repositories: {
    tasco: { github: 'sunSUNQ/tasco-dev', base: 'main', policy: 'tasco', checks: [], path: 'C:\\tasco' },
  },
};

const R3_PR = {
  number: 103, repository: 'sunSUNQ/issue-pilot',
  headRefOid: '5214f525ae7207ed4ceb446e3e1d7d332d203436',
  headRefName: 'governance-v2-release-candidate',
  baseRefName: 'main', state: 'OPEN',
};

test('R3 controlRepoAlias derives the short repo name from issueRepository', () => {
  assert.equal(controlRepoAlias(R3_CFG), 'issue-pilot');
  assert.equal(controlRepoAlias({ issueRepository: 'acme/foo-bar' }), 'foo-bar');
  assert.equal(controlRepoAlias({}), '');
});

test('R3 repoDescriptor returns a registered product repo unchanged', () => {
  const d = repoDescriptor(R3_CFG, 'tasco');
  assert.equal(d.isControlRepo, false);
  assert.equal(d.github, 'sunSUNQ/tasco-dev');
  assert.equal(d.base, 'main');
  assert.equal(d.policy, 'tasco');
  assert.deepEqual(d.checks, []);
});

test('R3 repoDescriptor synthesizes the control repo for the issue-pilot alias', () => {
  const d = repoDescriptor(R3_CFG, 'issue-pilot');
  assert.equal(d.isControlRepo, true);
  assert.equal(d.github, 'sunSUNQ/issue-pilot');
  assert.equal(d.base, 'main');
});

test('R3 repoDescriptor fails closed on an unknown alias', () => {
  assert.throws(() => repoDescriptor(R3_CFG, 'nope'), /未注册仓库 nope/);
});

test('R3 repoAliasOf accepts the control-repo alias without registration', () => {
  const alias = repoAliasOf({ number: 101, labels: [{ name: 'repo:issue-pilot' }] }, R3_CFG);
  assert.equal(alias, 'issue-pilot');
});

test('R3 prIdentityViolations is empty when every pinned field matches', () => {
  const v = prIdentityViolations(R3_PR, {
    repository: 'sunSUNQ/issue-pilot', number: 103, base: 'main',
    head: 'governance-v2-release-candidate', sha: R3_PR.headRefOid,
  });
  assert.deepEqual(v, []);
});

test('R3 prIdentityViolations flags repository / number / base / head / sha mismatches', () => {
  assert.equal(prIdentityViolations({ ...R3_PR, repository: 'other/repo' }, { repository: 'sunSUNQ/issue-pilot' }).length, 1);
  assert.equal(prIdentityViolations(R3_PR, { number: 999 }).length, 1);
  assert.equal(prIdentityViolations(R3_PR, { base: 'develop' }).length, 1);
  assert.equal(prIdentityViolations(R3_PR, { head: 'other-branch' }).length, 1);
  assert.equal(prIdentityViolations(R3_PR, { sha: 'deadbeef' }).length, 1);
});

test('R3 prIdentityViolations ignores unpinned fields (optional binding)', () => {
  const v = prIdentityViolations(R3_PR, { number: 103 });
  assert.deepEqual(v, []);
});

// --- B1: explicit Issue ↔ PR binding + findPr control-repo branch ---

const B1_PR = {
  number: 103,
  url: 'https://github.com/sunSUNQ/issue-pilot/pull/103',
  headRefOid: '142c8e90399981c3b08b8a019fc70e9185e2943d',
  headRefName: 'governance-v2-release-candidate',
  baseRefName: 'main',
  state: 'OPEN',
};

const B1_STATE = {
  prNumber: 103,
  prBranch: 'governance-v2-release-candidate',
  prBase: 'main',
  prHeadSha: B1_PR.headRefOid,
};

function ghStub(payload, calls = []) {
  return (args) => {
    calls.push(args);
    return { status: 0, stdout: JSON.stringify(payload), stderr: '' };
  };
}

test('B1 prRepositoryFromUrl parses owner/repo from a PR URL only', () => {
  assert.equal(prRepositoryFromUrl('https://github.com/sunSUNQ/issue-pilot/pull/103'), 'sunSUNQ/issue-pilot');
  assert.equal(prRepositoryFromUrl('https://github.com/sunSUNQ/issue-pilot/pull/103/'), 'sunSUNQ/issue-pilot');
  assert.equal(prRepositoryFromUrl('https://github.com/sunSUNQ/issue-pilot/issues/103'), null);
  assert.equal(prRepositoryFromUrl(''), null);
});

test('B1 bindingRecord persists repository identity fields from the API response', () => {
  const record = bindingRecord(B1_PR, { principal: 'pl-issue-worker[bot]', writeTokenBot: 'pl-worker-control-write[bot]' }, 'T0');
  assert.deepEqual(record, {
    prNumber: 103,
    prUrl: B1_PR.url,
    prBranch: 'governance-v2-release-candidate',
    prBase: 'main',
    prHeadSha: B1_PR.headRefOid,
    boundAt: 'T0',
    boundBy: 'pl-issue-worker[bot]',
    boundWriter: 'pl-worker-control-write[bot]',
  });
});

test('B1 findPr fails closed with an executable bind command when the control repo has no binding', () => {
  const repo = repoDescriptor(R3_CFG, 'issue-pilot');
  assert.throws(
    () => findPr(R3_CFG, repo, 101, { number: 101, title: 'release' }, {}),
    (error) => /未绑定 PR/.test(error.message)
      && /npm run pilot -- bind 101 --pr <PR_NUMBER>/.test(error.message),
  );
});

test('B1 findPr resolves the bound control-repo PR and pins its repository', () => {
  const repo = repoDescriptor(R3_CFG, 'issue-pilot');
  const calls = [];
  const pr = findPr(R3_CFG, repo, 101, { number: 101, title: 'release' }, B1_STATE, { gh: ghStub(B1_PR, calls) });
  assert.equal(pr.number, 103);
  assert.equal(pr.repository, 'sunSUNQ/issue-pilot');
  assert.equal(pr.headRefOid, B1_PR.headRefOid);
  assert.deepEqual(calls[0].slice(0, 5), ['pr', 'view', '103', '-R', 'sunSUNQ/issue-pilot']);
});

test('B1 findPr rejects a bound PR whose number differs', () => {
  const repo = repoDescriptor(R3_CFG, 'issue-pilot');
  assert.throws(
    () => findPr(R3_CFG, repo, 101, { number: 101 }, B1_STATE, { gh: ghStub({ ...B1_PR, number: 999 }) }),
    /!= 期望 PR #103/,
  );
});

test('B1 findPr rejects a bound PR from another repository (URL is authoritative)', () => {
  const repo = repoDescriptor(R3_CFG, 'issue-pilot');
  assert.throws(
    () => findPr(R3_CFG, repo, 101, { number: 101 }, B1_STATE,
      { gh: ghStub({ ...B1_PR, url: 'https://github.com/other/repo/pull/103' }) }),
    /不属于仓库 sunSUNQ\/issue-pilot/,
  );
});

test('B1 findPr rejects bound base / head branch / HEAD SHA mismatches', () => {
  const repo = repoDescriptor(R3_CFG, 'issue-pilot');
  assert.throws(
    () => findPr(R3_CFG, repo, 101, { number: 101 }, { ...B1_STATE, prBase: 'develop' }, { gh: ghStub(B1_PR) }),
    /base main != 期望 develop/,
  );
  assert.throws(
    () => findPr(R3_CFG, repo, 101, { number: 101 }, { ...B1_STATE, prBranch: 'other-branch' }, { gh: ghStub(B1_PR) }),
    /head branch governance-v2-release-candidate != 期望 other-branch/,
  );
  assert.throws(
    () => findPr(R3_CFG, repo, 101, { number: 101 }, { ...B1_STATE, prHeadSha: 'deadbeef' }, { gh: ghStub(B1_PR) }),
    /HEAD 142c8e90.* != 期望 deadbeef/,
  );
});

test('B1 findPr rejects a bound control-repo PR that is not OPEN', () => {
  const repo = repoDescriptor(R3_CFG, 'issue-pilot');
  assert.throws(
    () => findPr(R3_CFG, repo, 101, { number: 101 }, B1_STATE, { gh: ghStub({ ...B1_PR, state: 'MERGED' }) }),
    /状态 MERGED/,
  );
});

test('B1 merged-PR consumers can opt out of the OPEN requirement', () => {
  const repo = repoDescriptor(R3_CFG, 'issue-pilot');
  const pr = findPr(R3_CFG, repo, 101, { number: 101 }, B1_STATE,
    { gh: ghStub({ ...B1_PR, state: 'MERGED' }), requireOpen: false });
  assert.equal(pr.state, 'MERGED');
});

test('B1 product-repo binding uses the explicit PR instead of branch inference', () => {
  const repo = repoDescriptor(R3_CFG, 'tasco');
  const payload = {
    number: 7,
    url: 'https://github.com/sunSUNQ/tasco-dev/pull/7',
    headRefOid: 'feedface',
    headRefName: 'issue-pilot/55-fix',
    baseRefName: 'main',
    state: 'MERGED',
  };
  const calls = [];
  const pr = findPr(R3_CFG, repo, 55, { number: 55, title: 'fix' },
    { prNumber: 7, prBranch: 'issue-pilot/55-fix', prBase: 'main', prHeadSha: 'feedface' },
    { gh: ghStub(payload, calls) });
  assert.equal(pr.number, 7);
  assert.equal(pr.repository, 'sunSUNQ/tasco-dev');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'pr');
  assert.equal(calls[0][1], 'view');
});

test('B1 product-repo without a binding keeps branch inference unchanged', () => {
  const repo = repoDescriptor(R3_CFG, 'tasco');
  const calls = [];
  const pr = findPr(R3_CFG, repo, 55, { number: 55, title: 'Fix Parser' }, {}, {
    gh: (args) => {
      calls.push(args);
      return { status: 0, stdout: JSON.stringify([{ number: 9, url: 'https://github.com/sunSUNQ/tasco-dev/pull/9', state: 'OPEN' }]), stderr: '' };
    },
  });
  assert.equal(pr.number, 9);
  assert.equal(pr.repository, 'sunSUNQ/tasco-dev');
  assert.ok(calls[0].includes('issue-pilot/55-fix-parser'));
});

test('B1 branch inference still fails closed on ambiguous open PRs', () => {
  const repo = repoDescriptor(R3_CFG, 'tasco');
  assert.throws(
    () => findPr(R3_CFG, repo, 55, { number: 55, title: 'fix' }, {}, {
      gh: () => ({ status: 0, stdout: JSON.stringify([{ number: 1, state: 'OPEN' }, { number: 2, state: 'OPEN' }]), stderr: '' }),
    }),
    /PR 歧义/,
  );
});

test('Solo Mode scope parses only the first repo clause on the scope line', () => {
  const text = '> 生效范围：repo:codegraph（sunSUNQ/provenlattice）；repo:tasco 暂不启用。';
  assert.deepEqual(parseSoloScope(text), ['codegraph']);
  assert.deepEqual(parseSoloScope('> 生效范围：repo:tasco；repo:codegraph'), ['tasco']);
  assert.deepEqual(parseSoloScope('> 生效范围：'), []);
  assert.deepEqual(parseSoloScope('> 状态：ACTIVE'), []);
  assert.deepEqual(parseSoloScope('> 生效范围：未配置'), []);
});

test('Solo Mode scope allows only the configured repository alias', () => {
  const solo = { enabled: true, phase: 'active', scope: ['codegraph'] };
  assert.equal(soloScopeAllows(solo, 'codegraph'), true);
  for (const alias of ['tasco', 'provenlattice', 'issue-pilot']) {
    assert.equal(soloScopeAllows(solo, alias), false);
  }
  assert.equal(soloScopeAllows({ enabled: true, phase: 'active', scope: [] }, 'codegraph'), false);
});

test('Solo Mode reads the current policy scope without including disabled aliases', () => {
  const solo = soloMode();
  assert.equal(solo.phase, 'active');
  assert.deepEqual(solo.scope, ['codegraph']);
});

// --- issue-pilot#110: control-repo author path (propose alias + submit precheck) ---

test('issue-110 resolveProposeRepo accepts the control-repo alias without registration', () => {
  const d = resolveProposeRepo(R3_CFG, 'issue-pilot');
  assert.equal(d.isControlRepo, true);
  assert.equal(d.alias, 'issue-pilot');
  assert.equal(d.github, 'sunSUNQ/issue-pilot');
});

test('issue-110 resolveProposeRepo keeps registered product repos unchanged', () => {
  const d = resolveProposeRepo(R3_CFG, 'tasco');
  assert.equal(d.isControlRepo, false);
  assert.equal(d.github, 'sunSUNQ/tasco-dev');
});

test('issue-110 resolveProposeRepo fails closed without an alias or on an unknown alias', () => {
  assert.throws(() => resolveProposeRepo(R3_CFG, undefined), /--repo/);
  assert.throws(() => resolveProposeRepo(R3_CFG, ''), /--repo/);
  assert.throws(() => resolveProposeRepo(R3_CFG, 'nope'), /未注册仓库 nope/);
});

test('issue-110 control-repo submit refuses before side effects with release-launcher guidance', () => {
  const msg = controlRepoSubmitRefusal(repoDescriptor(R3_CFG, 'issue-pilot'), 110, 'issue-pilot/110-fix');
  assert.match(msg, /release launcher/);
  assert.match(msg, /fail-closed/);
  assert.match(msg, /未执行任何 git push/);
  assert.match(msg, /bind 110 --pr <PR_NUMBER>/);
  assert.match(msg, /issue-pilot\/110-fix/);
  assert.match(msg, /base `main`/);
});

test('issue-110 product-repo submit is not refused (behavior unchanged)', () => {
  assert.equal(controlRepoSubmitRefusal(repoDescriptor(R3_CFG, 'tasco'), 110, 'issue-pilot/110-fix'), null);
  assert.equal(controlRepoSubmitRefusal(undefined, 110, 'b'), null);
});

// --- issue-pilot#108: Owner-only direct commands + scope-gated delegation ---

test('issue-108 assertOwnerIdentity accepts an owner launcher session', () => {
  const id = assertOwnerIdentity(idEnv('owner', 'read-token', 'write-token'), { resolveTokenLogin: ownerResolve });
  assert.equal(id.role, 'owner');
  assert.equal(id.principal, 'sunSUNQ');
  assert.equal(id.writeTokenBot, 'pl-owner-control-write[bot]');
});

test('issue-108 assertOwnerIdentity rejects a worker launcher (fail-closed)', () => {
  assert.throws(
    () => assertOwnerIdentity(idEnv('worker', 'read-token', 'write-token'), { resolveTokenLogin: workerResolve }),
    /需要 Owner launcher（PL_ROLE=owner），当前 role=worker/,
  );
});

test('issue-108 assertOwnerIdentity rejects a reviewer launcher (fail-closed)', () => {
  assert.throws(
    () => assertOwnerIdentity(idEnv('reviewer', 'read-token', 'write-token'), { resolveTokenLogin: reviewerResolve }),
    /需要 Owner launcher（PL_ROLE=owner），当前 role=reviewer/,
  );
});

test('issue-108 assertOwnerIdentity fails closed outside a launcher session', () => {
  assert.throws(
    () => assertOwnerIdentity({ PL_ENFORCE_APP: '0', PL_ROLE: 'owner' }, { resolveTokenLogin: ownerResolve }),
    /PL_ENFORCE_APP/,
  );
});

test('issue-108 delegated path stays behind Solo Mode + scope gate', async () => {
  const source = await readFile(new URL('../scripts/cli.mjs', import.meta.url), 'utf8');
  const advance = source.slice(source.indexOf('function advanceOnce('), source.indexOf('function advance('));
  assert.ok(advance.includes('requireSolo()'), 'advanceOnce must require an enabled Solo Mode');
  assert.ok(advance.includes('soloScopeAllows(solo, alias)'), 'advanceOnce must enforce the policy scope');
  assert.ok(advance.includes('autoVerify(') && advance.includes('autoClose('), 'delegation must stay in advanceOnce');
  for (const name of ['approveInternal', 'verifyInternal', 'closeInternal']) {
    const calls = source.match(new RegExp(`${name}\\(`, 'g')) ?? [];
    assert.ok(calls.length >= 1, `${name} must exist`);
  }
  // The direct CLI dispatchers must call the owner gate; the internal names must
  // never be wired into the command table.
  assert.ok(/else if \(command === 'approve'\) approve\(/.test(source));
  assert.ok(!/else if \(command === '[a-z]+'\) (approveInternal|verifyInternal|closeInternal)\(/.test(source));
});

// --- issue-pilot#122: governance state blocks + deterministic rebuild ---

const STATE_REPO = 'sunSUNQ/issue-pilot';
const STATE_CTX = { issue: 101, repository: STATE_REPO, alias: 'issue-pilot' };
const STATE_BOTS = {
  worker: { role: 'worker', principal: 'pl-issue-worker[bot]', writer: 'pl-worker-control-write[bot]' },
  owner: { role: 'owner', principal: 'sunSUNQ', writer: 'pl-owner-control-write[bot]' },
  reviewer: { role: 'reviewer', principal: 'pl-issue-reviewer[bot]', writer: 'pl-issue-reviewer-write[bot]' },
};

function stateFooter(bot, operation) {
  return ['', '---', '<sub>control-plane audit</sub>',
    `role=\`${bot.role}\` principal=\`${bot.principal}\` writer_login=\`${bot.writer}\` repository=\`${STATE_REPO}\` operation=\`${operation}\``,
  ].join('\n');
}

function stateCommentFixture({
  role = 'worker', type = 'binding', payload = { prNumber: 1 }, operation = 'bind',
  body = 'visible body', at = '2026-11-25T00:00:00.000Z', id = 1,
  createdAt = '2026-11-25T00:00:01Z', alias = 'issue-pilot', issue = 101, withFooter = true,
} = {}) {
  const bot = STATE_BOTS[role];
  const visible = `${body}${withFooter ? stateFooter(bot, operation) : ''}`;
  const envelope = makeStateEnvelope({
    issue, repository: STATE_REPO, alias, type, operation,
    role: bot.role, principal: bot.principal, writer_login: bot.writer, payload,
  }, visible, at);
  return {
    id, created_at: createdAt, user: { login: bot.writer },
    body: appendStateBlock(visible, envelope), envelope, visible,
  };
}

function stateEvent(type, payload, { role = 'worker', at = '2026-11-25T00:00:00.000Z', operation = type } = {}) {
  const bot = STATE_BOTS[role];
  const envelope = makeStateEnvelope({
    issue: 101, repository: STATE_REPO, alias: 'issue-pilot', type, operation,
    role: bot.role, principal: bot.principal, writer_login: bot.writer, payload,
  }, `body${stateFooter(bot, operation)}`, at);
  return { order: [Date.parse(at), 1, envelope.event_id], comment_id: 1, envelope };
}

test('issue-122 canonicalJson sorts keys and rejects non-finite numbers', () => {
  assert.equal(canonicalJson({ b: 1, a: [true, null, 'x'] }), '{"a":[true,null,"x"],"b":1}');
  assert.throws(() => canonicalJson({ x: NaN }), /NaN/);
  assert.throws(() => canonicalJson({ x: Infinity }), /NaN/);
});

test('issue-122 extractStateBlocks handles zero / one / multiple blocks', () => {
  assert.deepEqual(extractStateBlocks('legacy comment'), []);
  const comment = stateCommentFixture();
  assert.equal(extractStateBlocks(comment.body).length, 1);
  assert.equal(extractStateBlocks(`${comment.body}\n\n${encodeStateBlock(comment.envelope)}`).length, 2);
});

test('issue-122 removeStateBlockLines and normalizeBodyForHash are stable', () => {
  const comment = stateCommentFixture({ body: 'line  \r\n\r\n' });
  const visible = removeStateBlockLines(comment.body);
  assert.ok(!visible.includes('issue-pilot-state'));
  assert.ok(normalizeBodyForHash(comment.body).endsWith('\n'));
  assert.ok(!normalizeBodyForHash(comment.body).includes('\r'));
  assert.equal(comment.envelope.body_sha256, `sha256:${sha256Hex(normalizeBodyForHash(comment.body))}`);
});

test('issue-122 validateStateComment accepts a valid worker binding comment', () => {
  const comment = stateCommentFixture();
  const envelope = validateStateComment(comment, STATE_CTX);
  assert.equal(envelope.schema, STATE_SCHEMA);
  assert.equal(envelope.type, 'binding');
  assert.equal(envelope.writer_login, STATE_BOTS.worker.writer);
});

test('issue-122 validateStateComment rejects non-pinned authors and writer mismatch', () => {
  const comment = stateCommentFixture();
  assert.throws(() => validateStateComment({ ...comment, user: { login: 'sunSUNQ' } }, STATE_CTX), /钉扎写侧 bot/);
  assert.throws(() => validateStateComment({ ...comment, user: { login: STATE_BOTS.owner.writer } }, STATE_CTX), /writer_login 不一致/);
});

test('issue-122 validateStateComment rejects footer mismatch and body tampering', () => {
  const comment = stateCommentFixture();
  assert.throws(
    () => validateStateComment({ ...comment, body: comment.body.replace('operation=`bind`', 'operation=`ci`') }, STATE_CTX),
    /footer/,
  );
  assert.throws(
    () => validateStateComment({ ...comment, body: comment.body.replace('visible body', 'visible BODY') }, STATE_CTX),
    /body_sha256/,
  );
});

test('issue-122 validateStateComment rejects schema / event_id tampering and multiple blocks', () => {
  const comment = stateCommentFixture();
  const badSchema = { ...comment.envelope, schema: 'issue-pilot/state@2' };
  const badSchemaBody = comment.body.replace(encodeStateBlock(comment.envelope), encodeStateBlock(badSchema));
  assert.throws(() => validateStateComment({ ...comment, body: badSchemaBody }, STATE_CTX), /schema/);

  const badEvent = { ...comment.envelope, event_id: `sha256:${'0'.repeat(64)}` };
  const badEventBody = comment.body.replace(encodeStateBlock(comment.envelope), encodeStateBlock(badEvent));
  assert.throws(() => validateStateComment({ ...comment, body: badEventBody }, STATE_CTX), /event_id/);

  const twoBlocks = `${comment.body}\n\n${encodeStateBlock(comment.envelope)}`;
  assert.throws(() => validateStateComment({ ...comment, body: twoBlocks }, STATE_CTX), /个状态块/);
});

test('issue-122 validateStateComment rejects invalid base64/JSON and missing footer', () => {
  const invalidJson = {
    id: 1, created_at: '2026-11-25T00:00:01Z', user: { login: STATE_BOTS.worker.writer },
    body: `visible${stateFooter(STATE_BOTS.worker, 'bind')}\n\n<!-- issue-pilot-state:v1 YWJj -->\n`,
  };
  assert.throws(() => validateStateComment(invalidJson, STATE_CTX), /JSON/);

  const noFooter = stateCommentFixture({ withFooter: false });
  assert.throws(() => validateStateComment(noFooter, STATE_CTX), /footer/);
});

test('issue-122 parseStateComments orders by created_at/id and dedupes identical events', () => {
  const first = stateCommentFixture({ id: 2, createdAt: '2026-11-25T00:00:01Z', payload: { prNumber: 1 } });
  const second = stateCommentFixture({ id: 3, createdAt: '2026-11-25T00:00:02Z', payload: { prNumber: 2 } });
  const events = parseStateComments([second, first], STATE_CTX);
  assert.deepEqual(events.map((event) => event.envelope.payload.prNumber), [1, 2]);

  const duplicate = { ...first, id: 4, created_at: '2026-11-25T00:00:03Z' };
  assert.equal(parseStateComments([first, duplicate], STATE_CTX).length, 1);
  assert.deepEqual(parseStateComments([{ body: 'legacy', id: 5, created_at: '2026-11-25T00:00:04Z', user: { login: 'sunSUNQ' } }], STATE_CTX), []);
});

test('issue-122 foldStateEvents: binding latest wins and ci only writes on ready=true', () => {
  const state = foldStateEvents([
    stateEvent('binding', { prNumber: 1, prHeadSha: 'a'.repeat(40), prBranch: 'one', prBase: 'main' }),
    stateEvent('binding', { prNumber: 2, prHeadSha: 'b'.repeat(40), prBranch: 'two', prBase: 'main' }),
    stateEvent('ci', { ready: false, missing: ['contract'] }),
    stateEvent('ci', { ready: true, ciHeadSha: 'b'.repeat(40), ciVerifiedAt: '2026-11-25T00:00:02Z' }),
  ]);
  assert.equal(state.prNumber, 2);
  assert.equal(state.prHeadSha, 'b'.repeat(40));
  assert.equal(state.prBranch, 'two');
  assert.equal(state.branch, 'two');
  assert.equal(state.ciHeadSha, 'b'.repeat(40));
});

test('issue-122 foldStateEvents: reviews append/replace and reject same id with different SHA', () => {
  const r1 = { review_id: 'r1', reviewed_head_sha: 'a'.repeat(40), reviewer_verdict: 'lgtm' };
  const r1b = { ...r1, reviewer_verdict: 'changes' };
  const r2 = { review_id: 'r2', reviewed_head_sha: 'a'.repeat(40), reviewer_verdict: 'lgtm' };
  const state = foldStateEvents([
    stateEvent('review', { review: r1 }),
    stateEvent('review', { review: r2 }),
    stateEvent('review', { review: r1b }),
  ]);
  assert.equal(state.reviews.length, 2);
  assert.equal(state.reviews[0].reviewer_verdict, 'changes');
  assert.throws(
    () => foldStateEvents([
      stateEvent('review', { review: r1 }),
      stateEvent('review', { review: { ...r1, reviewed_head_sha: 'b'.repeat(40) } }),
    ]),
    /reviewed_head_sha 不一致/,
  );
});

test('issue-122 foldStateEvents: merge, run, owner-transfer and verify', () => {
  const state = foldStateEvents([
    stateEvent('run', { launcherRole: 'worker', githubLogin: 'pl-issue-worker[bot]' }),
    stateEvent('owner-transfer', { assignee: 'sunSUNQ', ownerTransfers: [] }),
    stateEvent('merge', { mergedSha: 'c'.repeat(40), mergedAt: '2026-11-25T00:00:03Z', mergeVerdict: 'merge', mergeLgtm: 'r1' }),
    stateEvent('verify', { verifiedAt: '2026-11-25T00:00:04Z' }),
  ]);
  assert.equal(state.launcherRole, 'worker');
  assert.equal(state.assignee, 'sunSUNQ');
  assert.equal(state.mergedSha, 'c'.repeat(40));
  assert.equal(state.mergeVerdict, 'merge');
  assert.equal(state.verifiedAt, '2026-11-25T00:00:04Z');
});

test('issue-122 stateRebuildSummary uses the documented format', () => {
  assert.equal(
    stateRebuildSummary(101, 'issue-pilot', [{}, {}], {
      prNumber: 117, ciHeadSha: '1234567890', reviews: [{}], mergedSha: 'abcdef1234',
    }),
    '#101 rebuilt: events=2 aliases=issue-pilot binding=117 ciHeadSha=12345678 reviews=1 mergedSha=abcdef12',
  );
  assert.equal(
    stateRebuildSummary(101, 'issue-pilot', [], {}),
    '#101 rebuilt: events=0 aliases=issue-pilot binding=none ciHeadSha=none reviews=0 mergedSha=none',
  );
});

test('issue-122 atomicWriteJson writes atomically and leaves no temp file', () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), '.tmp-state-test-'));
  try {
    const file = path.join(dir, 'state.json');
    atomicWriteJson(file, { a: 1 });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 1 });
    assert.equal(fs.readdirSync(dir).filter((name) => name.includes('.tmp-')).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- issue-pilot#111: verdict-change idempotency (latest record wins, review_seq) ---

function planned(verdict, seq, url = 'url') {
  return {
    review_id: `r-${verdict}`,
    launcher_role: 'reviewer', principal: R, reviewed_head_sha: 'sha1',
    reviewer_verdict: verdict, review_url: url, review_seq: seq,
  };
}

function incomingReview(verdict, principal = R) {
  return {
    review_id: `r-${verdict}`,
    launcher_role: 'reviewer', principal, reviewed_head_sha: 'sha1',
    reviewer_verdict: verdict, review_url: null,
  };
}

function withUrls(plan, url) {
  return plan.reviews.map((r) => ({ ...r, review_url: url }));
}

test('issue-111 LGTM -> CHANGES -> LGTM keeps the second LGTM with review_seq', () => {
  let plan = planReviewRecord([], incomingReview('lgtm'));
  assert.equal(plan.action, 'append');
  assert.equal(plan.record.review_seq, 1);
  let reviews = withUrls(plan, 'url1');

  plan = planReviewRecord(reviews, incomingReview('changes'));
  assert.equal(plan.action, 'append');
  assert.equal(plan.record.review_seq, 1);
  reviews = withUrls(plan, 'url2');

  plan = planReviewRecord(reviews, incomingReview('lgtm'));
  assert.equal(plan.action, 'append');
  assert.equal(plan.record.review_seq, 2); // same review_id as the first LGTM
  reviews = withUrls(plan, 'url3');

  assert.equal(reviews.length, 3);
  assert.deepEqual(reviews.map((r) => [r.reviewer_verdict, r.review_seq]), [
    ['lgtm', 1], ['changes', 1], ['lgtm', 2],
  ]);
  const state = { reviews };
  assert.equal(validReviewerLgtm(state, 'sha1').review_seq, 2);
  assert.deepEqual(outstandingBlocks(state, 'sha1'), []);
});

test('issue-111 repeating the latest LGTM is a no-op (no duplicate comment)', () => {
  const reviews = [planned('lgtm', 1)];
  const plan = planReviewRecord(reviews, incomingReview('lgtm'));
  assert.equal(plan.action, 'noop');
  assert.equal(plan.reviews.length, 1);
});

test('issue-111 same verdict without review_url resumes the same record (no new seq)', () => {
  const reviews = [planned('lgtm', 1, null)];
  const plan = planReviewRecord(reviews, incomingReview('lgtm'));
  assert.equal(plan.action, 'resume');
  assert.equal(plan.record.review_seq, 1);
  assert.equal(plan.reviews.length, 1);
});

test('issue-111 CHANGES -> LGTM -> CHANGES stays blocking', () => {
  let plan = planReviewRecord([], incomingReview('changes'));
  let reviews = withUrls(plan, 'u1');
  plan = planReviewRecord(reviews, incomingReview('lgtm'));
  reviews = withUrls(plan, 'u2');
  plan = planReviewRecord(reviews, incomingReview('changes'));
  reviews = withUrls(plan, 'u3');

  assert.equal(reviews.length, 3);
  assert.equal(validReviewerLgtm({ reviews }, 'sha1'), null);
  assert.deepEqual(outstandingBlocks({ reviews }, 'sha1'), [{ principal: R, verdict: 'changes' }]);
});

test('issue-111 different reviewers are planned independently', () => {
  const otherChanges = { ...incomingReview('changes', OTHER), review_id: 'r-other-changes' };
  let plan = planReviewRecord([], otherChanges);
  const reviews = withUrls(plan, 'u1');
  plan = planReviewRecord(reviews, incomingReview('lgtm'));
  assert.equal(plan.action, 'append');
  assert.equal(plan.record.review_seq, 1);
  assert.equal(validReviewerLgtm({ reviews: plan.reviews }, 'sha1').principal, R);
});

test('issue-111 foldStateEvents keeps same review_id with different review_seq', () => {
  const r1 = { review_id: 'r-lgtm', reviewed_head_sha: 'a'.repeat(40), reviewer_verdict: 'lgtm', review_seq: 1 };
  const r1b = { ...r1, review_seq: 2 };
  const state = foldStateEvents([
    stateEvent('review', { review: r1 }),
    stateEvent('review', { review: r1b }),
  ]);
  assert.equal(state.reviews.length, 2);
  assert.deepEqual(state.reviews.map((r) => r.review_seq), [1, 2]);
});

test('issue-111 reviewKey treats legacy records as seq 0 and distinguishes seqs', () => {
  assert.equal(reviewKey({ review_id: 'r', review_seq: 1 }), 'r#1');
  assert.equal(reviewKey({ review_id: 'r' }), 'r#0');
  assert.notEqual(reviewKey({ review_id: 'r', review_seq: 1 }), reviewKey({ review_id: 'r', review_seq: 2 }));
});

// --- issue-pilot#112: merge failure classification ---

test('issue-112 mergeFailureHint classifies ruleset approval failure', () => {
  const hint = mergeFailureHint(
    'Pull request sunSUNQ/issue-pilot#103 is not mergeable: the base branch policy prohibits the merge.',
    { isControlRepo: true },
  );
  assert.match(hint, /approval/);
  assert.match(hint, /ruleset/);
  assert.ok(!/权限不足/.test(hint));
});

test('issue-112 mergeFailureHint classifies required-review / required-check wording', () => {
  assert.match(mergeFailureHint('At least 1 approving review is required', {}), /approval/);
  assert.match(mergeFailureHint('Required status check "contract" is expected', {}), /approval|Required Checks/);
});

test('issue-112 mergeFailureHint classifies permission denial', () => {
  assert.match(
    mergeFailureHint('HTTP 403: Resource not accessible by integration', { isControlRepo: true }),
    /pl-owner-control-write/,
  );
  assert.match(
    mergeFailureHint('Permission denied for this action', { isControlRepo: false }),
    /当前角色 App/,
  );
});

test('issue-112 mergeFailureHint classifies conflicts', () => {
  assert.match(mergeFailureHint('Pull request is not mergeable: merge conflict', {}), /冲突/);
  assert.match(mergeFailureHint('CONFLICTING', {}), /冲突/);
});

test('issue-112 mergeFailureHint preserves unknown errors and ruleset precedence', () => {
  assert.equal(mergeFailureHint('boom', {}), 'boom');
  assert.match(
    mergeFailureHint('Pull request is not mergeable: the base branch policy prohibits the merge.', {}),
    /approval/,
  );
  assert.equal(mergeFailureHint('', {}), 'PR merge 失败（fail-closed，无错误输出）。');
});
