import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function fail(message) {
  throw new Error(message);
}

export const TOKEN_RENEW_MARGIN_MS = 10 * 60 * 1000;

// App-only token policy (R16). The control plane never reads Git Credential
// Manager and never injects OAuth credentials. Under PL_ENFORCE_APP=1 (set by
// the role launchers) a missing/expiring/invalid installation token is renewed
// from the pinned PEM or the command fails closed.
export function tokenState(env, now = Date.now()) {
  if (env.PL_ENFORCE_APP !== '1') return { enforced: false, action: 'passthrough' };
  for (const key of ['PL_APP_ID', 'PL_APP_INSTALLATION_ID', 'PL_APP_KEY_PATH']) {
    if (!env[key]) return { enforced: true, action: 'fail', reason: `PL_ENFORCE_APP=1 但缺少 ${key}（fail-closed）` };
  }
  if (!env.GH_TOKEN) return { enforced: true, action: 'renew', reason: 'GH_TOKEN 缺失' };
  const expiresAt = Date.parse(env.PL_TOKEN_EXPIRES_AT ?? '');
  if (!Number.isFinite(expiresAt)) return { enforced: true, action: 'renew', reason: 'PL_TOKEN_EXPIRES_AT 缺失或非法' };
  if (expiresAt - now < TOKEN_RENEW_MARGIN_MS) {
    return { enforced: true, action: 'renew', reason: `token 将在 ${Math.max(0, Math.round((expiresAt - now) / 60000))} 分钟内到期` };
  }
  return { enforced: true, action: 'ok', expiresAt };
}

function tokenScript() {
  return path.join(root, 'scripts', 'pl-token.mjs');
}

export function mintAppToken(baseEnv) {
  const result = spawnSync(process.execPath, [tokenScript()], {
    encoding: 'utf8',
    windowsHide: true,
    env: baseEnv,
  });
  if (result.status !== 0) {
    return { ok: false, reason: (result.stderr || `exit ${result.status}`).trim() };
  }
  let minted;
  try {
    minted = JSON.parse(result.stdout);
  } catch {
    return { ok: false, reason: 'mint output not parseable（stdout withheld）' };
  }
  return {
    ok: true,
    env: {
      ...baseEnv,
      GH_TOKEN: minted.token,
      PL_GIT_TOKEN: minted.token,
      PL_TOKEN_EXPIRES_AT: minted.expiresAt,
      PL_TOKEN_BOT: minted.bot,
    },
    expiresAt: minted.expiresAt,
    bot: minted.bot,
  };
}

function adoptMintedToken(minted) {
  process.env.GH_TOKEN = minted.env.GH_TOKEN;
  process.env.PL_GIT_TOKEN = minted.env.PL_GIT_TOKEN;
  process.env.PL_TOKEN_EXPIRES_AT = minted.env.PL_TOKEN_EXPIRES_AT;
  process.env.PL_TOKEN_BOT = minted.env.PL_TOKEN_BOT;
}

function ghTokenEnvironment(baseEnv) {
  const state = tokenState(baseEnv);
  if (!state.enforced || state.action === 'ok') return baseEnv;
  if (state.action === 'fail') fail(state.reason);
  const minted = mintAppToken(baseEnv);
  if (!minted.ok) fail(`App token 续签失败（fail-closed，不回退 OAuth）：${minted.reason}`);
  adoptMintedToken(minted);
  return minted.env;
}

export function run(command, args = [], options = {}) {
  let environment = { ...process.env, ...(options.env ?? {}) };
  // tokenContext 'control' binds the control/write App token: no primary-token
  // renewal and no primary-token fallback on 401 (fail-closed instead).
  const control = options.tokenContext === 'control';
  if (command === 'gh' && !control) environment = ghTokenEnvironment(environment);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    input: options.input,
    shell: false,
    windowsHide: true,
    env: environment,
  });
  if (result.error) fail(`${command}: ${result.error.message}`);
  if (result.status !== 0) {
    const output = `${result.stderr || ''}\n${result.stdout || ''}`;
    const rejected = /\b401\b|Bad credentials/i.test(output);
    if (command === 'gh' && process.env.PL_ENFORCE_APP === '1' && !options.noRetry401 && rejected && !control) {
      const minted = mintAppToken(environment);
      if (minted.ok) {
        adoptMintedToken(minted);
        const retryEnv = { ...(options.env ?? {}) };
        delete retryEnv.GH_TOKEN;
        delete retryEnv.PL_GIT_TOKEN;
        return run(command, args, { ...options, noRetry401: true, env: retryEnv });
      }
      if (!options.allowFailure) fail(`gh 认证失败且 App token 重铸失败（fail-closed）：${minted.reason}`);
    }
    if (!options.allowFailure) {
      fail((result.stderr || result.stdout || `${command} exited ${result.status}`).trim());
    }
  }
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

export function runShell(command, cwd) {
  const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
  const args = process.platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-Command', command]
    : ['-lc', command];
  return run(shell, args, { cwd });
}

export function loadConfig() {
  const local = path.join(root, 'config', 'repos.local.json');
  if (!fs.existsSync(local)) {
    fail('缺少 config/repos.local.json；复制 repos.example.json 并填写本机路径。');
  }
  const config = JSON.parse(fs.readFileSync(local, 'utf8'));
  if (!config.issueRepository || !config.worktreeRoot || !config.repositories) {
    fail('repos.local.json 缺少 issueRepository、worktreeRoot 或 repositories。');
  }
  return config;
}

export function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith('--')) {
      positionals.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else {
      flags[key] = next;
      i += 1;
    }
  }
  return { positionals, flags };
}

export function slugify(value) {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || 'work';
}

export function labelsOf(issue) {
  return (issue.labels ?? []).map((label) => typeof label === 'string' ? label : label.name);
}

// Owner-authorized exception for issue-pilot#101 / PR #103 only.
const GOVERNANCE_V2_RELEASE_DOCS = new Set([
  'policies/governance-v2/acceptance-matrix.md',
  'policies/governance-v2/consistency-report.md',
  'policies/governance-v2/design.md',
  'policies/governance-v2/reviewer-bot-design.md',
  'policies/governance-v2/revision-notes.md',
  'policies/governance-v2/sha256-list.md',
]);

export function isApprovedReleaseGateFile(repository, prNumber, filePath) {
  return repository === 'sunSUNQ/issue-pilot'
    && prNumber === 103
    && GOVERNANCE_V2_RELEASE_DOCS.has(filePath);
}

export function repoAliasOf(issue, config) {
  const labels = labelsOf(issue);
  const label = labels.find((item) => item.startsWith('repo:'));
  if (!label) fail(`Issue #${issue.number} 缺少 repo:<alias> label。`);
  const alias = label.slice(5);
  if (!config.repositories[alias] && alias !== controlRepoAlias(config)) {
    fail(`repos.local.json 未注册仓库 ${alias}。`);
  }
  return alias;
}

// ---------------------------------------------------------------------------
// R3 — control-repo self-route（governance-v2 控制仓发布 PR 路由）
// ---------------------------------------------------------------------------

// The control repo (config.issueRepository) is addressable as a target repo via
// the `repo:<alias>` label when <alias> equals the issueRepository's short repo
// name (e.g. `repo:issue-pilot` for `sunSUNQ/issue-pilot`). This is the only
// alias that resolves WITHOUT an entry in config.repositories.
export function controlRepoAlias(config) {
  return (config.issueRepository ?? '').split('/').pop() ?? '';
}

// Resolve a repo alias to a descriptor. Product repos come from
// config.repositories (registered aliases win, unchanged). The control repo is
// synthesized (isControlRepo=true) when the alias matches controlRepoAlias.
// Unknown aliases still fail closed.
export function repoDescriptor(config, alias) {
  const product = config.repositories[alias];
  if (product) {
    return {
      alias,
      isControlRepo: false,
      github: product.github,
      base: product.base ?? 'main',
      policy: product.policy ?? alias,
      checks: product.checks ?? [],
      path: product.path,
    };
  }
  if (alias && alias === controlRepoAlias(config)) {
    return {
      alias,
      isControlRepo: true,
      github: config.issueRepository,
      base: 'main',
      policy: 'governance-v2',
      checks: [],
      path: root,
    };
  }
  fail(`repos.local.json 未注册仓库 ${alias}。`);
}

// propose --repo resolution: registered product aliases and the control-repo
// self-route (e.g. issue-pilot) both resolve through repoDescriptor. Unknown
// aliases fail closed as before.
export function resolveProposeRepo(config, alias) {
  if (!alias) fail('propose 需要 --repo <alias>。');
  return repoDescriptor(config, alias);
}

// Control-repo submit transport gate (issue-pilot#110). The worker product App
// is not installed on the control repo and the control-write App is Issues-only,
// so git push / PR creation would fail only after side effects. Return an
// explicit refusal before any side effect and hand transport to the existing
// Owner-run release launcher; the resulting PR is bound with `bind`.
export function controlRepoSubmitRefusal(repo, number, branch) {
  if (!repo?.isControlRepo) return null;
  return [
    `控制仓 ${repo.github} 的 submit 需要 release launcher 传输（fail-closed）：`,
    '- 当前 worker 会话的 product App 未安装到控制仓；control-write App 仅 Issues 写权限。',
    '- 未执行任何 git push / PR 创建 / 标签或 state 变更。',
    '',
    '请 Issue Owner 使用既有 release launcher 完成传输：',
    `  1) 从 worktree 推送分支 \`${branch}\`（base \`${repo.base}\`）`,
    `  2) 以 base \`${repo.base}\` 创建 PR`,
    '  3) 记录 PR 号与分支 HEAD SHA，然后执行显式绑定：',
    `     npm run pilot -- bind ${number} --pr <PR_NUMBER> --branch ${branch} --base ${repo.base} --sha <HEAD_SHA>`,
  ].join('\n');
}

// R3 — PR identity / uniqueness validation (pure, testable). `expected` pins the
// fields the caller resolved the PR by (repository / number / base / head branch /
// HEAD SHA — each optional). Returns an array of human-readable violations; an
// empty array means the PR matches every pinned field.
export function prIdentityViolations(pr, expected = {}) {
  const violations = [];
  if (expected.repository && pr.repository !== expected.repository) {
    violations.push(`PR #${pr.number} 不属于仓库 ${expected.repository}（实际 ${pr.repository}）`);
  }
  if (expected.number != null && expected.number !== pr.number) {
    violations.push(`PR #${pr.number} != 期望 PR #${expected.number}`);
  }
  if (expected.base && pr.baseRefName !== expected.base) {
    violations.push(`PR #${pr.number} base ${pr.baseRefName} != 期望 ${expected.base}`);
  }
  if (expected.head && pr.headRefName !== expected.head) {
    violations.push(`PR #${pr.number} head branch ${pr.headRefName} != 期望 ${expected.head}`);
  }
  if (expected.sha && pr.headRefOid !== expected.sha) {
    violations.push(`PR #${pr.number} HEAD ${pr.headRefOid} != 期望 ${expected.sha}`);
  }
  return violations;
}

// R3 — per-repo GitHub accessor. Control-repo (config.issueRepository)
// operations bind the control/write App token; product repos keep the primary
// product token (unchanged).
export function repoAccess(config, repo) {
  return repo.isControlRepo ? controlGh : productGh;
}

export const PR_JSON_FIELDS = 'number,url,headRefOid,headRefName,baseRefName,state';

// Parse `owner/repo` from a GitHub PR URL. Used to validate the API-returned PR
// against the pinned repository instead of trusting a caller-assigned field.
export function prRepositoryFromUrl(url) {
  const match = /^https?:\/\/[^/]+\/([^/]+\/[^/]+)\/pull\/\d+(?:\/)?(?:[?#].*)?$/.exec(url ?? '');
  return match?.[1] ?? null;
}

// R3 — binding record persisted by `bind` (and by `submit` for product PRs).
// Every identity field comes from the API response, never from flags, so
// `findPr` can pin repository / number / base / head branch / HEAD SHA.
export function bindingRecord(pr, identity = {}, now = new Date().toISOString()) {
  return {
    prNumber: pr.number,
    prUrl: pr.url,
    prBranch: pr.headRefName,
    prBase: pr.baseRefName,
    prHeadSha: pr.headRefOid,
    boundAt: now,
    boundBy: identity.principal ?? null,
    boundWriter: identity.writeTokenBot ?? identity.tokenBot ?? null,
  };
}

// R3 — resolve the PR for an issue + repo. Two modes:
//   1. Explicit binding (state.prNumber): used by control-repo release PRs and
//      by product PRs after `submit`. Fetches the pinned PR and fails closed on
//      any repository / number / base / head branch / HEAD SHA mismatch.
//      requireOpen defaults to true for the control repo (release PRs are only
//      actionable while OPEN); merged-PR consumers (autoVerify) pass false.
//   2. Branch inference (product repos without a binding): unchanged legacy
//      behavior keyed on issue-pilot/<n>-<slug>; multiple open PRs fail closed.
// `opts.gh` injects a fake gh runner for tests.
export function findPr(config, repo, number, item, state, opts = {}) {
  const gh = opts.gh ?? repoAccess(config, repo);

  if (state?.prNumber != null) {
    const pr = JSON.parse(gh(['pr', 'view', String(state.prNumber), '-R', repo.github,
      '--json', PR_JSON_FIELDS]).stdout);
    const repository = prRepositoryFromUrl(pr.url);
    const violations = prIdentityViolations({ ...pr, repository }, {
      repository: repo.github,
      number: state.prNumber,
      base: state.prBase ?? repo.base,
      head: state.prBranch ?? null,
      sha: state.prHeadSha ?? null,
    });
    if (violations.length) fail(`PR 身份校验失败（fail-closed）：\n- ${violations.join('\n- ')}`);
    const requireOpen = opts.requireOpen ?? repo.isControlRepo;
    if (requireOpen && pr.state !== 'OPEN') fail(`PR #${pr.number} 状态 ${pr.state}`);
    return { ...pr, repository: repo.github };
  }

  if (repo.isControlRepo) {
    fail(`控制仓 ${repo.github} 的 Issue #${number} 未绑定 PR（fail-closed）。\n`
      + '请先执行显式绑定（PR 号见发布 PR）：\n'
      + `  npm run pilot -- bind ${number} --pr <PR_NUMBER> --branch <HEAD_BRANCH> --base ${repo.base} --sha <HEAD_SHA>`);
  }

  const branch = `issue-pilot/${number}-${slugify(item.title)}`;
  const out = gh(['pr', 'list', '-R', repo.github, '--head', branch,
    '--state', 'all', '--json', PR_JSON_FIELDS], { allowFailure: true });
  const prs = JSON.parse(out.stdout || '[]');
  const open = prs.filter((pr) => pr.state === 'OPEN');
  if (open.length > 1) fail(`PR 歧义：分支 \`${branch}\` 有 ${open.length} 个开放 PR（需显式绑定 prNumber）`);
  const pr = open[0] ?? prs[0] ?? null;
  if (pr) pr.repository = repo.github;
  return pr;
}

export function issue(config, number) {
  const text = controlGh([
    'issue', 'view', String(number), '-R', config.issueRepository,
    '--json', 'number,title,body,labels,assignees,url,state',
  ]).stdout;
  return JSON.parse(text);
}

export function setStatus(config, number, status) {
  const current = issue(config, number);
  const statuses = labelsOf(current).filter((label) => label.startsWith('status:'));
  for (const label of statuses) {
    controlGh(['issue', 'edit', String(number), '-R', config.issueRepository, '--remove-label', label]);
  }
  controlGh(['issue', 'edit', String(number), '-R', config.issueRepository, '--add-label', `status:${status}`]);
}

export function setNeed(config, number, need) {
  const current = issue(config, number);
  const needs = labelsOf(current).filter((label) => label.startsWith('need:'));
  for (const label of needs) {
    controlGh(['issue', 'edit', String(number), '-R', config.issueRepository, '--remove-label', label]);
  }
  if (need) {
    controlGh(['issue', 'edit', String(number), '-R', config.issueRepository, '--add-label', `need:${need}`]);
  }
}

// ---------------------------------------------------------------------------
// Governance V2 identity / assignee / dual-token helpers
// (frozen: policies/governance-v2/reviewer-bot-design.md §3–§4)
// ---------------------------------------------------------------------------

// Per-role hard-pinned governance principal (R7 role-specific check).
const ROLE_PRINCIPALS = {
  reviewer: 'pl-issue-reviewer[bot]',
  owner: 'sunSUNQ',
  worker: 'pl-issue-worker[bot]',
};

// Per-role control/write App bot — the actual GitHub actor for control-repo
// (config.issueRepository) writes. Distinct from the product App bot; see
// policies/governance-v2/reviewer-bot-design.md §3 and the Plan-A six-App model.
const ROLE_WRITE_BOTS = {
  reviewer: 'pl-issue-reviewer-write[bot]',
  owner: 'pl-owner-control-write[bot]',
  worker: 'pl-worker-control-write[bot]',
};

// Per-role product/READ App bot — the actual GitHub actor for product-repo
// (config.repositories[*]) reads/writes. Distinct from ROLE_WRITE_BOTS (control
// repo) and from ROLE_PRINCIPALS (the governance principal). Hard-pinned in the
// role launchers (start-{worker,reviewer,owner}-agent.ps1).
const ROLE_READ_BOTS = {
  reviewer: 'pl-issue-reviewer-read[bot]',
  owner: 'pl-owner-reviewer[bot]',
  worker: 'pl-issue-worker[bot]',
};

// GitHub principal namespace: a human login or a bot login (`<name>[bot]`).
// Rejects free-form strings so PL_PRINCIPAL is only ever compared against
// assignees in the same namespace (reviewer-bot-design.md §3 "命名空间").
const GITHUB_PRINCIPAL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\[bot\])?$/;

export function isGitHubPrincipal(value) {
  return typeof value === 'string' && GITHUB_PRINCIPAL_RE.test(value);
}

// Issue Owner semantics (Plan A fix): the assignee is the Issue Owner — the
// human responsible for the issue lifecycle — NOT the bot that happens to run
// the command. `propose` must receive an explicit, human GitHub login; never
// default to `@me` / the control-write App bot. Fail-closed otherwise.
export function requireIssueOwner(assignee) {
  if (!assignee || !isGitHubPrincipal(assignee) || /\[bot\]$/.test(assignee)) {
    fail('propose 必须显式 --assignee <owner-login>（Issue Owner 须为人类登录名，fail-closed；禁止 bot）');
  }
  return assignee;
}

// Query the real login a GitHub token acts as, trusting only GitHub's answer —
// never any caller-set PL_* env var. Uses `gh api graphql` (no credential read
// from disk; the token is passed in-memory via env). Any anomaly fails closed.
function resolveTokenLoginDefault(token, kind, env) {
  const result = run('gh', ['api', 'graphql', '-f', 'query=query{viewer{login}}'], {
    env: { ...env, GH_TOKEN: token, GITHUB_TOKEN: token },
    tokenContext: 'control',
    noRetry401: true,
    allowFailure: true,
  });
  if (result.status !== 0) {
    fail(`身份校验失败：${kind} token 真实身份查询失败（fail-closed）：${(result.stderr || `exit ${result.status}`).trim()}`);
  }
  let login = '';
  try { login = JSON.parse(result.stdout)?.data?.viewer?.login ?? ''; } catch { login = ''; }
  if (!login) fail(`身份校验失败：${kind} token 无法解析真实登录名（fail-closed）`);
  return login;
}

// verifyLauncherIdentity — generic + role-specific launcher identity checks.
// Fail-closed on any anomaly (R7 constraints 1–6 / §4 通用校验 + 角色专属校验).
//
// P1-1: the ACTUAL token identity is resolved from GitHub and bound to the role
// via hard-pinned ROLE_READ_BOTS / ROLE_WRITE_BOTS. Caller-set PL_TOKEN_BOT /
// PL_EXPECTED_BOT / PL_WRITE_TOKEN_BOT / PL_WRITE_EXPECTED_BOT are NOT trusted
// as evidence of identity. Any mismatch fails closed.
// Returns the normalized identity (role / principal / githubLogin / tokenBot).
export function verifyLauncherIdentity(env = process.env, opts = {}) {
  if (env.PL_ENFORCE_APP !== '1') {
    fail('身份校验失败：PL_ENFORCE_APP != 1（非 Launcher 会话，fail-closed）');
  }
  const role = env.PL_ROLE;
  if (!['worker', 'reviewer', 'owner'].includes(role)) {
    fail(`身份校验失败：PL_ROLE 缺失或非法（${role ?? '(unset)'}）`);
  }
  const principal = env.PL_PRINCIPAL;
  const expectedPrincipal = ROLE_PRINCIPALS[role];
  if (opts.requirePrincipal !== false) {
    if (!principal) fail(`身份校验失败：PL_PRINCIPAL 缺失（role=${role}）`);
    if (!isGitHubPrincipal(principal)) fail(`身份校验失败：PL_PRINCIPAL 非法主体形态（${principal}）`);
    if (principal !== expectedPrincipal) {
      fail(`身份校验失败：PL_PRINCIPAL 与 role 不符（${principal}，期望 ${expectedPrincipal}）`);
    }
  }

  const resolve = opts.resolveTokenLogin ?? resolveTokenLoginDefault;

  // 主（product/read）token 的真实身份必须等于该角色钉扎的 READ bot。
  const primaryToken = env.PL_GIT_TOKEN || env.GH_TOKEN || null;
  if (!primaryToken) fail('身份校验失败：主 token 缺失（fail-closed）');
  const primaryExpected = ROLE_READ_BOTS[role];
  const primaryLogin = resolve(primaryToken, 'read', env);
  if (!primaryLogin) fail('身份校验失败：主 token 无法解析真实身份（fail-closed）');
  if (primaryLogin !== primaryExpected) {
    fail(`身份校验失败：主 token 真实身份 ${primaryLogin} 与 role=${role} 不符（期望 ${primaryExpected}，fail-closed）`);
  }

  // 写（control）token 的真实身份必须等于该角色钉扎的 WRITE bot（双 App 模型）。
  let writeLogin = null;
  if (env.PL_WRITE_GIT_TOKEN) {
    const writeExpected = ROLE_WRITE_BOTS[role];
    writeLogin = resolve(env.PL_WRITE_GIT_TOKEN, 'write', env);
    if (!writeLogin) fail('身份校验失败：写侧 token 无法解析真实身份（fail-closed）');
    if (writeLogin !== writeExpected) {
      fail(`身份校验失败：写侧 token 真实身份 ${writeLogin} 与 role=${role} 不符（期望 ${writeExpected}，fail-closed）`);
    }
  }

  return {
    role,
    principal,
    githubLogin: env.PL_GITHUB_LOGIN || primaryLogin,
    tokenBot: primaryLogin,
    // 实际执行 GitHub 写操作的身份（reviewer 双 App 为写侧 bot；单 App 为 null）
    writeTokenBot: writeLogin,
  };
}

// Owner-only command gate (issue-pilot#108). Direct `approve` / `verify` /
// `close` must run in an Owner launcher session. Solo Mode uses the explicit
// *Internal functions in cli.mjs from advanceOnce (solo + scope gated) instead
// of this gate, so the delegated path never reuses an unchecked entry point.
export function assertOwnerIdentity(env = process.env, opts = {}) {
  const identity = verifyLauncherIdentity(env, opts);
  if (identity.role !== 'owner') {
    fail(`需要 Owner launcher（PL_ROLE=owner），当前 role=${identity.role}（fail-closed）`);
  }
  return identity;
}

// G11 — control-repo write audit. Every control-repo (config.issueRepository)
// write must expose the traceable chain role -> principal -> writer_login ->
// repository -> operation (not just review). Calls verifyLauncherIdentity, so
// any control-repo write outside a valid launcher session fails closed.
export function writeAudit(config, operation, env = process.env, opts = {}) {
  const identity = verifyLauncherIdentity(env, opts);
  return {
    role: identity.role,
    principal: identity.principal,
    writer_login: identity.writeTokenBot ?? identity.tokenBot,
    repository: config.issueRepository,
    operation,
  };
}

// Markdown footer built from an already-verified audit record.
export function auditFooterFrom(audit) {
  return [
    '',
    '---',
    '<sub>control-plane audit</sub>',
    `role=\`${audit.role}\` principal=\`${audit.principal}\` writer_login=\`${audit.writer_login}\` repository=\`${audit.repository}\` operation=\`${audit.operation}\``,
  ].join('\n');
}

// Markdown footer appended to every control-repo operation comment (audit trail).
export function auditFooter(config, operation, env = process.env, opts = {}) {
  return auditFooterFrom(writeAudit(config, operation, env, opts));
}

// Assert the CLI was not handed an external --role/--principal override.
// Launcher identity is hard-pinned; any attempted override must fail closed.
export function assertNoRoleOverride(flags) {
  if (flags.role !== undefined || flags.principal !== undefined) {
    fail('拒绝 --role/--principal 覆盖（Launcher 身份硬钉，fail-closed）');
  }
}

export function assigneesOf(issue) {
  return (issue.assignees ?? []).map((a) => (typeof a === 'string' ? a : a.login));
}

// decision ④: the sole assignee is the issue-owner routing key. 0 or >1
// assignees block owner-gated transitions (approve/verify/close/review).
export function assertSingleAssignee(issue) {
  const assignees = assigneesOf(issue);
  if (assignees.length === 0) fail(`#${issue.number} 无 assignee（决策④：0 assignee 阻止转换）`);
  if (assignees.length > 1) fail(`#${issue.number} 有 ${assignees.length} 个 assignee（决策④：>1 assignee 阻止转换）`);
  return assignees[0];
}

// Write-side token env for control-repo comment/label writes. The reviewer
// read App has no Issues permission, so control-repo writes must use the
// write App token (PL_WRITE_GIT_TOKEN). Fail-closed if absent.
export function writeTokenEnv(env = process.env) {
  if (!env.PL_WRITE_GIT_TOKEN) fail('PL_WRITE_GIT_TOKEN 缺失（写侧 token，fail-closed）');
  return { GH_TOKEN: env.PL_WRITE_GIT_TOKEN, PL_GIT_TOKEN: env.PL_WRITE_GIT_TOKEN };
}

// Control-repo access entry point. Binds ALL control-repo (config.issueRepository)
// reads + writes to the control/write App token (PL_WRITE_GIT_TOKEN). Fail-closed
// if absent — never falls back to the product token. No primary-token renewal/retry.
export function controlGh(args, options = {}) {
  const wEnv = writeTokenEnv({ ...process.env, ...(options.env ?? {}) });
  return run('gh', args, { ...options, env: wEnv, tokenContext: 'control' });
}

// Product-repo access entry point. Binds ALL product-repo (config.repositories[*])
// operations to the primary product App token (GH_TOKEN, with renewal + retry).
export function productGh(args, options = {}) {
  return run('gh', args, options);
}

// Required-checks extraction from a single ruleset DETAIL object (pure, testable).
// The GitHub rulesets LIST endpoint returns only a summary (no `conditions`/`rules`),
// so callers must fetch each ruleset's DETAIL first. Returns the required_status_checks
// entries ({ context, integration_id|null }) when the ruleset applies to `base`;
// otherwise [].
export function requiredChecksFromRuleset(rs, base) {
  if (rs.enforcement !== 'active') return [];
  if (rs.target !== 'branch') return [];
  const include = rs.conditions?.ref_name?.include ?? [];
  if (!(include.includes('~DEFAULT_BRANCH') || include.includes(base))) return [];
  const out = [];
  for (const rule of rs.rules ?? []) {
    if (rule.type !== 'required_status_checks') continue;
    for (const sc of rule.parameters?.required_status_checks ?? []) {
      out.push({ context: sc.context, integration_id: sc.integration_id ?? null });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// P1-2 / G10 pure helpers (testable without network)
// ---------------------------------------------------------------------------

// validReviewerLgtm — a reviewer LGTM is valid only if it is that reviewer's
// LATEST verdict for the given head SHA. Any later CHANGES/BLOCKED from the same
// reviewer on the same SHA supersedes (invalidates) an earlier LGTM. Records are
// isolated by (role, principal, reviewed_head_sha). Replaces the old
// "filter(lgtm).pop()" logic, which could not see a later non-LGTM verdict.
export function validReviewerLgtm(state, headSha) {
  const reviews = state.reviews ?? [];
  const latest = new Map();
  for (const r of reviews) {
    const key = `${r.launcher_role ?? ''}\u0000${r.principal ?? ''}\u0000${r.reviewed_head_sha ?? ''}`;
    // Reviews are appended in order: a later element is a later review -> overwrite.
    latest.set(key, r);
  }
  for (const r of latest.values()) {
    if (r.reviewer_verdict === 'lgtm' && r.launcher_role === 'reviewer' && r.reviewed_head_sha === headSha) {
      return r;
    }
  }
  return null;
}

// outstandingBlocks — reviewers whose LATEST verdict for headSha is a blocking
// verdict (changes / blocked). Both block merge, per Owner rule:
//   - LGTM    -> valid approval.
//   - CHANGES -> block merge until that reviewer's subsequent LGTM.
//   - BLOCKED -> block merge until the blocker is resolved and review completes
//                (BLOCKED is NOT a code defect, but it is NOT an approval either).
// A block is NOT cleared by a DIFFERENT reviewer's LGTM; only the same reviewer's
// later LGTM on the same SHA clears it. Records isolated per (role, principal, sha).
export function outstandingBlocks(state, headSha) {
  const reviews = state.reviews ?? [];
  const latest = new Map();
  for (const r of reviews) {
    const key = `${r.launcher_role ?? ''}\u0000${r.principal ?? ''}\u0000${r.reviewed_head_sha ?? ''}`;
    latest.set(key, r);
  }
  const blockers = [];
  for (const r of latest.values()) {
    if (r.reviewed_head_sha !== headSha) continue;
    if (r.reviewer_verdict === 'changes' || r.reviewer_verdict === 'blocked') {
      blockers.push({ principal: r.principal, verdict: r.reviewer_verdict });
    }
  }
  return blockers;
}

// Latest check run for a (context, integration_id) group, independent of API
// order. Recency key is the run `id` (monotonic: a re-run gets a HIGHER id and is
// always present), with `started_at` as tiebreak. This matters: a pending/in-
// progress re-run has completed_at=null, so sorting by completed_at would push it
// to the bottom and let an earlier success mask it. Sorting by id keeps the newest
// (possibly still-running) run authoritative -> fail-closed on pending.
function latestCheckRun(runs) {
  return [...runs].sort((a, b) => {
    const idA = Number(a.id) || 0;
    const idB = Number(b.id) || 0;
    if (idA !== idB) return idB - idA;
    const ta = Date.parse(a.started_at ?? '') || 0;
    const tb = Date.parse(b.started_at ?? '') || 0;
    return tb - ta;
  })[0];
}

// Latest commit status for a context, independent of API order (updated_at desc).
function latestCommitStatus(statuses) {
  return [...statuses].sort((a, b) => {
    const ta = Date.parse(a.updated_at ?? a.created_at ?? '') || 0;
    const tb = Date.parse(b.updated_at ?? b.created_at ?? '') || 0;
    return tb - ta;
  })[0];
}

// missingRequiredChecks — evaluate required checks against check runs + commit
// statuses, fail-closed. Returns human-readable failures (empty = all satisfied).
// Rules:
//   - A required check is satisfied only by its LATEST run/status (re-run aware).
//   - Only conclusion 'success' (runs) / state 'success' (statuses) satisfies.
//   - pending / queued / in_progress / skipped / neutral / failure / missing are
//     all fail-closed (non-satisfying).
//   - Grouping is by (context, integration_id); same-name checks from different
//     Apps are independent.
export function missingRequiredChecks(required, checkRuns, statuses) {
  const missing = [];
  for (const { context, integration_id } of required) {
    const runs = checkRuns.filter((c) =>
      c.name === context && (integration_id == null || (c.app?.id ?? null) === integration_id));
    if (runs.length > 0) {
      const latest = latestCheckRun(runs);
      if (latest.status !== 'completed') {
        missing.push(`${context}: status=${latest.status}（未完成）`);
      } else if (latest.conclusion !== 'success') {
        missing.push(`${context}: conclusion=${latest.conclusion ?? '(null)'}（非 success，fail-closed）`);
      }
      continue;
    }
    if (integration_id == null) {
      const matching = statuses.filter((s) => s.context === context);
      if (matching.length > 0) {
        const latest = latestCommitStatus(matching);
        if (latest.state !== 'success') {
          missing.push(`${context}: state=${latest.state ?? '(null)'}（非 success）`);
        }
        continue;
      }
    }
    missing.push(`${context}: 缺失或不成功（integration_id=${integration_id ?? 'null'}）`);
  }
  return missing;
}

// decision ④ / E15：assignee 变化时记录 OwnerTransfer 事件（审计留痕）。
// 首次记录当前 assignee 作为基线；后续变化 append 到 state.ownerTransfers。
export function detectOwnerTransfer(config, alias, number, issue) {
  const assignee = assigneesOf(issue)[0] ?? null;
  const state = loadState(config, alias, number);
  if (state.assignee && assignee && state.assignee !== assignee) {
    const entry = { from: state.assignee, to: assignee, at: new Date().toISOString() };
    saveState(config, alias, number, { assignee, ownerTransfers: [...(state.ownerTransfers ?? []), entry] });
    return entry;
  }
  if (assignee) saveState(config, alias, number, { assignee });
  return null;
}

export function worktreePath(config, alias, number) {
  return path.resolve(config.worktreeRoot, `${alias}-${number}`);
}

export function ensurePathOnD(target) {
  if (process.platform === 'win32' && !/^D:\\/i.test(path.resolve(target))) {
    fail(`临时/worktree 路径必须在 D 盘：${target}`);
  }
}

export function parseSoloScope(text) {
  const line = text.match(/^\s*>?\s*生效范围：([^\r\n]*)/m)?.[1];
  if (!line) return [];
  const alias = line.match(/repo:([a-z0-9][a-z0-9-]*)/i)?.[1];
  return alias ? [alias.toLowerCase()] : [];
}

export function soloScopeAllows(solo, alias) {
  return Array.isArray(solo?.scope) && solo.scope.includes(alias);
}

export function soloMode() {
  const file = path.join(root, 'policies', 'solo-mode.md');
  if (!fs.existsSync(file)) return { enabled: false, phase: 'absent', scope: [] };
  const text = fs.readFileSync(file, 'utf8');
  const head = text.split(/\r?\n/).slice(0, 4).join('\n');
  const scope = parseSoloScope(text);
  if (head.includes('> 状态：**ACTIVE')) return { enabled: true, phase: 'active', scope };
  if (head.includes('> 状态：**PILOT')) return { enabled: true, phase: 'pilot', scope };
  return { enabled: false, phase: 'draft', scope };
}

export function statePath(config, alias, number) {
  return path.join(root, 'config', 'state', `${alias}-${number}.json`);
}

export function loadState(config, alias, number) {
  const file = statePath(config, alias, number);
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function saveState(config, alias, number, patch) {
  const file = statePath(config, alias, number);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = loadState(config, alias, number);
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

// ---------------------------------------------------------------------------
// Governance state blocks + rebuild (issue-pilot#122, design v1)
// ---------------------------------------------------------------------------

export const STATE_SCHEMA = 'issue-pilot/state@1';
export const STATE_TYPES = new Set(['binding', 'ci', 'review', 'merge', 'run', 'owner-transfer', 'verify']);
const STATE_BLOCK_LINE_RE = /^<!-- issue-pilot-state:v1 ([A-Za-z0-9+/=]+) -->\r?$/;
const STATE_HASH_RE = /^sha256:[0-9a-f]{64}$/;
const FOOTER_FIELDS_RE = /role=`([^`]+)` principal=`([^`]+)` writer_login=`([^`]+)` repository=`([^`]+)` operation=`([^`]+)`/g;

export function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) out[key] = stripUndefined(item);
    }
    return out;
  }
  return value;
}

// Deterministic JSON: recursively sorted keys, no insignificant whitespace.
export function canonicalJson(value) {
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'number') {
    if (!Number.isFinite(value)) fail('canonicalJson: NaN/Infinity 不允许');
    return JSON.stringify(value);
  }
  if (type === 'string' || type === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (type === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  fail(`canonicalJson: 不支持的类型 ${type}`);
}

export function extractStateBlocks(body) {
  const blocks = [];
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const match = STATE_BLOCK_LINE_RE.exec(line);
    if (match) blocks.push(match[1]);
  }
  return blocks;
}

export function removeStateBlockLines(body) {
  return String(body ?? '')
    .split(/\r?\n/)
    .filter((line) => !STATE_BLOCK_LINE_RE.test(line))
    .join('\n');
}

export function normalizeBodyForHash(body) {
  const lines = removeStateBlockLines(body)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.length ? `${lines.join('\n')}\n` : '';
}

export function encodeStateBlock(envelope) {
  const payload = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
  return `<!-- issue-pilot-state:v1 ${payload} -->`;
}

export function appendStateBlock(visibleBody, envelope) {
  return `${String(visibleBody).replace(/\s+$/, '')}\n\n${encodeStateBlock(envelope)}\n`;
}

// Build the envelope. `meta` carries issue/alias/type/payload + the verified
// audit identity. body_sha256 covers the visible body (including audit footer)
// with the state block removed.
export function makeStateEnvelope(meta, visibleBody, at = new Date().toISOString()) {
  const payload = stripUndefined(meta.payload ?? {});
  const base = {
    schema: STATE_SCHEMA,
    issue: meta.issue,
    repository: meta.repository,
    alias: meta.alias,
    type: meta.type,
    operation: meta.operation,
    role: meta.role,
    principal: meta.principal,
    writer_login: meta.writer_login,
    at,
    payload,
  };
  return {
    schema: STATE_SCHEMA,
    event_id: `sha256:${sha256Hex(canonicalJson(base))}`,
    issue: base.issue,
    repository: base.repository,
    alias: base.alias,
    type: base.type,
    operation: base.operation,
    role: base.role,
    principal: base.principal,
    writer_login: base.writer_login,
    at: base.at,
    body_sha256: `sha256:${sha256Hex(normalizeBodyForHash(visibleBody))}`,
    payload,
  };
}

// Full comment body for a state-bearing control-plane write: visible text +
// existing audit footer + hidden state block. Verifies the launcher identity
// once (via writeAudit).
export function stateComment(config, operation, meta, body, env = process.env, opts = {}) {
  const audit = writeAudit(config, operation, env, opts);
  const visible = `${body}${auditFooterFrom(audit)}`;
  const envelope = makeStateEnvelope({
    issue: meta.issue,
    repository: audit.repository,
    alias: meta.alias,
    type: meta.type,
    operation,
    role: audit.role,
    principal: audit.principal,
    writer_login: audit.writer_login,
    payload: meta.payload,
  }, visible);
  return appendStateBlock(visible, envelope);
}

function normalizeBotLogin(login) {
  if (typeof login !== 'string') return '';
  const stripped = login.replace(/^app\//, '');
  return stripped.endsWith('[bot]') ? stripped : `${stripped}[bot]`;
}

// Validate one comment: author pinning, footer cross-check, body_sha256 and
// event_id. Returns null for legacy comments (no block), throws fail-closed
// for malformed/forged blocks.
export function validateStateComment(comment, context) {
  const body = String(comment.body ?? '');
  const blocks = extractStateBlocks(body);
  if (blocks.length === 0) return null;
  if (blocks.length > 1) fail(`评论 ${comment.id} 含 ${blocks.length} 个状态块（fail-closed）`);

  const decoded = Buffer.from(blocks[0], 'base64');
  if (decoded.toString('base64') !== blocks[0]) fail(`评论 ${comment.id} 状态块 Base64 非规范编码（fail-closed）`);
  let envelope;
  try {
    envelope = JSON.parse(decoded.toString('utf8'));
  } catch {
    fail(`评论 ${comment.id} 状态块 JSON 非法（fail-closed）`);
  }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    fail(`评论 ${comment.id} 状态块不是 JSON 对象（fail-closed）`);
  }
  if (envelope.schema !== STATE_SCHEMA) fail(`评论 ${comment.id} schema 未知：${envelope.schema}`);
  if (envelope.issue !== context.issue) fail(`评论 ${comment.id} issue 不匹配`);
  if (envelope.repository !== context.repository) fail(`评论 ${comment.id} repository 不匹配`);
  if (envelope.alias !== context.alias) fail(`评论 ${comment.id} alias 不匹配`);
  if (!STATE_TYPES.has(envelope.type)) fail(`评论 ${comment.id} type 未知：${envelope.type}`);
  if (typeof envelope.operation !== 'string' || !envelope.operation) fail(`评论 ${comment.id} operation 非法`);
  if (!Object.prototype.hasOwnProperty.call(ROLE_PRINCIPALS, envelope.role)) fail(`评论 ${comment.id} role 未知：${envelope.role}`);
  if (envelope.principal !== ROLE_PRINCIPALS[envelope.role]) fail(`评论 ${comment.id} principal 与 role 不符`);
  if (envelope.writer_login !== ROLE_WRITE_BOTS[envelope.role]) fail(`评论 ${comment.id} writer_login 与 role 不符`);
  if (typeof envelope.at !== 'string' || !Number.isFinite(Date.parse(envelope.at))) fail(`评论 ${comment.id} at 非法`);
  if (!envelope.payload || typeof envelope.payload !== 'object' || Array.isArray(envelope.payload)) {
    fail(`评论 ${comment.id} payload 非法`);
  }
  if (!STATE_HASH_RE.test(String(envelope.event_id))) fail(`评论 ${comment.id} event_id 格式非法`);
  if (!STATE_HASH_RE.test(String(envelope.body_sha256))) fail(`评论 ${comment.id} body_sha256 格式非法`);

  const author = normalizeBotLogin(comment.user?.login);
  const writeBots = new Set(Object.values(ROLE_WRITE_BOTS));
  if (!writeBots.has(author)) fail(`评论 ${comment.id} 作者 ${author || '(unknown)'} 不在钉扎写侧 bot 集合（fail-closed）`);
  if (author !== envelope.writer_login) fail(`评论 ${comment.id} 作者与 writer_login 不一致（fail-closed）`);

  const visible = removeStateBlockLines(body);
  const footers = [...visible.matchAll(FOOTER_FIELDS_RE)];
  if (footers.length !== 1) fail(`评论 ${comment.id} 审计 footer 数量=${footers.length}（fail-closed）`);
  const footer = {
    role: footers[0][1],
    principal: footers[0][2],
    writer_login: footers[0][3],
    repository: footers[0][4],
    operation: footers[0][5],
  };
  for (const key of ['role', 'principal', 'writer_login', 'repository', 'operation']) {
    if (footer[key] !== envelope[key]) fail(`评论 ${comment.id} 审计 footer ${key} 不一致（fail-closed）`);
  }

  const bodyHash = `sha256:${sha256Hex(normalizeBodyForHash(body))}`;
  if (envelope.body_sha256 !== bodyHash) fail(`评论 ${comment.id} body_sha256 不一致（fail-closed）`);

  const base = {
    schema: envelope.schema,
    issue: envelope.issue,
    repository: envelope.repository,
    alias: envelope.alias,
    type: envelope.type,
    operation: envelope.operation,
    role: envelope.role,
    principal: envelope.principal,
    writer_login: envelope.writer_login,
    at: envelope.at,
    payload: envelope.payload,
  };
  if (envelope.event_id !== `sha256:${sha256Hex(canonicalJson(base))}`) {
    fail(`评论 ${comment.id} event_id 不一致（fail-closed）`);
  }
  if (!Number.isFinite(Date.parse(comment.created_at ?? ''))) fail(`评论 ${comment.id} created_at 非法（fail-closed）`);
  return envelope;
}

// Parse and deterministically order validated events. Duplicate event_id with
// identical canonical content is idempotent; identical id with different
// content fails closed.
export function parseStateComments(comments, context) {
  const events = [];
  for (const comment of comments ?? []) {
    const envelope = validateStateComment(comment, context);
    if (!envelope) continue;
    events.push({
      order: [Date.parse(comment.created_at), Number(comment.id), envelope.event_id],
      comment_id: comment.id,
      envelope,
    });
  }
  events.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.order[2].localeCompare(b.order[2]));
  const seen = new Map();
  const unique = [];
  for (const event of events) {
    const canonical = canonicalJson(event.envelope);
    if (seen.has(event.envelope.event_id)) {
      if (seen.get(event.envelope.event_id) !== canonical) {
        fail(`event_id 冲突（相同 id 不同内容）：${event.envelope.event_id}`);
      }
      continue;
    }
    seen.set(event.envelope.event_id, canonical);
    unique.push(event);
  }
  return unique;
}

export function foldStateEvents(events) {
  const state = {};
  for (const { envelope } of events) {
    const payload = envelope.payload ?? {};
    switch (envelope.type) {
      case 'binding': {
        if (!Number.isInteger(payload.prNumber) || payload.prNumber <= 0) fail('binding payload prNumber 非法');
        state.prNumber = payload.prNumber;
        if (payload.prUrl !== undefined) state.prUrl = payload.prUrl;
        if (payload.prBranch !== undefined) {
          state.prBranch = payload.prBranch;
          state.branch = payload.prBranch;
        }
        if (payload.prBase !== undefined) state.prBase = payload.prBase;
        if (payload.prHeadSha !== undefined) {
          state.prHeadSha = payload.prHeadSha;
          state.head = payload.prHeadSha;
        }
        if (payload.boundAt !== undefined) state.boundAt = payload.boundAt;
        if (payload.boundBy !== undefined) state.boundBy = payload.boundBy;
        if (payload.boundWriter !== undefined) state.boundWriter = payload.boundWriter;
        if (payload.submittedAt !== undefined) state.submittedAt = payload.submittedAt;
        break;
      }
      case 'ci':
        if (payload.ready === true) {
          if (typeof payload.ciHeadSha !== 'string' || !payload.ciHeadSha) fail('ci ready=true 缺 ciHeadSha');
          state.ciHeadSha = payload.ciHeadSha;
          if (payload.ciVerifiedAt !== undefined) state.ciVerifiedAt = payload.ciVerifiedAt;
        }
        break;
      case 'review': {
        const review = payload.review;
        if (!review || typeof review !== 'object' || typeof review.review_id !== 'string' || !review.review_id) {
          fail('review payload 缺 review_id');
        }
        if (typeof review.reviewed_head_sha !== 'string' || !review.reviewed_head_sha) {
          fail('review payload 缺 reviewed_head_sha');
        }
        const reviews = Array.isArray(state.reviews) ? [...state.reviews] : [];
        const index = reviews.findIndex((item) => item.review_id === review.review_id);
        if (index >= 0) {
          if (reviews[index].reviewed_head_sha !== review.reviewed_head_sha) {
            fail(`review_id ${review.review_id} 的 reviewed_head_sha 不一致（fail-closed）`);
          }
          reviews[index] = review;
        } else {
          reviews.push(review);
        }
        state.reviews = reviews;
        break;
      }
      case 'merge':
        if (payload.mergeVerdict === 'merge') {
          state.mergedSha = payload.mergedSha ?? null;
          state.mergedAt = payload.mergedAt;
          state.mergeVerdict = 'merge';
          if (payload.mergeLgtm !== undefined) state.mergeLgtm = payload.mergeLgtm;
        } else if (payload.mergeVerdict === 'rework') {
          state.mergeVerdict = 'rework';
          state.reworkAt = payload.reworkAt;
          state.reworkReason = payload.reworkReason;
        } else {
          fail('merge payload mergeVerdict 非法');
        }
        break;
      case 'run':
        if (payload.launcherRole !== undefined) state.launcherRole = payload.launcherRole;
        if (payload.githubLogin !== undefined) state.githubLogin = payload.githubLogin;
        break;
      case 'owner-transfer':
        if (payload.assignee !== undefined) state.assignee = payload.assignee;
        if (payload.ownerTransfers !== undefined) {
          if (!Array.isArray(payload.ownerTransfers)) fail('owner-transfer ownerTransfers 非数组');
          state.ownerTransfers = payload.ownerTransfers;
        }
        break;
      case 'verify':
        if (payload.verifiedAt !== undefined) state.verifiedAt = payload.verifiedAt;
        break;
      default:
        fail(`未知 event type ${envelope.type}`);
    }
  }
  return state;
}

export function stateRebuildSummary(issue, alias, events, state) {
  const sha8 = (value) => (typeof value === 'string' && value.length >= 8 ? value.slice(0, 8) : 'none');
  return `#${issue} rebuilt: events=${events.length} aliases=${alias} binding=${state.prNumber ?? 'none'} ciHeadSha=${sha8(state.ciHeadSha)} reviews=${(state.reviews ?? []).length} mergedSha=${sha8(state.mergedSha)}`;
}

export function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

export function ownerTransferSnapshot(config, alias, number) {
  const state = loadState(config, alias, number);
  return { assignee: state.assignee ?? null, ownerTransfers: state.ownerTransfers ?? [] };
}

export const AUTO_ELEMENTS = ['观察证据', '期望行为', '反例或失败条件', '允许修改范围', '验收方式'];

// 反例要素兼容两种历史写法：模板 candidate.md / candidate.yml 用「反例与失败条件」，
// AGENTS.md / AUTO_ELEMENTS 用「反例或失败条件」。二者等价通过，其余四要素精确匹配。
export const AUTO_ELEMENT_ALTERNATIVES = {
  '反例或失败条件': ['反例或失败条件', '反例与失败条件'],
};

export function missingAutoElements(body) {
  const text = body ?? '';
  return AUTO_ELEMENTS.filter((element) => {
    const candidates = AUTO_ELEMENT_ALTERNATIVES[element] ?? [element];
    return !candidates.some((candidate) => text.includes(candidate));
  });
}
