#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  assertNoRoleOverride, assertSingleAssignee, ensurePathOnD, fail, issue,
  labelsOf, loadConfig, loadState, missingAutoElements, parseArgs, repoAliasOf,
  root, run, runShell, saveState, setNeed, setStatus, slugify, soloMode,
  statePath, verifyLauncherIdentity, worktreePath, writeTokenEnv,
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
const NEED_COLORS = { author: 'FBCA04', reviewer: '1D76DB', 'issue-owner': 'D93F0B', 'repo-owner': 'B60205' };

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
  ci <issue>
  review <issue> --verdict <lgtm|changes|blocked> --sha <commit> [--note <text>]
  merge <issue> --verdict <merge|rework> [--reason <text>]
  verify <issue> --evidence-file <path>
  close <issue> --summary-file <path>
  advance <issue>       Solo Mode 幂等单步自动推进
  autopilot <issue>     Solo Mode 循环推进至 hold/closed/无进展

Labels: status:* lifecycle · type:* kind · need:* next actor
(author / reviewer / issue-owner / repo-owner). brief groups by need:*.
need:issue-owner = Issue Owner（立项/批准/verify/close）；
need:repo-owner = Repo Owner（唯一 merge 门）。

Owner-only: approve, verify, close（Issue Owner，按 assignee 路由）,
merge（Repo Owner）。Agent-created work starts as candidate.`);
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
  const auth = run('gh', ['api', 'rate_limit'], { allowFailure: true });
  console.log(`${auth.status === 0 ? 'PASS' : 'FAIL'} GitHub auth`);
  bad ||= auth.status !== 0;
  if (process.env.PL_ENFORCE_APP === '1') {
    let login = '';
    let expected = process.env.PL_TOKEN_BOT || process.env.PL_EXPECTED_BOT || '';
    const viewer = run('gh', ['api', 'graphql', '-f', 'query=query{viewer{login}}'], { allowFailure: true });
    if (viewer.status === 0) {
      try { login = JSON.parse(viewer.stdout).data.viewer.login; } catch { login = ''; }
    }
    const identityOk = login !== '' && (!expected || login === expected);
    console.log(`${identityOk ? 'PASS' : 'FAIL'} PL identity: ${login || '(lookup failed)'}${expected ? ` (expected ${expected})` : ' (no PL expectation set)'}`);
    bad ||= !identityOk;
    const expiresAt = Date.parse(process.env.PL_TOKEN_EXPIRES_AT ?? '');
    if (Number.isFinite(expiresAt)) {
      console.log(`INFO PL token expires_at ${new Date(expiresAt).toISOString()}`);
    }
  }
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
  // 一次性迁移：删除旧 need:owner（已拆分 need:issue-owner / need:repo-owner）
  run('gh', ['label', 'delete', 'need:owner', '-R', config.issueRepository, '--yes'], { allowFailure: true });
  console.log(`已同步 ${labels.length} 个 labels 到 ${config.issueRepository}（need:owner 已删除）`);
}

function brief(config, mine) {
  const fields = 'number,title,labels,assignees,updatedAt,url,author';
  const args = ['issue', 'list', '-R', config.issueRepository, '--state', 'open', '--limit', '100', '--json', fields];
  if (mine) args.push('--assignee', '@me');
  const issues = JSON.parse(run('gh', args).stdout);
  const order = ['need:issue-owner', 'need:repo-owner', 'need:reviewer', 'need:author', 'other'];
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
    '--assignee', '@me',
  ]);
  setNeed(config, Number(result.stdout.match(/issues\/(\d+)/)?.[1] ?? 0), 'issue-owner');
  console.log(result.stdout);
}

function approve(config, number) {
  const item = issue(config, number);
  if (item.state !== 'OPEN') fail(`Issue #${number} 不是 OPEN。`);
  assertSingleAssignee(item);   // 决策④：0/多值 assignee 阻止 approve
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
  setStatus(config, number, 'in-progress');
  setNeed(config, number, 'author');
  const branchName = run('git', ['-C', target, 'branch', '--show-current']).stdout;
  const headNow = run('git', ['-C', target, 'rev-parse', 'HEAD']).stdout;
  saveState(config, alias, number, {
    prUrl: pr, head: headNow, branch: branchName,
    submittedAt: new Date().toISOString(),
    launcherRole: process.env.PL_ROLE || null,
    githubLogin: process.env.PL_GITHUB_LOGIN || process.env.PL_TOKEN_BOT || null,
  });
  run('gh', ['issue', 'comment', String(number), '-R', config.issueRepository,
    '--body', `PR 已提交：${pr}\n\n等待 CI 门禁（运行 \`npm run pilot -- ci ${number}\`）。`]);
  console.log(pr);
}

// 三态标签转换表（design §5-8，设置与清除并重，防状态残留）。
// setNeed 内部会清除所有 need:* 再设目标；review:lgtm 单独增删。
function applyReviewLabels(config, number, verdict, env) {
  if (verdict === 'lgtm') {
    run('gh', ['issue', 'edit', String(number), '-R', config.issueRepository, '--add-label', 'review:lgtm'], { env });
    setNeed(config, number, 'repo-owner', { env });
  } else if (verdict === 'changes') {
    run('gh', ['issue', 'edit', String(number), '-R', config.issueRepository, '--remove-label', 'review:lgtm'], { env, allowFailure: true });
    setStatus(config, number, 'in-progress', { env });
    setNeed(config, number, 'author', { env });
  } else if (verdict === 'blocked') {
    run('gh', ['issue', 'edit', String(number), '-R', config.issueRepository, '--remove-label', 'review:lgtm'], { env, allowFailure: true });
    setNeed(config, number, 'reviewer', { env });
  }
}

function reviewCommentBody(verdict, record, blockedReason, note) {
  const table = [
    `| launcher_role | ${record.launcher_role} |`,
    `| github_login | ${record.github_login} |`,
    `| reviewer_verdict | ${record.reviewer_verdict} |`,
    `| reviewed_head_sha | \`${record.reviewed_head_sha ?? '(none)'}\` |`,
    `| reviewed_at | ${record.reviewed_at} |`,
    `| review_id | ${record.review_id} |`,
  ].join('\n');
  const header = verdict === 'lgtm' ? '## 独立 review：LGTM'
    : verdict === 'changes' ? '## 独立 review：CHANGES'
      : '## 独立 review：BLOCKED';
  const extra = verdict === 'blocked'
    ? [`- 原因：${blockedReason ?? '前置条件未满足'}`, '', 'BLOCKED 不构成代码判定；修复环境后可重新 review。']
    : [];
  const noteLines = note ? ['', '## 审查证据', '', note] : [];
  return [header, '', table, ...extra, ...noteLines].join('\n');
}

function review(config, number, flags) {
  const requestedVerdict = flags.verdict;
  if (!['lgtm', 'changes', 'blocked'].includes(requestedVerdict)) {
    fail('--verdict 必须是 lgtm|changes|blocked。');
  }
  if (!flags.sha) fail('review 必须提供 --sha。');
  assertNoRoleOverride(flags);

  // 1. R7 身份校验（fail-closed，约束 6）
  const identity = verifyLauncherIdentity(process.env);

  // 2. 读 issue（控制仓 → 写侧 token；读 App 无控制仓 Issues 权限）
  const wEnv = writeTokenEnv(process.env);
  const item = issue(config, number, { env: wEnv });
  if (!labelsOf(item).includes('status:in-review')) fail(`#${number} 当前不在 in-review。`);
  const assignee = assertSingleAssignee(item);

  // 3. R7 约束 1–4（审查资格）
  if (identity.role === 'worker') fail('R7 约束1：Worker 不得执行 review');
  if (identity.role === 'owner' && identity.principal === assignee) fail('R7 约束3：Issue Owner（assignee）不得自审');
  if (identity.role === 'reviewer' && identity.principal === assignee) fail('R7 约束2：Issue Owner（assignee）不得自审');

  // 4. 三态前置判定（消除 SHA 循环依赖）：ciHeadSha / PR head / --sha
  const alias = repoAliasOf(item, config);
  const repo = config.repositories[alias];
  const state = loadState(config, alias, number);
  const ciHeadSha = state.ciHeadSha;
  const branch = `issue-pilot/${number}-${slugify(item.title)}`;
  const pr = findPr(config, repo, branch);
  if (!pr) fail('未找到开放 PR');
  const prHead = pr.headRefOid;

  let verdict = requestedVerdict;
  let blockedReason = null;
  if (!ciHeadSha) {
    verdict = 'blocked';
    blockedReason = '无 ciHeadSha（尚未跑 ci 或 CI 未全绿）';
  } else if (prHead !== ciHeadSha) {
    verdict = 'blocked';
    blockedReason = `PR head ${prHead.slice(0, 8)} != ciHeadSha ${ciHeadSha.slice(0, 8)}（HEAD 已变，需重跑 ci）`;
  } else if (flags.sha !== ciHeadSha) {
    verdict = 'blocked';
    blockedReason = `--sha ${flags.sha.slice(0, 8)} != ciHeadSha ${ciHeadSha.slice(0, 8)}`;
  }

  const headForReview = ciHeadSha || prHead;
  const reviewId = `${number}:${pr.number}:${headForReview}:${identity.principal}:${verdict}`;
  const record = {
    review_id: reviewId,
    launcher_role: identity.role,
    github_login: identity.githubLogin,
    reviewer_verdict: verdict,
    reviewed_head_sha: (verdict === 'lgtm' || verdict === 'changes') ? ciHeadSha : null,
    reviewed_at: new Date().toISOString(),
    review_url: null,
  };

  // 5. 幂等（state 先行；review_id = issue+PR+head_sha+reviewer+verdict）
  const reviews = state.reviews ?? [];
  const existing = reviews.find((r) => r.review_id === reviewId);
  if (existing && existing.review_url) {
    // E26：评论已写、标签可能失败 → 仅补标签，不重复写评论
    applyReviewLabels(config, number, verdict, wEnv);
    console.log(`#${number} review 幂等（评论已存在，仅补标签）`);
    return;
  }

  // 6. 写 state 先行（记录 review 记录，review_url 待补）
  let nextReviews;
  if (existing) nextReviews = reviews.map((r) => (r.review_id === reviewId ? record : r));
  else nextReviews = [...reviews, record];
  saveState(config, alias, number, { reviews: nextReviews });

  // 7. 写评论（写侧 token）
  const body = reviewCommentBody(verdict, record, blockedReason, flags.note);
  const commentOut = run('gh', ['issue', 'comment', String(number), '-R', config.issueRepository, '--body', body], { env: wEnv });

  // 8. 回填 review_url
  const withUrl = nextReviews.map((r) => (r.review_id === reviewId ? { ...r, review_url: commentOut.stdout } : r));
  saveState(config, alias, number, { reviews: withUrl });

  // 9. 派生标签（派生前重读，幂等应用）
  applyReviewLabels(config, number, verdict, wEnv);

  console.log(`#${number} -> ${verdict}${blockedReason ? `（${blockedReason}）` : ''}`);
}

// ---------------------------------------------------------------------------
// CI Gate（design §6）：Required Checks 权威来源 + canEnterReview 三分匹配
// ---------------------------------------------------------------------------

function rulesetApplies(rs, base) {
  if (rs.enforcement !== 'active') return false;
  if (rs.target !== 'branch') return false;
  const include = rs.conditions?.ref_name?.include ?? [];
  return include.includes('~DEFAULT_BRANCH') || include.includes(base);
}

// getRequiredChecks(repo, base) -> [{ context, integration_id|null }]
// Rulesets + Branch Protection 双查取并集，key=(context, integration_id) 去重。
// 空并集或 Rulesets 不可读 → fail-closed；BP 404 属预期（跳过）。
function getRequiredChecks(config, repo, base) {
  const required = [];
  const seen = new Set();
  const add = (context, integrationId) => {
    const key = `${context}\u0000${integrationId ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    required.push({ context, integration_id: integrationId ?? null });
  };

  // 1) Rulesets（现代权威来源）
  const rsList = JSON.parse(run('gh', ['api', `repos/${repo.github}/rulesets`]).stdout);
  for (const rs of rsList) {
    if (!rulesetApplies(rs, base)) continue;
    for (const rule of rs.rules ?? []) {
      if (rule.type !== 'required_status_checks') continue;
      for (const sc of rule.parameters?.required_status_checks ?? []) {
        add(sc.context, sc.integration_id ?? null);
      }
    }
  }

  // 2) 传统 Branch Protection（404 预期跳过；403/500 等 fail-closed）
  const bp = run('gh', ['api', `repos/${repo.github}/branches/${base}/protection`], { allowFailure: true });
  if (bp.status === 0) {
    const data = JSON.parse(bp.stdout);
    for (const ctx of data.required_status_checks?.contexts ?? []) add(ctx, null);
    for (const chk of data.required_status_checks?.checks ?? []) add(chk.context, chk.app_id ?? null);
  } else if (!/404/i.test(`${bp.stderr}${bp.stdout}`)) {
    fail(`Branch Protection 不可读（fail-closed）：${bp.stderr || `exit ${bp.status}`}`);
  }

  // 3) 并集为空 → fail-closed（G4/G10）
  if (required.length === 0) fail('Required Checks 为空（fail-closed，G4）');
  return required;
}

// canEnterReview(pr)：Check Runs 与 Commit Status 分别匹配（字段不同，不混用）。
// fail-closed：pending/skipped/neutral/cancelled/timed_out/stale/缺失 → 不满足。
function canEnterReview(config, repo, base, headSha) {
  const required = getRequiredChecks(config, repo, base);
  const checkRuns = JSON.parse(run('gh', ['api', `repos/${repo.github}/commits/${headSha}/check-runs`]).stdout).check_runs ?? [];
  const statuses = JSON.parse(run('gh', ['api', `repos/${repo.github}/commits/${headSha}/status`]).stdout).statuses ?? [];
  const missing = [];
  for (const { context, integration_id } of required) {
    const cr = checkRuns.find((c) => c.name === context && (integration_id == null || c.app?.id === integration_id));
    if (cr) {
      if (cr.status !== 'completed') { missing.push(`${context}: status=${cr.status}（未完成）`); continue; }
      if (cr.conclusion !== 'success') { missing.push(`${context}: conclusion=${cr.conclusion}（非 success）`); continue; }
      continue;
    }
    if (integration_id == null) {
      const cs = statuses.find((s) => s.context === context);
      if (cs && cs.state === 'success') continue;
    }
    missing.push(`${context}: 缺失或不成功（integration_id=${integration_id ?? 'null'}）`);
  }
  if (missing.length) return { ready: false, head_sha: headSha, required, missing };
  return { ready: true, head_sha: headSha, required };
}

// ci <issue> — 幂等 CI 门禁（design §5-7）。canEnterReview 全绿写入 ciHeadSha
// 并转 in-review + need:reviewer；否则 need:author + 失败明细（含 SHA）。
function ci(config, number) {
  const item = issue(config, number);
  const alias = repoAliasOf(item, config);
  const repo = config.repositories[alias];
  const branch = `issue-pilot/${number}-${slugify(item.title)}`;
  const pr = findPr(config, repo, branch);
  if (!pr) fail('未找到开放 PR');
  if (pr.state !== 'OPEN') fail(`PR #${pr.number} 状态 ${pr.state}`);
  const headSha = pr.headRefOid;
  const result = canEnterReview(config, repo, repo.base, headSha);
  if (result.ready) {
    saveState(config, alias, number, { ciHeadSha: headSha, ciVerifiedAt: new Date().toISOString() });
    setStatus(config, number, 'in-review');
    setNeed(config, number, 'reviewer');
    run('gh', ['issue', 'comment', String(number), '-R', config.issueRepository,
      '--body', `CI 门禁通过：Required Checks 全绿，绑定 HEAD \`${headSha.slice(0, 12)}\`。\n\n进入 in-review，等待 Reviewer。`]);
    console.log(`#${number} -> in-review（CI 全绿，ciHeadSha=${headSha.slice(0, 8)}）`);
  } else {
    setNeed(config, number, 'author');
    run('gh', ['issue', 'comment', String(number), '-R', config.issueRepository,
      '--body', `CI 门禁未通过（HEAD \`${headSha.slice(0, 12)}\`，fail-closed）：\n\n${result.missing.map((m) => `- ${m}`).join('\n')}`]);
    console.log(`#${number} -> need:author（CI 未全绿）`);
  }
}

// 独立有效 LGTM：launcher_role=reviewer 且 reviewed_head_sha == headSha。
// Repo Owner 自审（owner 角色）不满足 merge 独立性（Q3 铁律）。
function validReviewerLgtm(state, headSha) {
  const reviews = state.reviews ?? [];
  return reviews.filter((r) =>
    r.reviewer_verdict === 'lgtm' && r.launcher_role === 'reviewer' && r.reviewed_head_sha === headSha,
  ).pop() ?? null;
}

// merge <issue> --verdict merge|rework — Repo Owner 唯一 merge 门（§5-9/§5-18）。
function merge(config, number, flags) {
  const verdict = flags.verdict;
  if (!['merge', 'rework'].includes(verdict)) fail('--verdict 必须是 merge|rework。');
  assertNoRoleOverride(flags);

  // 1. 角色门：PL_ROLE=owner + PL_ENFORCE_APP=1（§5-18）
  const identity = verifyLauncherIdentity(process.env);
  if (identity.role !== 'owner') fail('merge 仅限 Repo Owner（PL_ROLE=owner）');

  // 2. 读 issue + state
  const item = issue(config, number);
  const alias = repoAliasOf(item, config);
  const repo = config.repositories[alias];
  const state = loadState(config, alias, number);

  // 3. PR + head
  const branch = `issue-pilot/${number}-${slugify(item.title)}`;
  const pr = findPr(config, repo, branch);
  if (!pr) fail('未找到开放 PR');
  if (pr.state !== 'OPEN') fail(`PR #${pr.number} 状态 ${pr.state}`);
  const headSha = pr.headRefOid;

  // 4. 四门重检（HEAD==reviewed sha / Required Checks@head 全绿 / LGTM 有效 / gateAudit 0 命中）
  const failures = [];
  const lgtm = validReviewerLgtm(state, headSha);
  if (!lgtm) failures.push(`无有效 reviewer LGTM（需 launcher_role=reviewer 且 reviewed_head_sha=${headSha.slice(0, 8)}）`);
  const checks = canEnterReview(config, repo, repo.base, headSha);
  if (!checks.ready) failures.push(`Required Checks @head 未全绿：${checks.missing.join('; ')}`);
  const violations = gateAudit(config, repo, pr.number);
  if (violations.length) failures.push(`Owner Gate 命中：${violations.join('; ')}`);

  if (verdict === 'merge') {
    if (failures.length) fail(`merge 四门重检失败：\n- ${failures.join('\n- ')}`);
    run('gh', ['pr', 'merge', String(pr.number), '-R', repo.github, '--merge']);
    const merged = JSON.parse(run('gh', ['pr', 'view', String(pr.number), '-R', repo.github,
      '--json', 'mergeCommit,state']).stdout);
    const mergedSha = merged.mergeCommit?.oid ?? null;
    saveState(config, alias, number, {
      mergedSha, mergedAt: new Date().toISOString(),
      mergeVerdict: 'merge', mergeLgtm: lgtm.review_id,
    });
    setStatus(config, number, 'verifying');
    setNeed(config, number, 'issue-owner');
    run('gh', ['issue', 'comment', String(number), '-R', config.issueRepository,
      '--body', `Repo Owner 合并：PR #${pr.number}，四门重检通过。\n\n- HEAD：\`${headSha.slice(0, 12)}\`\n- merge：\`${(mergedSha ?? '').slice(0, 12)}\`\n- LGTM（reviewer）：${lgtm.review_id}`]);
    console.log(`#${number} merged -> verifying`);
  } else {
    const reason = failures.length ? failures.join('；') : (flags.reason || 'Repo Owner 退回');
    saveState(config, alias, number, { mergeVerdict: 'rework', reworkAt: new Date().toISOString(), reworkReason: reason });
    setStatus(config, number, 'in-progress');
    setNeed(config, number, 'author');
    run('gh', ['issue', 'comment', String(number), '-R', config.issueRepository,
      '--body', `Repo Owner 退回（rework）：\n\n${reason}`]);
    console.log(`#${number} -> in-progress（rework）`);
  }
}

function verify(config, number, flags) {
  if (!flags['evidence-file']) fail('verify 需要 --evidence-file。');
  const evidencePath = path.resolve(flags['evidence-file']);
  if (!fs.existsSync(evidencePath)) fail(`验证证据文件不存在：${evidencePath}`);
  const item = issue(config, number);
  if (!labelsOf(item).includes('review:lgtm')) fail(`#${number} 尚无独立 review:lgtm。`);
  assertSingleAssignee(item);   // 决策④
  const evidence = fs.readFileSync(evidencePath, 'utf8');
  run('gh', ['issue', 'comment', String(number), '-R', config.issueRepository, '--body', `## 合并后验证\n\n${evidence}`]);
  setStatus(config, number, 'verified');
  setNeed(config, number, 'issue-owner');
  console.log(`#${number} -> verified`);
}

function closeIssue(config, number, flags) {
  if (!flags['summary-file']) fail('close 需要 --summary-file。');
  const summaryPath = path.resolve(flags['summary-file']);
  if (!fs.existsSync(summaryPath)) fail(`总结文件不存在：${summaryPath}`);
  const item = issue(config, number);
  if (!labelsOf(item).includes('status:verified')) fail(`#${number} 尚未完成 verified Gate。`);
  assertSingleAssignee(item);   // 决策④
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
const GATE_PREFIXES = ['policies/', 'config/', '.github/'];
const GATE_FILES = new Set(['AGENTS.md', 'pyproject.toml', 'src/provenlattice/storage.py']);
const GATE_DIFF_MARKERS = ['CREATE TABLE', 'ALTER TABLE', 'QUALIFIED'];
const WORKFLOW_ALLOWED = new Set(['.github/workflows/ci.yml']);
const WORKFLOW_FORBIDDEN_ADDED = ['permissions:', 'secrets', /^on:/];
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
  setNeed(config, number, 'issue-owner');
  run('gh', ['issue', 'comment', String(number), '-R', config.issueRepository,
    '--body', `Solo Mode HOLD：${reason}\n\n等待 Owner 决策（自动路径已停止）。`]);
  console.log(`#${number} -> hold (${reason})`);
}

function comment(config, number, body) {
  run('gh', ['issue', 'comment', String(number), '-R', config.issueRepository, '--body', body]);
}

function titleTokens(title) {
  return new Set((title.replace(/^[a-z]+\([^)]*\):\s*/, '')
    .match(/[A-Za-z0-9]+|[\u4e00-\u9fff]{2,}/g) ?? []));
}

function autoApprove(config, item) {
  const number = item.number;
  const type = typeOf(item);
  if (!AUTO_TYPES.has(type)) return `类型 ${type} 不在 AUTO 清单（bug/maintenance/research）`;
  const missing = missingAutoElements(item.body);
  if (missing.length) return `正文缺少提案要素：${missing.join('、')}`;
  const tokens = titleTokens(item.title);
  const open = JSON.parse(run('gh', ['issue', 'list', '-R', config.issueRepository,
    '--state', 'open', '--limit', '100', '--json', 'number,title']).stdout);
  const duplicate = open.filter((other) => other.number !== number).some((other) => {
    const shared = [...tokens].filter((token) => titleTokens(other.title).has(token));
    return tokens.size > 0 && shared.length / tokens.size >= 0.6;
  });
  if (duplicate) return `查重命中其他开放 Issue（词元重叠 ≥60%）`;
  setStatus(config, number, 'approved');
  setNeed(config, number, 'author');
  comment(config, number, [
    'Solo Mode 自动批准（AUTO）。',
    `- 类型 ${type} ∈ {bug, maintenance, research}`,
    '- 提案五要素完整：观察证据 / 期望行为 / 反例或失败条件 / 允许修改范围 / 验收方式',
    `- 查重无命中（标题词元重叠 <60%，开放 Issue ${open.length - 1} 个比对）`,
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

function autoMerge(config, item, alias, repo, state) {
  const number = item.number;
  const branch = `issue-pilot/${number}-${slugify(item.title)}`;
  const pr = findPr(config, repo, branch);
  if (!pr) return '未找到开放 PR';
  if (pr.state !== 'OPEN') return `PR #${pr.number} 状态 ${pr.state}`;
  const head = pr.headRefOid;
  if (state.head && state.head !== head) {
    return `state HEAD ${state.head.slice(0, 8)} != PR head ${head.slice(0, 8)}（新 commit 需重审）`;
  }
  const lgtm = validReviewerLgtm(state, head);
  if (!lgtm) return '尚无有效 reviewer LGTM（SHA 绑定）';
  const checks = canEnterReview(config, repo, repo.base, head);
  if (!checks.ready) return `CI 未全绿：${checks.missing.join('; ')}`;
  const violations = gateAudit(config, repo, pr.number);
  if (violations.length) {
    hold(config, number, `Owner Gate 命中：\n- ${violations.join('\n- ')}`);
    return 'held';
  }
  // 决策⑤（§5-13）：Solo Mode 到 merge 门即停，不自动 merge，置 need:repo-owner。
  saveState(config, alias, number, { soloMergeGateReady: true, head });
  setNeed(config, number, 'repo-owner');
  comment(config, number, [
    `Solo Mode 到达 merge 门（决策⑤：不自动 merge）。`,
    `- HEAD：\`${head.slice(0, 12)}\``,
    `- LGTM（reviewer）：${lgtm.review_id}`,
    `- CI 全绿 ✓ / gate 审计 0 命中 ✓`,
    `- 待 Repo Owner 执行 \`npm run pilot -- merge ${number} --verdict merge\`。`,
  ].join('\n'));
  console.log(`#${number} -> need:repo-owner（solo 停 merge 门）`);
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
      return { progress: result === null, reason: result ?? 'merge-gate（待 repo-owner）' };
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
    else if (command === 'ci') ci(config, requireNumber(positionals[0]));
    else if (command === 'review') review(config, requireNumber(positionals[0]), flags);
    else if (command === 'merge') merge(config, requireNumber(positionals[0]), flags);
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
