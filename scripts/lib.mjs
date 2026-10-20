import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function fail(message) {
  throw new Error(message);
}

export function parseGitCredential(text) {
  const credential = {};
  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator > 0) credential[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return credential;
}

function ghEnvironment(baseEnv) {
  if (baseEnv.GH_TOKEN || baseEnv.GITHUB_TOKEN) return baseEnv;
  const credentialResult = spawnSync('git', ['credential', 'fill'], {
    encoding: 'utf8',
    input: 'protocol=https\nhost=github.com\n\n',
    windowsHide: true,
    env: baseEnv,
  });
  if (credentialResult.status !== 0) return baseEnv;
  const credential = parseGitCredential(credentialResult.stdout);
  return credential.password ? { ...baseEnv, GH_TOKEN: credential.password } : baseEnv;
}

export function run(command, args = [], options = {}) {
  let environment = { ...process.env, ...(options.env ?? {}) };
  if (command === 'gh') environment = ghEnvironment(environment);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    input: options.input,
    shell: false,
    windowsHide: true,
    env: environment,
  });
  if (result.error) fail(`${command}: ${result.error.message}`);
  if (result.status !== 0 && !options.allowFailure) {
    fail((result.stderr || result.stdout || `${command} exited ${result.status}`).trim());
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
