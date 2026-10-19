#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  ensurePathOnD, fail, issue, labelsOf, loadConfig, parseArgs, repoAliasOf,
  root, run, runShell, setStatus, slugify, worktreePath,
} from './lib.mjs';

const STATUS_COLORS = {
  candidate: 'BFDADC', 'needs-triage': 'FBCA04', 'needs-owner': 'D93F0B',
  approved: '0E8A16', 'in-progress': '1D76DB', 'in-review': '5319E7',
  verified: '006B75', blocked: 'B60205',
};
const TYPE_COLORS = {
  bug: 'D73A4A', maintenance: 'C5DEF5', research: '7057FF',
  feature: 'A2EEEF', decision: 'F9D0C4',
};

function usage() {
  console.log(`Issue Pilot

  doctor
  setup
  brief [--mine]
  search <keywords>
  repo list
  repo add <alias> --path <local> --github <owner/repo> [--base main] [--policy name]
  propose --repo <alias> --type <type> --title <text> --body-file <path>
  approve <issue>
  run <issue>
  submit <issue>
  review <issue> --verdict <lgtm|changes> --sha <commit>
  verify <issue> --evidence-file <path>
  close <issue> --summary-file <path>

Owner-only: approve, merge, release. Agent-created work starts as candidate.`);
}

function requireNumber(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) fail(`无效 Issue 编号：${value}`);
  return number;
}

function doctor(config) {
  ensurePathOnD(config.worktreeRoot);
  const checks = [
    ['node', ['--version']], ['git', ['--version']], ['gh', ['--version']],
  ];
  let bad = false;
  for (const [command, args] of checks) {
    const result = run(command, args, { allowFailure: true });
    const ok = result.status === 0;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${command} ${ok ? result.stdout.split('\n')[0] : result.stderr}`);
    bad ||= !ok;
  }
  const auth = run('gh', ['auth', 'status'], { allowFailure: true });
  console.log(`${auth.status === 0 ? 'PASS' : 'FAIL'} GitHub auth`);
  bad ||= auth.status !== 0;
  for (const [alias, repo] of Object.entries(config.repositories)) {
    const exists = fs.existsSync(repo.path);
    const git = exists && run('git', ['-C', repo.path, 'rev-parse', '--is-inside-work-tree'], { allowFailure: true }).status === 0;
    console.log(`${exists && git ? 'PASS' : 'FAIL'} repo:${alias} ${repo.path}`);
    bad ||= !(exists && git);
  }
  console.log(`worktree root: ${config.worktreeRoot}`);
  if (bad) process.exitCode = 1;
}

function setup(config) {
  const labels = [
    ...Object.entries(STATUS_COLORS).map(([name, color]) => [`status:${name}`, color]),
    ...Object.entries(TYPE_COLORS).map(([name, color]) => [`type:${name}`, color]),
    ...Object.keys(config.repositories).map((name) => [`repo:${name}`, 'D4C5F9']),
    ['review:lgtm', '0E8A16'], ['preflight', 'FEF2C0'],
  ];
  for (const [name, color] of labels) {
    run('gh', ['label', 'create', name, '-R', config.issueRepository, '--color', color, '--force']);
  }
  console.log(`已同步 ${labels.length} 个 labels 到 ${config.issueRepository}`);
}

function brief(config, mine) {
  const fields = 'number,title,labels,assignees,updatedAt,url,author';
  const args = ['issue', 'list', '-R', config.issueRepository, '--state', 'open', '--limit', '100', '--json', fields];
  if (mine) args.push('--assignee', '@me');
  const issues = JSON.parse(run('gh', args).stdout);
  const order = ['needs-owner', 'in-review', 'in-progress', 'approved', 'needs-triage', 'candidate', 'blocked'];
  const groups = new Map(order.map((status) => [status, []]));
  for (const item of issues) {
    const status = labelsOf(item).find((label) => label.startsWith('status:'))?.slice(7) ?? 'candidate';
    if (!groups.has(status)) groups.set(status, []);
    groups.get(status).push(item);
  }
  if (!issues.length) return console.log('没有未关闭的 Issue。');
  for (const [status, items] of groups) {
    if (!items.length) continue;
    console.log(`\n## ${status} (${items.length})`);
    for (const item of items) console.log(`- #${item.number} ${item.title}  ${item.url}`);
  }
}

function search(config, keywords) {
  if (!keywords) fail('search 需要关键词。');
  const out = run('gh', ['issue', 'list', '-R', config.issueRepository, '--state', 'all', '--search', keywords, '--limit', '50']);
  console.log(out.stdout || '没有匹配 Issue。');
}

function repoCommand(config, positionals, flags) {
  const action = positionals[0];
  if (action === 'list') {
    for (const [alias, repo] of Object.entries(config.repositories)) {
      console.log(`${alias}\t${repo.github}\t${repo.base}\t${repo.policy}\t${repo.path}`);
    }
    return;
  }
  if (action !== 'add') fail('repo 只支持 list 或 add。');
  const alias = positionals[1];
  if (!alias || !/^[a-z0-9][a-z0-9-]*$/.test(alias)) fail('repo add 需要小写 alias。');
  if (!flags.path || !flags.github) fail('repo add 需要 --path 和 --github。');
  const localPath = path.resolve(flags.path);
  if (!fs.existsSync(localPath)) fail(`本地仓库不存在：${localPath}`);
  if (run('git', ['-C', localPath, 'rev-parse', '--is-inside-work-tree'], { allowFailure: true }).status !== 0) {
    fail(`不是 Git 仓库：${localPath}`);
  }
  config.repositories[alias] = {
    path: localPath,
    github: flags.github,
    base: flags.base || 'main',
    policy: flags.policy || alias,
    checks: flags.check ? [flags.check] : [],
  };
  const configPath = path.join(root, 'config', 'repos.local.json');
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  console.log(`已注册 repo:${alias}`);
}

function propose(config, flags) {
  const { repo, type, title } = flags;
  if (!repo || !config.repositories[repo]) fail('propose 需要已注册的 --repo。');
  if (!TYPE_COLORS[type]) fail(`不支持的 --type：${type}`);
  if (!title || !flags['body-file']) fail('propose 需要 --title 和 --body-file。');
  const bodyPath = path.resolve(flags['body-file']);
  if (!fs.existsSync(bodyPath)) fail(`正文文件不存在：${bodyPath}`);
  const result = run('gh', [
    'issue', 'create', '-R', config.issueRepository, '--title', title,
    '--body-file', bodyPath, '--label', `status:candidate,type:${type},repo:${repo}`,
  ]);
  console.log(result.stdout);
}

function approve(config, number) {
  const item = issue(config, number);
  if (item.state !== 'OPEN') fail(`Issue #${number} 不是 OPEN。`);
  setStatus(config, number, 'approved');
  run('gh', ['issue', 'comment', String(number), '-R', config.issueRepository, '--body', 'Owner gate：批准进入实现。']);
  console.log(`#${number} -> approved`);
}

function startRun(config, number) {
  const item = issue(config, number);
  if (!labelsOf(item).includes('status:approved')) fail(`#${number} 尚未 approved。`);
  const alias = repoAliasOf(item, config);
  const repo = config.repositories[alias];
  const target = worktreePath(config, alias, number);
  ensurePathOnD(target);
  if (fs.existsSync(target)) fail(`worktree 已存在：${target}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const branch = `issue-pilot/${number}-${slugify(item.title)}`;
  const remoteBase = run('git', ['-C', repo.path, 'rev-parse', '--verify', `origin/${repo.base}`], { allowFailure: true });
  const start = remoteBase.status === 0 ? `origin/${repo.base}` : repo.base;
  run('git', ['-C', repo.path, 'worktree', 'add', '-b', branch, target, start]);
  setStatus(config, number, 'in-progress');
  const note = `运行已开始。\n\n- 仓库：${alias}\n- 分支：\`${branch}\`\n- worktree：\`${target}\``;
  run('gh', ['issue', 'comment', String(number), '-R', config.issueRepository, '--body', note]);
  console.log(target);
}

function submit(config, number) {
  const item = issue(config, number);
  const alias = repoAliasOf(item, config);
  const repo = config.repositories[alias];
  const target = worktreePath(config, alias, number);
  if (!fs.existsSync(target)) fail(`worktree 不存在：${target}`);
  const status = run('git', ['-C', target, 'status', '--porcelain']).stdout;
  if (status) fail('worktree 不干净；请先检查并 commit 所有交付物。');
  const branch = run('git', ['-C', target, 'branch', '--show-current']).stdout;
  const baseRef = run('git', ['-C', target, 'rev-parse', '--verify', `origin/${repo.base}`], { allowFailure: true }).status === 0
    ? `origin/${repo.base}`
    : repo.base;
  const count = Number(run('git', ['-C', target, 'rev-list', '--count', `${baseRef}..HEAD`]).stdout);
  if (!count) fail(`当前分支相对 ${repo.base} 没有 commit。`);
  for (const command of repo.checks ?? []) {
    console.log(`CHECK ${command}`);
    runShell(command, target);
  }
  run('git', ['-C', target, 'push', '-u', 'origin', branch]);
  const body = [
    `Refs ${config.issueRepository}#${number}`,
    '', '## 交付物', '', `实现 Issue Pilot #${number} 已批准范围。`,
    '', '## 验证', '', (repo.checks ?? []).length ? repo.checks.map((c) => `- \`${c}\``).join('\n') : '- 目标仓库规定的检查已由实现者记录在关联 Issue。',
    '', '## 未改变的边界', '', `遵循 \`${repo.policy}\` policy；未授权范围保持不变。`,
    '', '## 风险与回滚', '', '可通过回退本 PR 恢复。',
  ].join('\n');
  const pr = run('gh', [
    'pr', 'create', '-R', repo.github, '--base', repo.base, '--head', branch,
    '--title', item.title.replace(/^\[候选\]\s*/, ''), '--body', body,
  ]).stdout;
  setStatus(config, number, 'in-review');
  run('gh', ['issue', 'comment', String(number), '-R', config.issueRepository, '--body', `PR 已提交：${pr}`]);
  console.log(pr);
}

function review(config, number, flags) {
  if (!['lgtm', 'changes'].includes(flags.verdict)) fail('--verdict 必须是 lgtm 或 changes。');
  if (!flags.sha) fail('review 必须提供 --sha。');
  const item = issue(config, number);
  if (!labelsOf(item).includes('status:in-review')) fail(`#${number} 当前不在 in-review。`);
  const body = flags.verdict === 'lgtm'
    ? `独立 review：LGTM，审查 commit \`${flags.sha}\`。`
    : `独立 review：需要修改，审查 commit \`${flags.sha}\`。`;
  run('gh', ['issue', 'comment', String(number), '-R', config.issueRepository, '--body', body]);
  if (flags.verdict === 'lgtm') {
    run('gh', ['issue', 'edit', String(number), '-R', config.issueRepository, '--add-label', 'review:lgtm']);
  } else {
    run('gh', ['issue', 'edit', String(number), '-R', config.issueRepository, '--remove-label', 'review:lgtm'], { allowFailure: true });
    setStatus(config, number, 'in-progress');
  }
}

function verify(config, number, flags) {
  if (!flags['evidence-file']) fail('verify 需要 --evidence-file。');
  const evidencePath = path.resolve(flags['evidence-file']);
  if (!fs.existsSync(evidencePath)) fail(`验证证据文件不存在：${evidencePath}`);
  const item = issue(config, number);
  if (!labelsOf(item).includes('review:lgtm')) fail(`#${number} 尚无独立 review:lgtm。`);
  const evidence = fs.readFileSync(evidencePath, 'utf8');
  run('gh', ['issue', 'comment', String(number), '-R', config.issueRepository, '--body', `## 合并后验证\n\n${evidence}`]);
  setStatus(config, number, 'verified');
  console.log(`#${number} -> verified`);
}

function closeIssue(config, number, flags) {
  if (!flags['summary-file']) fail('close 需要 --summary-file。');
  const summaryPath = path.resolve(flags['summary-file']);
  if (!fs.existsSync(summaryPath)) fail(`总结文件不存在：${summaryPath}`);
  const item = issue(config, number);
  if (!labelsOf(item).includes('status:verified')) fail(`#${number} 尚未完成 verified Gate。`);
  const summary = fs.readFileSync(summaryPath, 'utf8');
  run('gh', ['issue', 'comment', String(number), '-R', config.issueRepository, '--body', `## 总结\n\n${summary}`]);
  run('gh', ['issue', 'close', String(number), '-R', config.issueRepository, '--reason', 'completed']);
  console.log(`#${number} closed`);
}

try {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') usage();
  else {
    const config = loadConfig();
    const { positionals, flags } = parseArgs(rest);
    if (command === 'doctor') doctor(config);
    else if (command === 'setup') setup(config);
    else if (command === 'brief') brief(config, Boolean(flags.mine));
    else if (command === 'search') search(config, positionals.join(' '));
    else if (command === 'repo') repoCommand(config, positionals, flags);
    else if (command === 'propose') propose(config, flags);
    else if (command === 'approve') approve(config, requireNumber(positionals[0]));
    else if (command === 'run') startRun(config, requireNumber(positionals[0]));
    else if (command === 'submit') submit(config, requireNumber(positionals[0]));
    else if (command === 'review') review(config, requireNumber(positionals[0]), flags);
    else if (command === 'verify') verify(config, requireNumber(positionals[0]), flags);
    else if (command === 'close') closeIssue(config, requireNumber(positionals[0]), flags);
    else fail(`未知命令：${command}`);
  }
} catch (error) {
  console.error(`ERROR ${error.message}`);
  process.exitCode = 1;
}
