# Governance V2 — 完整验收矩阵

> 状态：设计交付物，供 Master 逐条合同复核。
> 范围：G1–G10（CI Gate 验收）· R1–R5（Review Contract 判定维度）· R7 约束（复审独立性）· E1–E29（异常测试）· T1–T22（联动测试）。
> 每项状态默认「未验收（待实现）」；`指令` 列标注该项由哪条 CLI/权限规则落实。

---

## 一、G1–G10 · CI Gate 验收项

| # | 验收项 | 验收判据 | 指令落点 |
|---|---|---|---|
| G1 | CI 未全绿不得加 `need:reviewer` | `ci <issue>` 仅在全绿时置 `need:reviewer`，否则 `need:author` | cli §5-7 |
| G2 | CI 必须与 PR HEAD SHA 一致 | 结果与 `pr.head.sha` 绑定，不一致拒绝 | cli §5-7 / §6 |
| G3 | 新提交自动使旧 CI Gate 失效 | push 后旧 `ciHeadSha` 失效，须重跑 `ci` | cli §5-7 |
| G4 | 缺失/失败/运行中/不确定状态 fail-closed | skip/neutral/cancelled/pending/缺失均不视作成功 | §6 |
| G5 | 只有 CI 门禁通过后才允许 Reviewer 接管 | 未 `ciHeadSha` 前 review 一律 BLOCKED | cli §5-8 |
| G6 | Repo Owner Merge 前再次确认最新 HEAD CI | `merge` 四门重检 HEAD==reviewed sha + Required Checks@head 全绿 | cli §5-9 |
| G7 | Reviewer Bot 只提交结构化结果，CLI 派生标签 | Bot 不改标签；`lgtm`→`review:lgtm`+`need:repo-owner` 由 CLI 派生 | cli §5-8 |
| G8 | Review 三态 LGTM/CHANGES/BLOCKED | BLOCKED 前置未满足，不构成代码判定；按 §5-8 标签转换表设置/清除，BLOCKED/CHANGES 主动清除已失效 `review:lgtm`+`need:repo-owner` | cli §5-8 |
| G9 | Review 幂等且可恢复 | 以 `review_id`+`issue+PR+head_sha+reviewer+verdict` 为幂等依据；中断/写入失败/重复/并发/HEAD 变化均有确定性处理，无重复/矛盾标签 | cli §5-19 |
| G10 | Required Checks 保留 context+integration_id | 多 Ruleset 累加并集；Check Runs 与 Commit Status 分别匹配（字段不同，不混用）；Rulesets 不可读或空 → fail-closed | §6 |

---

## 二、R1–R5 · Review Contract 判定维度

Reviewer Bot 实质审查五维度，**全部覆盖 → LGTM，任一不过 → CHANGES**；证据不足 → 显式「无法确认」，不得推断通过。

| # | 维度 | 要求 | 不满足 → |
|---|---|---|---|
| R1 | 合同符合性 | 实现与 Issue 冻结合同**逐项对应**（五要素逐条映射 diff） | CHANGES |
| R2 | 修改范围 | 无超出允许修改目录/文件；`gateAudit` 0 命中 | CHANGES |
| R3 | 语义正确性 | 不只测试通过，须核对实现语义真满足合同 | CHANGES |
| R4 | 回归与兼容 | 检查原功能、版本号、公开接口/schema 兼容性，无回归破坏 | CHANGES |
| R5 | 证据完整性 | 结论引用 Diff、代码位置、测试、CI 证据；证据不足显式「无法确认」 | CHANGES / 无法确认 |

---

## 三、R7 约束 · 复审独立性（Launcher 角色隔离）

判定基础 = Launcher 角色（`PL_ROLE`），**非** GitHub Login 相异；Login 仅审计。

| 约束 | 内容 | 违反 → |
|---|---|---|
| R7-1 | Worker Launcher 不得执行 Reviewer 操作 | fail（`PL_ROLE==worker` 拒绝） |
| R7-2 | Issue Owner 不得执行当前 Issue 的 Reviewer 操作 | fail（principal==assignee） |
| R7-3 | Repo Owner 仅在其不同时担任本 Issue Owner 时，才可兼任 Reviewer（仅记录，不产有效 merge LGTM） | fail（owner+principal==assignee） |
| R7-4 | 独立 Reviewer Launcher 是专用 Reviewer 身份的必要条件；仅其产出有效 merge LGTM | fail（role ∉ {reviewer, owner}） |
| R7-5 | GitHub Login 仅作审计，不作为跨角色必须不同的硬条件 | —（记录 `github_login`） |
| R7-6 | 角色无法确认/身份异常/边界破坏 → fail-closed | fail（`PL_ENFORCE_APP!=1` / `PL_TOKEN_BOT≠PL_EXPECTED_BOT` / 无法自校验） |

**审查资格 × merge 有效性矩阵（R7-3 / R7-4 澄清）**
| 执行身份 | 能否执行 review | 能否产生有效 merge LGTM |
|---|---|---|
| Worker Launcher | 否 | 否 |
| Reviewer Launcher | 是 | 是 |
| Owner Launcher（非本 issue owner） | 是 | 否 |
| Owner Launcher（是本 issue owner） | 否 | 否 |

**主体命名空间（修订1）**
- `PL_PRINCIPAL` 必须是合法 GitHub 主体（人类/bot login 形态），与 assignee 同命名空间才可比。
- 无法确认（principal 缺失/非法、无法解析、assignee 缺失/多值、任一方无法求值）→ 一律 fail-closed。

**身份校验（通用+角色专属，review 前置）**
通用：`PL_ENFORCE_APP==1` · `PL_ROLE∈{worker,reviewer,owner}` · token 自校验 · 无参数可覆盖。角色专属：reviewer→`pl-issue-reviewer[bot]` · owner→`sunSUNQ` · worker→`pl-issue-worker[bot]`。任一失败 → fail-closed。

**merge 独立性（Q3 铁律）**
- `merge` 仅 `PL_ROLE=owner`。
- merge 依赖的有效 LGTM 必须来自 `reviewer` 角色且 `reviewed_head_sha == PR head`。
- Repo Owner 自己的 review 仅作记录，不满足 merge 独立性。

---

## 四、E1–E28 · 异常测试矩阵

| # | 场景 | 期望（fail-closed） |
|---|---|---|
| E1 | head 无任何 check runs | 拒绝，「必需检查缺失」 |
| E2 | required contexts 为空 | 拒绝（G4/G10） |
| E3 | Ruleset 端点不可读（403/网络错误）；Branch Protection 返回 404 以外错误 | 拒绝（fail-closed）；BP 404 属预期，跳过（G10） |
| E4 | 任一 required = failure | 拒绝 |
| E5 | 任一 required = skipped/neutral | 拒绝（不视作成功） |
| E6 | 任一 required = cancelled | 拒绝 |
| E7 | 任一 required = pending/in_progress/queued | 拒绝（非 completed） |
| E8 | 任一 required = timed_out/action_required/stale | 拒绝 |
| E9 | CI 通过 SHA ≠ PR head | 拒绝（G2/G3） |
| E10 | review lgtm 后 push 新 commit | LGTM 失效；ci 重跑；merge 拒绝 |
| E11 | required contexts 被改/清空 | 拒绝并要求重验 |
| E12 | merge 后 verify 失败 | 停 verifying；`need:issue-owner` 待处理；不 close |
| E13 | approve/verify/close 时 0 assignee | 阻止转换（决策④） |
| E14 | approve/verify/close 时 >1 assignee | 阻止转换（决策④） |
| E15 | assignee 变更 | 记录 OwnerTransfer 事件 |
| E16 | Solo 到 merge 门尝试自动 merge | 停止，置 `need:repo-owner`，不 merge（决策⑤） |
| E17 | ci 通过后 push 新 commit | 旧 ci 记录失效，等待新 HEAD 全绿 |
| E18 | LGTM 无 SHA / SHA 不全 | 视为无有效 LGTM，拒绝 |
| E19 | `PL_ROLE=worker` 执行 review | 拒绝（R7-1） |
| E20 | `PL_ROLE=reviewer` 且 principal == assignee | 拒绝（R7-2） |
| E21 | `PL_ROLE` 缺失 / `PL_ENFORCE_APP!=1` / 身份异常 | 拒绝（R7-6 fail-closed） |
| E22 | `PL_ROLE=reviewer` 且 principal != assignee | 允许 |
| E23 | `PL_ROLE=owner` 且 principal != assignee | 允许（Repo Owner 兼任 Reviewer，但 merge 门不承认其为独立 LGTM） |
| E24 | `PL_ROLE=owner` 且 principal == assignee | 拒绝（R7-3） |
| E25 | review 中断（state 已写、comment 未写） | 幂等重放补齐 comment+标签，不重复；重放前重跑前置判定，HEAD 已变 → BLOCKED 不补旧 LGTM（G9） |
| E26 | review 结果写入失败（comment 成功、标签失败） | 凭 `review_id` 判重，重试仅补标签不重复写评论；无半状态（G9） |
| E27 | 重复/并发 review（同 SHA 同 reviewer / 多 reviewer） | 同 reviewer 幂等 no-op；多 reviewer 按确定性事件顺序（`reviewed_at`+`review_id`），有效 merge LGTM 仅取 `reviewer` 角色（G9） |
| E28 | review 时 PR head ≠ `ciHeadSha` | BLOCKED，保持 `need:reviewer`，不 LGTM 不退回，须重跑 `ci`（G8） |
| E29 | 标签残留（LGTM 后 HEAD 变 → 重审得 BLOCKED/CHANGES） | BLOCKED/CHANGES 主动清除 `review:lgtm`+`need:repo-owner`（§5-8 转换表） |

---

## 五、T1–T22 · CI Gate × R7 × Merge Gate 联动测试

| # | 场景 | 期望 |
|---|---|---|
| T1 | worker submit → PR → CI 未绿 | `ci` 拒绝转 reviewer，`need:author` |
| T2 | CI 全绿 | `ci` 记录 `ciHeadSha` → `need:reviewer` |
| T3 | worker（PL_ROLE=worker）执行 review | R7 fail（约束1） |
| T4 | reviewer bot（principal=pl-issue-reviewer[bot]）LGTM | 允许 → `need:repo-owner` + 结构化记录 |
| T5 | owner launcher（principal=sunSUNQ==assignee）review | R7 fail（约束3） |
| T6 | owner launcher review，assignee≠sunSUNQ | 允许产生 review，但 merge 门不承认其为独立 LGTM（Q3） |
| T7 | LGTM 后 push 新 commit | LGTM 失效；ci 重跑；merge 拒绝（G2/G3） |
| T8 | owner merge：reviewer 角色 LGTM + 四门全过 | `gh pr merge --merge` → `verifying`+`need:issue-owner` |
| T9 | owner merge：任一门不过 | 拒绝，`rework` 记录理由 → `need:author` |
| T10 | PL_ROLE 缺失 / PL_ENFORCE_APP!=1 / PL_TOKEN_BOT≠PL_EXPECTED_BOT | fail-closed（约束6/Q2） |
| T11 | reviewer bot 尝试 merge | 拒绝（无权限 + CLI 要求 PL_ROLE=owner） |
| T12 | reviewer bot 尝试改代码 / 改标签绕过 CI | 拒绝（权限边界 + CLI） |
| T13 | Required Checks 配置被清空 | `ci`/`review`/`merge` 全部 fail-closed（G4/G10） |
| T14 | assignee 为空/多值 时 review | fail-closed（决策④ + R7 命名空间） |
| T15 | 仅 owner 自审 LGTM（无 reviewer 角色 LGTM） | merge 拒绝（merge 独立性不满足，Q3） |
| T16 | reviewer bot 证据不足 | 输出「无法确认」/ CHANGES，不得 LGTM（R5） |
| T17 | 需 CHANGES 的场景被默认为 LGTM | 契约违约，判为 CHANGES 路径缺失（硬禁止5） |
| T18 | 语义正确性未核对（仅测试绿） | CHANGES（R3 不满足） |
| T19 | reviewer 提交结构化结果 → CLI 派生标签 | `review:lgtm` + `need:repo-owner` 由 CLI 派生，Bot 不直接改标签（G7） |
| T20 | 前置未满足（无 `ciHeadSha` / HEAD 变化）review | BLOCKED，不 LGTM 不退回（G8） |
| T21 | review 中断 / 评论成功标签失败 后重放（同 SHA 同 verdict） | 凭 `review_id` 判重，幂等恢复：不重复写评论、仅补标签（G9） |
| T22 | 跨 app 同名 context 的 Required Check | 不匹配 integration_id → 不视作通过（G10） |

---

## 六、覆盖与关联检查

- **G 类**：G1–G6 为 CI Gate 基线，G7–G10 为本轮新增（标签派生 / 三态 / 幂等 / 二元组 + 三分数据结构）。
- **R 类**：R1–R5 为 Review Contract 实质审查维度；R7-1…R7-6 + 审查资格×merge 有效性矩阵 + 命名空间 + 身份校验（通用+角色专属）为独立性硬门。
- **E 类**：E1–E18 为 CI/Merge 异常基线，E19–E24 为 R7 身份异常，E25–E29 为本轮新增（review 事务异常 + 标签残留清理）。
- **T 类**：T1–T18 为端到端联动基线，T19–T22 为本轮新增（标签派生 / BLOCKED / 幂等 / 跨 app context）。

**三条治理边界贯穿校验**
1. Reviewer 只读产品仓库 —— 读 App 对 provenlattice 零写权限（方案 B 双 App）、T11/T12。
2. Review 结果可追溯 —— 结构化记录 `{launcher_role, github_login, reviewer_verdict, reviewed_head_sha, reviewed_at, review_id}`、T4。
3. Merge 权限独立于 Review —— merge 仅 `PL_ROLE=owner`、merge 独立性铁律、T11/T15。
4. Reviewer 不改治理标签 —— 写 App Issues:Write 权限层无法拆分，由协议层闭环（Review Contract 硬禁止 + CLI 派生 + 审计）保证，@reviewer-bot-design.md §2。
5. 审查资格 ≠ merge 有效性 —— 只有 Reviewer Launcher 产出有效 merge LGTM；Owner Launcher 兼任复审仅作记录（R7-3/R7-4）。