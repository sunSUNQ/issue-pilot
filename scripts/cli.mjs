#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  ensurePathOnD, fail, issue, labelsOf, loadConfig, loadState, parseArgs,
  repoAliasOf, root, run, runShell, saveState, setNeed, setStatus, slugify,
  soloMode, statePath, worktreePath,
} from './lib.mjs';

const STATUS_COLORS = {
  candidate: 'BFDADC', 'needs-triage': 'FBCA04', 'needs-owner': 'D93F0B',
  approved: '0E8A16', 'in-progress': '1D76DB', 'in-review': '5319E7',
  verifying: 'D4C5F9', verified: '006B75', hold: 'B60205', blocked: 'B60205',
};
const TYPE_COLORS = {
  bug: 'D73A4A', maintenance: 'C5DEF5', research: '7057FF',
  feature: 'A2EEEF', decision: 'F9D0C4',
};
const NEED_COLORS = { author: 'FBCA04', reviewer: '1D76DB', owner: 'D93F0B' };

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
  advance <issue>       Solo Mode 幂等单步自动推进
  autopilot <issue>     Solo Mode 循环推进至 hold/closed/无进展

Labels: status:* lifecycle · type:* kind · need:* next actor
(author / reviewer / owner). brief groups by need:*.

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
    ...Object.entries(NEED_COLORS).map(([name, color]) => [`need:${name}`, color]),
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
  const order = ['need:owner', 'need:reviewer', 'need:author', 'other'];
  const groups = new Map(order.map((status) => [status, []]));
  for (const item of issues) {
    const need = labelsOf(item).find((label) => label.startsWith('need:')) ?? 'other';
    if (!groups.has(need)) groups.set(need, []);
    groups.get(need).push(item);
  }
  if (!issues.length) return console.log('没有未关闭的 Issue。');
  for (const [group, items] of groups) {
    if (!items.length) continue;
    console.log(`\n## ${group} (${items.length})`);
    for (const item of items) {
      const status = labelsOf(item).find((label) => label.startsWith('status:'))?.slice(7) ?? 'candidate';
      console.log(`- #${item.number} [${status}] ${item.title}  ${item.url}`);
    }
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
  setNeed(config, Number(result.stdout.match(/issues\/(\d+)/)?.[1] ?? 0), 'owner');
  console.log(result.stdout);
}

function approve(config, number) {
  const item = issue(config, number);
  if (item.state !== 'OPEN') fail(`Issue #${number} 不是 OPEN。`);
  setStatus(config, number, 'approved');
  setNeed(config, number, 'author');
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
  setNeed(config, number, 'author');
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
  setNeed(config, number, 'reviewer');
  const branchName = run('git', ['-C', target, 'branch', '--show-current']).stdout;
  const headNow = run('git', ['-C', target, 'rev-parse', 'HEAD']).stdout;
  saveState(config, alias, number, {
    prUrl: pr, head: headNow, branch: branchName,
    submittedAt: new Date().toISOString(),
  });
  run('gh', ['issue', 'comment', String(number), '-R', config.issueRepository, '--body', `PR 已提交：${pr}`]);
  console.log(pr);
}

function review(config, number, flags) {
  if (!['lgtm', 'changes'].includes(flags.verdict)) fail('--verdict 必须是 lgtm 或 changes。');
  if (!flags.sha) fail('review 必须提供 --sha。');
  const item = issue(config, number);
  if (!labelsOf(item).includes('status:in-review')) fail(`#${number} 当前不在 in-review。`);
  const alias = repoAliasOf(item, config);
  const body = flags.verdict === 'lgtm'
    ? `独立 review：LGTM，审查 commit \`${flags.sha}\`。`
    : `独立 review：需要修改，审查 commit \`${flags.sha}\`。`;
  const out = run('gh', ['issue', 'comment', String(number), '-R', config.issueRepository, '--body', body]);
  if (flags.verdict === 'lgtm') {
    run('gh', ['issue', 'edit', String(number), '-R', config.issueRepository, '--add-label', 'review:lgtm']);
    setNeed(config, number, 'owner');
    saveState(config, alias, number, { reviewUrl: out.stdout, reviewedSha: flags.sha });
  } else {
    run('gh', ['issue', 'edit', String(number), '-R', config.issueRepository, '--remove-label', 'review:lgtm'], { allowFailure: true });
    setStatus(config, number, 'in-progress');
    setNeed(config, number, 'author');
    const state = loadState(config, alias, number);
    const next = saveState(config, alias, number, {
      reviewChangesCount: (state.reviewChangesCount ?? 0) + 1,
      reviewUrl: out.stdout,
    });
    if (next.reviewChangesCount >= HOLD_REVIEW_CHANGES) {
      hold(config, number, `复审 changes 达 ${next.reviewChangesCount} 轮`);
    }
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
  setNeed(config, number, 'owner');
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
  setNeed(config, number, null);
  run('gh', ['issue', 'close', String(number), '-R', config.issueRepository, '--reason', 'completed']);
  console.log(`#${number} closed`);
}

// ---------------------------------------------------------------------------
// Solo Mode（policies/solo-mode.md）：自动流转引擎
// ---------------------------------------------------------------------------

const AUTO_TYPES = new Set(['bug', 'maintenance', 'research']);
const AUTO_ELEMENTS = ['观察证据', '期望行为', '反例或失败条件', '允许修改范围', '验收方式'];
const GATE_PREFIXES = ['policies/', 'config/', '.github/'];
const GATE_FILES = new Set(['AGENTS.md', 'pyproject.toml', 'src/provenlattice/storage.py']);
const GATE_DIFF_MARKERS = ['CREATE TABLE', 'ALTER TABLE', 'QUALIFIED'];
const WORKFLOW_ALLOWED = new Set(['.github/workflows/ci.yml']);
const WORKFLOW_FORBIDDEN_ADDED = ['permissions:', 'secrets', /^on:/];
const HOLD_REVIEW_CHANGES = 2;
const HOLD_CI_FAILURES = 2;
const PILOT_ISSUES = new Set([8, 9, 10, 11, 12]);

function requireSolo() {
  const solo = soloMode();
  if (!solo.enabled) fail(`Solo Mode 未启用（phase=${solo.phase}）；见 policies/solo-mode.md。`);
  return solo;
}

function statusOf(item) {
  return labelsOf(item).find((label) => label.startsWith('status:'))?.slice(7);
}

function typeOf(item) {
  return labelsOf(item).find((label) => label.startsWith('type:'))?.slice(5);
}

function hold(config, number, reason) {
  setStatus(config, number, 'hold');
  setNeed(config, number, 'owner');
  run('gh', ['issue', 'comment', String(number), '-R', config.issueRepository,
    '--body', `Solo Mode HOLD：${reason}\n\n等待 Owner 决策（自动路径已停止）。`]);
  console.log(`#${number} -> hold (${reason})`);
}

function comment(config, number, body) {
  run('gh', ['issue', 'comment', String(number), '-R', config.issueRepository, '--body', body]);
}

function autoApprove(config, item) {
  const number = item.number;
  const type = typeOf(item);
  if (!AUTO_TYPES.has(type)) return `类型 ${type} 不在 AUTO 清单（bug/maintenance/research）`;
  const missing = AUTO_ELEMENTS.filter((key) => !(item.body ?? '').includes(key));
  if (missing.length) return `正文缺少提案要素：${missing.join('、')}`;
  const titleKey = item.title.replace(/^[a-z]+\([^)]*\):\s*/, '').slice(0, 24);
  const others = run('gh', ['issue', 'list', '-R', config.issueRepository,
    '--state', 'open', '--search', titleKey, '--limit', '20'], { allowFailure: true });
  const duplicate = (others.stdout.match(/#(\d+)/g) ?? [])
    .some((tag) => Number(tag.slice(1)) !== number);
  if (duplicate) return `查重命中其他开放 Issue（关键词：${titleKey}）`;
  setStatus(config, number, 'approved');
  setNeed(config, number, 'author');
  comment(config, number, [
    'Solo Mode 自动批准（AUTO）。',
    `- 类型 ${type} ∈ {bug, maintenance, research}`,
    '- 提案五要素完整：' + AUTO_ELEMENTS.join(' / '),
    `- 查重无命中（关键词：${titleKey}）`,
    `- 依据 policies/codegraph.md 自动推进范围；phase=${soloMode().phase}`,
  ].join('\n'));
  console.log(`#${number} -> approved (solo auto)`);
  return null;
}

function findPr(config, repo, branch) {
  const out = run('gh', ['pr', 'list', '-R', repo.github, '--head', branch,
    '--state', 'all', '--json', 'number,url,headRefOid,state'], { allowFailure: true });
  const prs = JSON.parse(out.stdout || '[]');
  return prs.find((pr) => pr.state === 'OPEN') ?? prs[0] ?? null;
}

function checksGreen(config, repo, prNumber) {
  const out = run('gh', ['pr', 'checks', String(prNumber), '-R', repo.github],
    { allowFailure: true });
  const rows = (out.stdout || '').split(/\r?\n/).filter((line) => line.includes('\t'));
  if (!rows.length) return { green: false, failed: true, detail: 'no checks reported' };
  const detail = [];
  let green = true;
  let failed = false;
  for (const row of rows) {
    const [, status] = row.split('\t');
    const state = (status ?? '').trim();
    if (state !== 'pass' && state !== 'skipping') {
      green = false;
      if (state === 'fail') failed = true;
    }
    detail.push(`${state}: ${row.split('\t')[0]}`);
  }
  return { green, failed, detail: detail.join('; ') };
}

function gateAudit(config, repo, prNumber) {
  const files = JSON.parse(run('gh', ['pr', 'view', String(prNumber), '-R', repo.github,
    '--json', 'files']).stdout).files;
  const violations = [];
  const diff = run('gh', ['pr', 'diff', String(prNumber), '-R', repo.github],
    { allowFailure: true }).stdout;
  const added = diff.split(/\r?\n/).filter((line) => line.startsWith('+') && !line.startsWith('+++'));
  for (const file of files) {
    const p = file.path;
    if (GATE_FILES.has(p) || GATE_PREFIXES.some((prefix) => p.startsWith(prefix) && !WORKFLOW_ALLOWED.has(p))) {
      if (!WORKFLOW_ALLOWED.has(p)) violations.push(`gate 文件：${p}`);
    }
    if (p.startsWith('.github/workflows/') && !WORKFLOW_ALLOWED.has(p)) {
      violations.push(`workflow 文件不在白名单：${p}`);
    }
  }
  for (const line of added) {
    const body = line.slice(1);
    if (WORKFLOW_FORBIDDEN_ADDED.some((marker) =>
      marker instanceof RegExp ? marker.test(body) : body.includes(marker))) {
      violations.push(`workflow 授权面变更：${body.trim().slice(0, 80)}`);
    }
    if (GATE_DIFF_MARKERS.some((marker) => body.includes(marker))) {
      violations.push(`gate 标记：${body.trim().slice(0, 80)}`);
    }
  }
  return [...new Set(violations)];
}

function reviewLgtmSha(config, item) {
  const comments = JSON.parse(run('gh', ['issue', 'view', String(item.number),
    '-R', config.issueRepository, '--json', 'comments']).stdout).comments;
  for (let i = comments.length - 1; i >= 0; i -= 1) {
    const match = comments[i].body.match(/独立 review：LGTM，审查 commit `([0-9a-f]{7,40})`/);
    if (match) return { sha: match[1], url: comments[i].url };
  }
  return null;
}

function autoMerge(config, item, alias, repo, state) {
  const number = item.number;
  const branch = `issue-pilot/${number}-${slugify(item.title)}`;
  const pr = findPr(config, repo, branch);
  if (!pr) return '未找到开放 PR';
  if (pr.state !== 'OPEN') return `PR #${pr.number} 状态 ${pr.state}`;
  const head = run('gh', ['pr', 'view', String(pr.number), '-R', repo.github,
    '--json', 'headRefOid']).stdout;
  if (state.head && state.head !== head) {
    return `state HEAD ${state.head.slice(0, 8)} != PR head ${head.slice(0, 8)}（新 commit 需重审）`;
  }
  const review = reviewLgtmSha(config, item);
  if (!review) return '尚无 LGTM review';
  if (review.sha !== head.slice(0, review.sha.length)) {
    return `LGTM SHA ${review.sha} != PR head ${head.slice(0, 8)}（新 commit 使复审失效）`;
  }
  if ((state.reviewChangesCount ?? 0) >= HOLD_REVIEW_CHANGES) {
    hold(config, number, `复审 changes 达 ${state.reviewChangesCount} 轮`);
    return 'held';
  }
  const checks = checksGreen(config, repo, pr.number);
  if (!checks.green) {
    const next = saveState(config, alias, number, {
      ciFailCount: checks.failed ? (state.ciFailCount ?? 0) + 1 : (state.ciFailCount ?? 0),
    });
    if (checks.failed && next.ciFailCount >= HOLD_CI_FAILURES) {
      hold(config, number, `CI 失败达 ${next.ciFailCount} 次`);
      return 'held';
    }
    return `CI 未全绿：${checks.detail}`;
  }
  const violations = gateAudit(config, repo, pr.number);
  if (violations.length) {
    hold(config, number, `Owner Gate 命中：\n- ${violations.join('\n- ')}`);
    return 'held';
  }
  run('gh', ['pr', 'merge', String(pr.number), '-R', repo.github, '--merge']);
  const merged = JSON.parse(run('gh', ['pr', 'view', String(pr.number), '-R', repo.github,
    '--json', 'mergeCommit,state']).stdout);
  saveState(config, alias, number, {
    mergedSha: merged.mergeCommit?.oid ?? null, prUrl: pr.url,
    head, gates: 'HEAD绑定/LGTM匹配/CI全绿/gate审计通过',
  });
  setStatus(config, number, 'verifying');
  setNeed(config, number, 'author');
  comment(config, number, [
    `Solo Mode 自动合并：PR #${pr.number}`,
    `- HEAD：\`${head.slice(0, 12)}\`；merge：\`${(merged.mergeCommit?.oid ?? '').slice(0, 12)}\``,
    `- LGTM：${review.url}`,
    `- 质量门：HEAD 绑定 ✓ / LGTM 匹配 ✓ / CI 全绿 ✓ / Owner Gate 审计 0 命中 ✓`,
  ].join('\n'));
  console.log(`#${number} merged (solo auto) -> verifying`);
  return null;
}

function autoVerify(config, item, alias, repo, state) {
  const number = item.number;
  const branch = `issue-pilot/${number}-${slugify(item.title)}`;
  const found = findPr(config, repo, branch);
  if (!found) return '未找到 PR';
  const view = JSON.parse(run('gh', ['pr', 'view', String(found.number), '-R', repo.github,
    '--json', 'state,mergeCommit,url']).stdout);
  if (view.state !== 'MERGED') return `PR #${found.number} 尚未合并`;
  const mergedSha = view.mergeCommit?.oid ?? state.mergedSha;
  const evidencePath = path.join(root, 'config', 'state', `${alias}-${number}-evidence.md`);
  fs.writeFileSync(evidencePath, [
    '# 合并后验证证据（Solo Mode 自动生成）',
    '',
    `- PR：${state.prUrl ?? view.url}`,
    `- HEAD：\`${state.head ?? ''}\``,
    `- Merge commit：\`${mergedSha}\``,
    `- 独立复审：${state.reviewUrl ?? '见 Issue 评论'}`,
    `- 质量门：${state.gates ?? '见合并评论'}`,
    `- 验证时间：${new Date().toISOString()}`,
  ].join('\n'), 'utf8');
  setStatus(config, number, 'verifying');
  verify(config, number, { 'evidence-file': evidencePath });
  saveState(config, alias, number, {
    mergedSha, prUrl: state.prUrl ?? view.url,
    verifiedAt: new Date().toISOString(),
  });
  console.log(`#${number} -> verified (solo auto)`);
  return null;
}

function autoClose(config, item, alias) {
  const number = item.number;
  const state = loadState(config, alias, number);
  const summaryPath = path.join(root, 'config', 'state', `${alias}-${number}-summary.md`);
  fs.writeFileSync(summaryPath, [
    `# Issue #${number} 总结（Solo Mode 自动关闭）`,
    '',
    `- PR：${state.prUrl ?? '见 Issue 评论'}`,
    `- Merge：\`${state.mergedSha ?? ''}\``,
    `- 质量门：独立复审 LGTM（SHA 绑定）+ CI 全绿 + Owner Gate 审计 0 命中`,
    `- 审计链：state 文件 ${path.basename(statePath(config, alias, number))} + Issue 评论`,
  ].join('\n'), 'utf8');
  closeIssue(config, number, { 'summary-file': summaryPath });
  return null;
}

function advanceOnce(config, number) {
  const solo = requireSolo();
  if (solo.phase === 'pilot' && !PILOT_ISSUES.has(number)) {
    return { progress: false, reason: `PILOT 阶段仅限试运行清单 ${[...PILOT_ISSUES].join('/')}` };
  }
  const item = issue(config, number);
  if (item.state !== 'OPEN') return { progress: false, reason: 'closed' };
  const alias = repoAliasOf(item, config);
  const repo = config.repositories[alias];
  const status = statusOf(item);
  const state = loadState(config, alias, number);
  switch (status) {
    case 'candidate': {
      const blocked = autoApprove(config, item);
      if (blocked) {
        saveState(config, alias, number, { autoApproveBlock: blocked });
        return { progress: false, reason: `自动批准未通过：${blocked}` };
      }
      return { progress: true };
    }
    case 'approved': {
      const target = worktreePath(config, alias, number);
      if (fs.existsSync(target)) return { progress: false, reason: 'worktree 已存在' };
      startRun(config, number);
      return { progress: true };
    }
    case 'in-progress': {
      const target = worktreePath(config, alias, number);
      if (!fs.existsSync(target)) return { progress: false, reason: 'worktree 不存在（实现中）' };
      if (run('git', ['-C', target, 'status', '--porcelain']).stdout) {
        return { progress: false, reason: 'worktree 未提交（实现中）' };
      }
      const base = run('git', ['-C', target, 'rev-parse', '--verify', `origin/${repo.base}`],
        { allowFailure: true }).status === 0 ? `origin/${repo.base}` : repo.base;
      if (!Number(run('git', ['-C', target, 'rev-list', '--count', `${base}..HEAD`]).stdout)) {
        return { progress: false, reason: '无 commit（实现中）' };
      }
      submit(config, number);
      const branch = `issue-pilot/${number}-${slugify(item.title)}`;
      const pr = findPr(config, repo, branch);
      saveState(config, alias, number, {
        prUrl: pr?.url, head: pr?.headRefOid,
        submittedAt: new Date().toISOString(),
      });
      return { progress: true };
    }
    case 'in-review': {
      const result = autoMerge(config, item, alias, repo, state);
      return { progress: result === null, reason: result ?? 'merged' };
    }
    case 'verifying': {
      const result = autoVerify(config, item, alias, repo, state);
      return { progress: result === null, reason: result ?? 'verified' };
    }
    case 'verified': {
      const result = autoClose(config, item, alias);
      return { progress: result === null, reason: 'closed' };
    }
    case 'hold':
      return { progress: false, reason: 'hold（等 Owner）' };
    default:
      return { progress: false, reason: `状态 ${status} 无自动动作` };
  }
}

function advance(config, number) {
  const solo = requireSolo();
  const result = advanceOnce(config, number);
  const line = result.progress
    ? `#${number} advanced（phase=${solo.phase}）`
    : `#${number} 停止：${result.reason}`;
  console.log(line);
  return result;
}

function autopilot(config, number) {
  const solo = requireSolo();
  for (let step = 1; step <= 12; step += 1) {
    const result = advanceOnce(config, number);
    if (!result.progress) {
      console.log(`autopilot #${number} 停止（step ${step}）：${result.reason}`);
      return;
    }
    console.log(`autopilot #${number} step ${step} 推进成功`);
  }
  console.log(`autopilot #${number} 达到步数上限，暂停`);
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
    else if (command === 'advance') advance(config, requireNumber(positionals[0]));
    else if (command === 'autopilot') autopilot(config, requireNumber(positionals[0]));
    else fail(`未知命令：${command}`);
  }
} catch (error) {
  console.error(`ERROR ${error.message}`);
  process.exitCode = 1;
}
