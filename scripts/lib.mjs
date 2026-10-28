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
  if (command === 'gh') environment = ghTokenEnvironment(environment);
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
    if (command === 'gh' && process.env.PL_ENFORCE_APP === '1' && !options.noRetry401 && rejected) {
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
  const text = run('gh', [
    'issue', 'view', String(number), '-R', config.issueRepository,
    '--json', 'number,title,body,labels,assignees,url,state',
  ]).stdout;
  return JSON.parse(text);
}

export function setStatus(config, number, status) {
  const current = issue(config, number);
  const statuses = labelsOf(current).filter((label) => label.startsWith('status:'));
  for (const label of statuses) {
    run('gh', ['issue', 'edit', String(number), '-R', config.issueRepository, '--remove-label', label]);
  }
  run('gh', ['issue', 'edit', String(number), '-R', config.issueRepository, '--add-label', `status:${status}`]);
}

export function setNeed(config, number, need) {
  const current = issue(config, number);
  const needs = labelsOf(current).filter((label) => label.startsWith('need:'));
  for (const label of needs) {
    run('gh', ['issue', 'edit', String(number), '-R', config.issueRepository, '--remove-label', label]);
  }
  if (need) {
    run('gh', ['issue', 'edit', String(number), '-R', config.issueRepository, '--add-label', `need:${need}`]);
  }
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
