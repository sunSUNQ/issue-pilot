import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  auditFooter, controlRepoAlias, isApprovedReleaseGateFile, labelsOf, mintAppToken, missingRequiredChecks,
  outstandingBlocks, parseArgs, prIdentityViolations, repoAliasOf, repoDescriptor, requiredChecksFromRuleset,
  slugify, tokenState, validReviewerLgtm, verifyLauncherIdentity, writeAudit,
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
