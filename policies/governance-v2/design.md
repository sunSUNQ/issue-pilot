# Issue Governance V2 — CI Gate & Merge Gate 设计包

> 状态：设计已批准（Owner 五点裁定 + 两条补充设计 + 四条原则）。
> 红线：Branch Protection / Rulesets / `.github/workflows/ci.yml` / `scripts/cli.mjs` 均**不得**由 Agent 擅自修改。
> 本包是交付物，非实现。

---

## 0. P0 审计结论（Required Checks 权威来源）

结论：**权威来源已存在**，通过仓库级 Ruleset 定义，非传统 Branch Protection。

- 传统 `GET /repos/{repo}/branches/{base}/protection` → 404（预期，仓库用 Rulesets 而非 classic protection）。
- Repo Ruleset `provenlattice-main-protection`：
  - id `25471662`，`enforcement: active`，`target: branch`，`conditions.ref_name.include: [~DEFAULT_BRANCH]`。
  - `bypass_actors: []`，`current_user_can_bypass: never`。
  - `required_status_checks.required_status_checks` = 3 项：
    - `test-windows` (integration_id 15368)
    - `test-linux` (integration_id 15368)
    - `linux-jdt-verify` (integration_id 15368)
  - 与 `.github/workflows/ci.yml` 三个 job 名逐字一致。
  - `pull_request` 规则：`required_approving_review_count: 0`、`dismiss_stale_reviews_on_push: true`、`allowed_merge_methods: [merge, squash, rebase]`。
- `sunSUNQ` 为个人账号，org Rulesets 端点 404（不适用）。

**唯一缺口**：`strict_required_status_checks_policy: false`。注意：GitHub 的 strict required status checks 控制的是「PR 分支在合并前是否必须与目标分支保持最新（up-to-date）」，**不是** CLI 所需的 HEAD SHA 精确匹配机制。CLI 的 G2/G3 通过 `ciHeadSha` 自行实现 SHA 绑定；置 `strict=true` 是纵深防御（加固 GitHub 原生 merge 按钮），不得将其描述为 SHA 绑定的实现。

---

## 1. Repo Owner 配置清单（唯一 infra 待办）

1. 将 Ruleset `provenlattice-main-protection` 的 `required_status_checks.strict_required_status_checks_policy` 改为 `true`。
2. 确认 3 个 required context 与 `ci.yml` job 名一致（已一致，见 §0）。
3. （确认）`required_approving_review_count: 0` 为有意设计 —— LGTM 由控制面 Issue 层管理，不由 GitHub PR review 承担。

> CLI 的 `canEnterReview` 会自行做 SHA 绑定，strict=false 不阻塞实现；置 true 是为加固 GitHub 原生 merge 按钮（纵深防御）。

---

## 2. 最终标签体系

| 标签 | 含义 |
|---|---|
| `need:issue-owner` | 等待 Issue Owner（立项/批准/verify/close） |
| `need:author` | 等待 Author（实现/修复/等待 CI） |
| `need:reviewer` | 等待 Reviewer（独立复审） |
| `need:repo-owner` | 等待 Repo Owner（唯一 merge 门） |

删除 `need:owner`。`need:issue-owner` 与 `need:repo-owner` 语义拆分：
- `need:owner` 此前在 4 个生命周期点被复用（propose 立项 / review lgtm 后 merge / verify 后 close / hold），V2 拆成两个标签。

---

## 3. 状态机 V2

```
candidate
   └─ propose ─────────────► need:issue-owner  (Issue Owner 立项/批准)
                               │ approve
                               ▼
                            approved / need:author
                               │ run（实现）
                               ▼
                         in-progress / need:author
                               │ submit（创建 PR，不转交 Reviewer）
                               ▼
                         in-progress / need:author   ← CI Gate 未过
                               │ ci <issue>（幂等，Required Checks + HEAD SHA）
                               ├── CI 未全绿 ──► need:author（继续修复/等待）
                               └── CI 全绿 ────► in-review / need:reviewer
                                                  │ review
                                   BLOCKED ─────► need:reviewer（保持，不推进不退回；非代码判定）
                                   CHANGES ──────► in-progress / need:author
                                   LGTM（绑定 green head SHA）──► need:repo-owner
                                                                   │ merge --verdict
                                        merge ─────► verifying / need:issue-owner
                                        rework ────► in-progress / need:author（记录退回理由）
                                                                   │
                                        verify（Issue Owner）──► verified / need:issue-owner
                                                                   │ close（总结+关闭）
                                                                   ▼
                                                                closed（清 need）
```

> 复审独立性（R7，Launcher 角色）：reviewer 须为独立 Reviewer Launcher，或「非本 issue owner 的 Repo Owner」；Worker / Issue Owner 禁审。

责任闭环：`Issue Owner → Author → CI Gate → Reviewer → Repo Owner → Issue Owner`。

---

## 4. 裁定记录

**五点裁定**
| # | 决策点 | 裁定 |
|---|---|---|
| ① | Required Checks 来源 | 方案 A：仓库级强制检查（Branch Protection + Rulesets 双查） |
| ② | CI 门禁触发 | 新增 `ci <issue>` |
| ③ | Merge 门 | 新增 CLI `merge <issue> --verdict merge\|rework` |
| ④ | Issue Owner 身份 | Assignee 路由（唯一性校验），不做硬 ACL；Assignee 是生命周期责任人的唯一标识，approve/verify/close 按 Assignee 路由，不宣称执行者身份级强制隔离 |
| ⑤ | Solo Mode autoMerge | 停止自动 Merge，一律进入 `need:repo-owner` |

**两条补充设计**
1. CI 配置失效保护：每次 ci / review lgtm / merge 都重读保护规则；Required Checks 为空→拒绝；规则不可读→拒绝；上下文变化→要求重验；结果绑定 HEAD SHA。
2. Reviewer LGTM 必须记录结构化字段：`reviewer / verdict / reviewed_head_sha / reviewed_at`；新提交推入后旧 LGTM 自动失效，GitHub PR 上的旧 Approved Review 不视为新 HEAD 有效批准。

**四条治理原则**
1. Issue Owner 负责 Issue 生命周期，不替代其他角色。
2. Reviewer 只审查经过 CI 验证的最新提交。
3. Repo Owner 只负责 Merge 门，不负责最终关闭。
4. 任何自动化都不能绕过 CI Gate 与 Repo Owner Merge Gate。

**验收项 G1–G6**
- G1：CI 未全绿，禁止添加 `need:reviewer`。
- G2：CI 必须与 PR HEAD SHA 一致。
- G3：新提交自动使之前的 CI Review Gate 失效。
- G4：缺失、失败、运行中及不确定状态均 fail-closed。
- G5：只有 CI 门禁通过后，才允许 Reviewer 接管。
- G6：Repo Owner Merge 前再次确认最新 HEAD 的 CI 状态。
- G7：Reviewer Bot 只提交结构化 Review 结果；`review:lgtm` 与 `need:*` 标签流转由 Governance CLI 依据结果派生，Bot 不得自由改标签。
- G8：Review 采用 LGTM / CHANGES / BLOCKED 三态；BLOCKED 表示前置条件未满足（CI 未绿 / HEAD 变化 / 身份异常），不构成代码判定；按 §5-8 标签转换表设置/清除，BLOCKED/CHANGES **主动清除**已失效的 `review:lgtm` 与 `need:repo-owner`，修复环境后可重新 review。
- G9：Review 提交幂等且可恢复；以 `review_id` 唯一标识、`issue+PR+head_sha+reviewer+verdict` 为幂等依据；中断/写入失败/重复/并发/HEAD 变化均有确定性处理，不产生重复或矛盾标签。
- G10：Required Checks 集合保留 `context` + `integration_id` 二元组；多个 Ruleset 累加并集，同 `context` 不同 `integration_id` 视为不同检查；Check Runs 与 Commit Status **分别匹配**（字段不同，不混用）；Rulesets 不可读或并集为空 → fail-closed（Branch Protection 404 属预期，非错误）。

**补充规则 R7——复审独立性（Launcher 角色隔离，禁止自审）**
- 判定基础 = Launcher 角色（`PL_ROLE`），**不是** GitHub Login 相异；Login 仅作审计记录，不作为跨角色必须不同的硬性条件。
- 角色识别：Author＝Worker Launcher；Issue Owner＝Issue 唯一 Assignee；Reviewer＝Reviewer Launcher；Repo Owner＝Owner Launcher（+ 仓库 merge 权限）。
- 资格约束（审查资格 ≠ merge LGTM 有效性）：
  1. Worker Launcher 不得执行 Reviewer 操作。
  2. Issue Owner 不得执行当前 Issue 的 Reviewer 操作。
  3. Repo Owner（Owner Launcher）仅在其不同时担任当前 Issue Owner 时，可执行 Reviewer 操作，但只产生「兼任复审记录」，**不构成有效 merge LGTM**。
  4. 专用 Reviewer 身份的必要条件是独立 Reviewer Launcher；只有 Reviewer Launcher 产出的 LGTM 才是有效 merge LGTM。
  5. GitHub Login 作为审计信息记录，不作为跨角色必须不同的硬性条件。
  6. Launcher 角色无法确认、身份配置异常或角色边界被破坏时，必须 fail-closed。
- 审查资格 × merge 有效性矩阵：
  | 执行身份 | 能否执行 review | 能否产生有效 merge LGTM |
  |---|---|---|
  | Worker Launcher | 否 | 否 |
  | Reviewer Launcher | 是 | 是 |
  | Owner Launcher（非本 issue owner） | 是 | 否 |
  | Owner Launcher（是本 issue owner） | 否 | 否 |
- Review 记录字段（至少）：`launcher_role / github_login / reviewer_verdict ∈ {lgtm, changes, blocked} / reviewed_head_sha / reviewed_at / review_id`。
- Launcher 角色隔离 与 GitHub 账号权限属不同层次，不得混为一谈。
- 与决策④不冲突：④的「不做硬 ACL」仅限 issue-owner 动作（approve/verify/close，路由制）；R7 对 reviewer 动作施加强身份约束（独立性硬门）。

**现状缺口与裁定（2026-11-20）**：现有 Launcher 仅 `worker` 与 `owner` 两角色，无 `reviewer`。**裁定采用方案 2（独立 Reviewer Bot）**：新增 `start-reviewer-agent.ps1`（`PL_ROLE=reviewer`）+ 独立 App `pl-issue-reviewer[bot]`；`PL_PRINCIPAL` 拆分为 `PL_PRINCIPAL`（治理主体）与 `PL_GITHUB_LOGIN`（实际认证身份）。Reviewer Bot 为独立治理执行身份，不自动获得业务判断权，须遵循 Review Contract。详见《reviewer-bot-design.md》。

---

## 5. CLI 改动清单（`scripts/cli.mjs`，待授权后执行）

1. `NEED_COLORS`：`{author, reviewer, owner}` → `{author, reviewer, 'issue-owner', 'repo-owner'}`。
2. `setup`：创建 `need:issue-owner`、`need:repo-owner`；删除 `need:owner`（一次性）。
3. `brief`：分组顺序 → `['need:issue-owner','need:repo-owner','need:reviewer','need:author','other']`。
4. `propose`：必须显式 `--assignee <owner-login>`（人类登录名，fail-closed，禁止 bot/`@me`，见 `requireIssueOwner()`）；`setNeed('issue-owner')`（原 owner）。
5. `approve`：前置 Assignee 唯一性校验（0/多值→阻止）。
6. `submit`：建 PR → `status:in-progress` + `need:author`（不再直接 `need:reviewer`），评论「等待 CI 门禁」；记录 `prUrl/head/submittedAt`。
7. **新增 `ci <issue>`**：幂等；`canEnterReview` 全绿→记录 `ciHeadSha` 到 state、`in-review`+`need:reviewer`；否则 `need:author`+失败明细（含 SHA）。
8. `review <issue> --verdict lgtm|changes|blocked --sha <sha>`：先做 R7 角色拦截 + 主体命名空间校验；再按三态处理（消除 SHA 循环依赖）：
   - 读取 state `ciHeadSha`（由 `ci` 记录）；无 `ciHeadSha` 或 PR head ≠ `ciHeadSha` 或 `--sha` ≠ `ciHeadSha` → 视为 BLOCKED。
   - 三态标签转换表（设置与清除并重，防状态残留）：
     | verdict | 必须设置 | 必须清除 |
     |---|---|---|
     | `lgtm` | `review:lgtm`、`need:repo-owner` | `need:author`、`need:reviewer` |
     | `changes` | `need:author` | `review:lgtm`、`need:repo-owner`、`need:reviewer` |
     | `blocked` | `need:reviewer` | `review:lgtm`、`need:repo-owner` |
   - `lgtm`：写结构化记录 `{launcher_role, github_login, reviewer_verdict, reviewed_head_sha: ciHeadSha, reviewed_at, review_id}`；「标签由 CLI 派生」——校验全部通过后 CLI 才应用 `lgtm` 行的设置/清除。
   - `changes`：写结构化记录 + 应用 `changes` 行。
   - `blocked`：写阻塞原因 + 应用 `blocked` 行（**主动清除**已失效的 `review:lgtm` 与 `need:repo-owner`，防止残留）；修复环境（重跑 `ci` 得新 `ciHeadSha` 或纠正 `--sha`）后可重新 `review`。
9. **新增 `merge <issue> --verdict merge|rework`**：四门重检（HEAD==reviewed sha / Required Checks@head 全绿 / LGTM 有效 / gateAudit 0 命中）。
   - `merge`：`gh pr merge --merge` → `verifying` + `need:issue-owner`。
   - `rework`：记录退回理由 → `in-progress` + `need:author`。
10. `verify`：→ `need:issue-owner`（原 owner）。
11. `hold`：→ `need:issue-owner`（原 owner）。
12. `checksGreen` → 重写为 `canEnterReview`（见 §6）。
13. Solo Mode：`autoMerge` 去掉实际 merge，到 merge 门即停，置 `need:repo-owner`。
14. 新增 Assignee 唯一性 helper + OwnerTransfer 事件记录（`lib.mjs` 或 `cli.mjs`）。
15. `approve`/`verify`/`close`：前置 Assignee 唯一性校验（决策④）。
16. `run`/`submit`：记录 `launcher_role` 与 `github_login`（`PL_ROLE` / `PL_TOKEN_BOT`）到 state（审计）。
17. `review`：读取 `PL_ROLE` + `PL_ENFORCE_APP` + `PL_PRINCIPAL`，实施 R7 约束 1–6；`PL_ROLE` 缺失/异常、`PL_ROLE==worker`、或 principal==assignee 时 → fail-closed。
18. `merge <issue>`：前置角色门 —— 要求 `PL_ROLE=owner` + `PL_ENFORCE_APP=1`，否则 fail-closed（Repo Owner 唯一 merge 门）；且 merge 所依赖的有效 LGTM 必须来自 `reviewer` 角色且 SHA 绑定，Repo Owner 自审不满足 merge 独立性（Q3）。
19. `review` 事务/异常（幂等恢复）：写 state 先行（`reviewing` 标记 + 唯一 `review_id`）→ 写结果评论（写前检查 `review_id` 是否已存在，存在则跳过避免重复）→ 再派生标签（派生前**重读当前标签**，按 §5-8 转换表幂等应用）。幂等识别依据 = `issue + PR + head_sha + reviewer + verdict`。异常处理：
   - 中断（state 已写、comment 未写）→ 幂等重放补齐，重放前重跑前置判定（R7 身份 + 三态前置）；HEAD 已变 → BLOCKED，旧 LGTM 不生效。
   - 评论成功、标签失败 → 重试仅补标签，不重复写评论（凭 `review_id` 判重）。
   - 同 SHA 同 reviewer 重复 review → 幂等 no-op。
   - 同 SHA 多 reviewer 并发 → 采用确定性事件顺序（按 `reviewed_at` 时间戳 + `review_id` 字典序），有效 merge LGTM 仅取 `reviewer` 角色者，不写「最新有效者胜出」这类模糊表述（G9）。

---

## 6. `canEnterReview` / `getRequiredChecks` 语义

```
getRequiredChecks(repo, base) -> [{ context, integration_id|null }]:
  required = []
  # 1) Rulesets（现代权威来源，保留 context + integration_id）
  rs_list = GET /repos/{repo}/rulesets   # 失败（403/网络错误）→ 抛错 fail-closed；可返回多个
  for rs in rs_list where rs.enforcement==active and target 匹配 base:
      for sc in rs.rules[type=="required_status_checks"].parameters.required_status_checks:
          required += { context: sc.context, integration_id: sc.integration_id }
  #    ↑ 多个 Ruleset 同时适用时累加，各自 required_status_checks 取并集
  # 2) 传统 Branch Protection（兼容旧仓库，无 integration_id 维度）
  bp = GET /repos/{repo}/branches/{base}/protection
  if bp == 404: 跳过（无 classic protection，预期，非错误）
  if bp 其他错误（403/500）: 抛错 fail-closed
  if bp == 200:
      for ctx in bp.required_status_checks.contexts:
          required += { context: ctx, integration_id: null }
      #   兼容：Branch Protection 除 contexts 外还提供 checks 数组（含 app_id），不可只读 contexts 即宣称完整兼容
      for chk in bp.required_status_checks.checks:
          required += { context: chk.context, integration_id: chk.app_id }
  # 3) 并集去重：key = (context, integration_id)；同 context 不同 integration_id 视为不同检查；并集为空 → 抛错（fail-closed）
  return required

匹配规则（关键）——Check Runs 与 Commit Status 数据结构不同，须分别匹配，不得混用同一套字段：
  Check Run（/check-runs）字段：name / status / conclusion / app.id
  Commit Status（/statuses）字段：context / state（无 conclusion，无 app.id）

  一个 required 项 {context, integration_id} 按下列优先级判定：
  (a) Check Run 匹配：
      name == context 且（integration_id == null 或 app.id == integration_id）
      且 status == completed 且 conclusion == success → 满足
  (b) Commit Status 匹配（仅 integration_id == null 的 legacy 项）：
      context == context 且 state == success → 满足
      （integration_id != null 的项不可用 Commit Status 满足，因 status 无 app.id）
  两者皆无或未成功 → 该 required 项不满足。

canEnterReview(pr):
  head_sha = pr.head.sha
  required = getRequiredChecks(repo, base)        # 空/不可读 → 直接拒绝（G4/G10）
  check_runs = head_sha 的 check-runs（含 app.id）
  statuses   = head_sha 的 commit statuses
  for {context, integration_id} in required:
      cr = check_runs 中 name==context 且（integration_id==null 或 app.id==integration_id）者
      if cr 存在:
          if cr.status != completed → 拒绝       # pending/in_progress/queued
          if cr.conclusion != success → 拒绝     # failure/skipped/neutral/cancelled/timed_out/action_required/stale
          continue
      # 无匹配 Check Run → 尝试 Commit Status（仅 integration_id==null）
      if integration_id == null:
          cs = statuses 中 context==context 者
          if cs 存在 and cs.state == success → continue
      # 都不满足 → 拒绝（G4）
      拒绝
  return { ready: true, head_sha, required }
```

**fail-closed 原则**：skip/neutral/cancelled/pending/缺失/不确定，一律不视作成功，除非仓库显式声明为非必需。

---

## 7. 异常测试矩阵

| # | 场景 | 期望（fail-closed） |
|---|---|---|
| E1 | head 无任何 check runs | 拒绝，「必需检查缺失」 |
| E2 | required contexts 为空 | 拒绝（G4） |
| E3 | Ruleset 端点不可读（403/网络错误）；Branch Protection 返回 404 以外错误（403/500） | 拒绝（fail-closed）；BP 404 属预期，跳过（G10） |
| E4 | 任一 required = failure | 拒绝 |
| E5 | 任一 required = skipped/neutral | 拒绝（不视作成功） |
| E6 | 任一 required = cancelled | 拒绝 |
| E7 | 任一 required = pending/in_progress/queued | 拒绝（非 completed） |
| E8 | 任一 required = timed_out/action_required/stale | 拒绝 |
| E9 | CI 通过 SHA ≠ PR head | 拒绝（G2/G3） |
| E10 | review lgtm 后 push 新 commit | LGTM 失效；ci 重跑；merge 拒绝 |
| E11 | required contexts 被改/清空 | 拒绝并要求重验 |
| E12 | merge 后 verify 失败 | 停 verifying；`need:issue-owner` 待处理；不 close |
| E13 | approve/verify/close 时 0 assignee | 阻止转换 |
| E14 | approve/verify/close 时 >1 assignee | 阻止转换 |
| E15 | assignee 变更 | 记录 OwnerTransfer 事件 |
| E16 | Solo 到 merge 门尝试自动 merge | 停止，置 `need:repo-owner`，不 merge |
| E17 | ci 通过后 push 新 commit | 旧 ci 记录失效，等待新 HEAD 全绿 |
| E18 | LGTM 无 SHA / SHA 不全 | 视为无有效 LGTM，拒绝 |
| E19 | `PL_ROLE=worker` 执行 review | 拒绝（Worker 不得审） |
| E20 | `PL_ROLE=reviewer` 且 principal == assignee | 拒绝（Issue Owner 不得审） |
| E21 | `PL_ROLE` 缺失 / `PL_ENFORCE_APP!=1` / 身份异常 | 拒绝（fail-closed，约束6） |
| E22 | `PL_ROLE=reviewer` 且 principal != assignee | 允许 |
| E23 | `PL_ROLE=owner` 且 principal != assignee | 允许（Repo Owner 兼任 Reviewer） |
| E24 | `PL_ROLE=owner` 且 principal == assignee | 拒绝（Repo Owner 同时是 Issue Owner） |
| E25 | review 中断（state 已写、comment 未写） | 幂等重放补齐 comment+标签，不重复；重放前重跑前置判定，HEAD 已变 → BLOCKED 不补旧 LGTM（G9） |
| E26 | review 结果写入失败（comment 成功、标签失败） | 凭 `review_id` 判重，重试仅补标签不重复写评论；无半状态（G9） |
| E27 | 重复/并发 review（同 SHA 同 reviewer / 多 reviewer） | 同 reviewer 幂等 no-op；多 reviewer 按确定性事件顺序（`reviewed_at`+`review_id`），有效 merge LGTM 仅取 `reviewer` 角色（G9） |
| E28 | review 时 PR head ≠ `ciHeadSha` | BLOCKED，保持 `need:reviewer`，不 LGTM 不退回；须重跑 `ci` 得新 `ciHeadSha`（G8） |
| E29 | 标签残留（LGTM 后 HEAD 变 → 重新 review 得 BLOCKED/CHANGES） | BLOCKED/CHANGES 主动清除 `review:lgtm`+`need:repo-owner`（§5-8 转换表） |

---

## 8. 历史 Issue 迁移方案（基于 2026-11-20 open 快照）

| # | 现关键标签 | 迁移动作 | Assignee 回填 |
|---|---|---|---|
| #84 | candidate / need:owner | need:owner → need:issue-owner | 是 |
| #81 | hold / need:owner | need:owner → need:issue-owner | 是 |
| #21 | hold / need:owner | need:owner → need:issue-owner | 是 |
| #4  | decision-hold / need:owner | need:owner → need:issue-owner | 是 |
| #80 | approved / need:author | 不变 | 是 |

**迁移步骤**
1. `setup` 创建 `need:issue-owner`、`need:repo-owner`。
2. 对 4 个 `need:owner` issue 加 `need:issue-owner`、移除 `need:owner`。
3. 删除 `need:owner` 标签。
4. 为 5 个 open issue 回填单一 assignee（人类 owner 或实际认领人）——否则决策④会 fail-closed 所有 owner 动作。
5. 校验：open 快照中不存在「in-review + review:lgtm」需要 `need:repo-owner` 的 issue（当前无）。

---

## 9. 交付物清单与授权边界

交付物：
1. Governance V2 决策 Issue（正文见本文档 §3–§4；立项待 Master 授权）。
2. 状态机与标签迁移矩阵（§2/§3/§8）。
3. CLI 改动清单（§5）。
4. Required Checks 配置报告（§0/§1）。
5. 完整异常测试矩阵（§7）。
6. 历史 Issue 迁移方案（§8）。

授权边界（STOP 项，需 Master/Repo Owner 逐项放行）：
- Branch Protection 变更：❌（Repo Owner）
- Ruleset `strict_required_status_checks_policy` 置 true：❌（Repo Owner）
- `.github/workflows/ci.yml` 修改：❌（Repo Owner）
- `scripts/cli.mjs` 实现 §5：⏸（待 Master 授权）