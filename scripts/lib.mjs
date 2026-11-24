import { spawnSync } from 'node:child_process';
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

export function repoAliasOf(issue, config) {
  const labels = labelsOf(issue);
  const label = labels.find((item) => item.startsWith('repo:'));
  if (!label) fail(`Issue #${issue.number} 缺少 repo:<alias> label。`);
  const alias = label.slice(5);
  if (!config.repositories[alias]) fail(`repos.local.json 未注册仓库 ${alias}。`);
  return alias;
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

// verifyLauncherIdentity — generic + role-specific launcher identity checks.
// Fail-closed on any anomaly (R7 constraints 1–6 / §4 通用校验 + 角色专属校验).
// Returns the normalized identity (role / principal / githubLogin / tokenBot).
export function verifyLauncherIdentity(env = process.env, opts = {}) {
  if (env.PL_ENFORCE_APP !== '1') {
    fail('身份校验失败：PL_ENFORCE_APP != 1（非 Launcher 会话，fail-closed）');
  }
  const role = env.PL_ROLE;
  if (!['worker', 'reviewer', 'owner'].includes(role)) {
    fail(`身份校验失败：PL_ROLE 缺失或非法（${role ?? '(unset)'}）`);
  }
  if (!env.PL_TOKEN_BOT || !env.PL_EXPECTED_BOT || env.PL_TOKEN_BOT !== env.PL_EXPECTED_BOT) {
    fail(`身份校验失败：token 身份不符（${env.PL_TOKEN_BOT ?? '(unset)'} != ${env.PL_EXPECTED_BOT ?? '(unset)'}）`);
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
  // 双 App 写侧（Plan A）：任意角色注入 PL_WRITE_GIT_TOKEN 时，写侧 bot 必须
  // 自校验通过（§4 通用校验第 3 条）。期望值按 role 区分，不复制 reviewer 身份。
  if (env.PL_WRITE_GIT_TOKEN) {
    const writeBot = env.PL_WRITE_TOKEN_BOT;
    const writeExpected = env.PL_WRITE_EXPECTED_BOT;
    if (!writeBot || !writeExpected || writeBot !== writeExpected) {
      fail(`身份校验失败：${role} 写侧 token 身份不符（fail-closed）`);
    }
    const expectedWrite = ROLE_WRITE_BOTS[role];
    if (writeBot !== expectedWrite) {
      fail(`身份校验失败：${role} 写侧 bot 不符（${writeBot}，期望 ${expectedWrite}）`);
    }
  }
  return {
    role,
    principal,
    githubLogin: env.PL_GITHUB_LOGIN || env.PL_TOKEN_BOT,
    tokenBot: env.PL_TOKEN_BOT,
    // 实际执行 GitHub 写操作的身份（reviewer 双 App 为写侧 bot；单 App 为 null）
    writeTokenBot: env.PL_WRITE_TOKEN_BOT ?? null,
  };
}

// G11 — control-repo write audit. Every control-repo (config.issueRepository)
// write must expose the traceable chain role -> principal -> writer_login ->
// repository -> operation (not just review). Calls verifyLauncherIdentity, so
// any control-repo write outside a valid launcher session fails closed.
export function writeAudit(config, operation, env = process.env) {
  const identity = verifyLauncherIdentity(env);
  return {
    role: identity.role,
    principal: identity.principal,
    writer_login: identity.writeTokenBot ?? identity.tokenBot,
    repository: config.issueRepository,
    operation,
  };
}

// Markdown footer appended to every control-repo operation comment (audit trail).
export function auditFooter(config, operation, env = process.env) {
  const a = writeAudit(config, operation, env);
  return [
    '',
    '---',
    '<sub>control-plane audit</sub>',
    `role=\`${a.role}\` principal=\`${a.principal}\` writer_login=\`${a.writer_login}\` repository=\`${a.repository}\` operation=\`${a.operation}\``,
  ].join('\n');
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

export function soloMode() {
  const file = path.join(root, 'policies', 'solo-mode.md');
  if (!fs.existsSync(file)) return { enabled: false, phase: 'absent' };
  const head = fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(0, 4).join('\n');
  if (head.includes('> 状态：**ACTIVE')) return { enabled: true, phase: 'active' };
  if (head.includes('> 状态：**PILOT')) return { enabled: true, phase: 'pilot' };
  return { enabled: false, phase: 'draft' };
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
