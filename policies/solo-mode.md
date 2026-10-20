# Solo Mode Policy V1（单人开发自治模式）

> 状态：**PILOT — 受控试运行中（仅限试运行 Issue 清单 §8）；持续自动合并未启用，
> 待 Owner 对最终自治权限配置一次性批准后改为 ACTIVE**
> 生效范围：`repo:codegraph`（sunSUNQ/provenlattice）；`repo:tasco` 暂不启用。
> 工单：PL-ISSUE-PILOT-SOLO-MODE-V1 · 本文件与 AGENTS.md 冲突时，以 AGENTS.md
> 的 Owner Gate 条款为准。

## 1. 目标

单人开发（owner = 唯一人类开发者）场景下，普通开发任务由 Agent 自动推进
至 verified → close；Owner 只参与产品决策、正式研究资格和高风险授权。
保留两道已验证有效的质量门：独立复审、CI 全绿。

## 2. 状态机（自动流转）

```text
candidate → approved → in-progress(implementing) → in-review(submitted/reviewing)
          → [review:lgtm] → merging → verifying → verified → closed
分流：need:owner（gate 拦截 / 决策）· hold（失败超阈值 / 等待授权）· blocked
```

标签映射（沿用现有 label，新增 2 个）：

| 流转阶段 | label |
|---|---|
| candidate / approved / implementing | `status:candidate` / `status:approved` / `status:in-progress` |
| submitted / reviewing / lgtm | `status:in-review`（lgtm 由 `review:lgtm` 标签表达） |
| merging | `status:in-review`（瞬时态，state 文件记录） |
| verifying | `status:verifying`（新增） |
| verified / closed | `status:verified` / 关闭 |
| hold | `status:hold`（新增）+ `need:owner` |

命令：`advance <issue>`（幂等单步推进）、`autopilot <issue>`（循环推进至
hold/closed/无进展）。每步写 state 文件（操作者、HEAD、依据、结果、证据），
支持断点恢复；幂等（重复执行不重复 approve / 不重复 submit / 不重复 merge）。

## 3. AUTO 清单（无需 Owner 中转）

1. `type:bug` / `type:maintenance` / `type:research` 的 Issue 自动批准
   （前置：正文含五要素〔观察证据/期望行为/反例或失败条件/允许修改范围/
   验收方式〕+ `search` 查重无命中 + policy 自动推进范围）。
2. 去重、复现、实现、测试；commit / push / 创建 PR。
3. 独立复审派发（`need:reviewer`；由未参与实现的 Agent 或人认领）及
   最多两轮针对性修复（修复仅定向回归，重大修改再扩展测试）。
4. 自动 merge（见 §5 质量门，全部满足才执行）。
5. 合并后验证、证据归档、verified → close。

## 4. OWNER_GATE 清单（自动路径必须升级，不得绕过）

1. Release、tag、版本号、PyPI。
2. 破坏性数据 schema 与 edge 语义变更。
3. 新增或实质扩大生产能力契约。
4. Formal 协议、Gold、资格判定（QUALIFIED）、实验预算。
5. Secrets、权限扩大、部署、仓库保护变更。
6. 超出既定 policy 的工作。
7. 本地 main 历史重写（push/reset/rebase/覆盖 37 个未推送提交）与
   用户 v1.4 文件变更。
8. policy / AGENTS.md / 本文件的修改（Agent 不得修改 policy 扩权）。

文件级 gate 检测（自动 merge 前强制）：

| 触碰即升级 | 文件 |
|---|---|
| 权限/协议 | `policies/**`、`AGENTS.md`、`config/**` |
| 版本/发布 | `pyproject.toml`、dist/diff 含 `version =` 变更 |
| Schema | diff 含 `CREATE TABLE` / `ALTER TABLE`；`src/provenlattice/storage.py` |
| Workflow 授权面 | `.github/workflows/**` 中 diff 触碰 `permissions:`、`secrets`、`on:` 触发器（测试 job/矩阵/artifact 的白名单内修改预授权） |
| 资格声明 | diff 新增 `QUALIFIED`（大小写敏感）字样于正式文档 |

## 5. 自动合并质量门（全部满足）

1. PR head == state 文件记录的精确 HEAD。
2. 该 HEAD 的 CI checks 全部 success（不重跑有效 CI）。
3. `review:lgtm` 存在且其记录的 SHA == PR head；reviewer 非实现者
   （流程约束：派发时 `need:reviewer`，实现者窗口不得认领）。
4. PR 变更文件全部在允许范围内（§4 文件级 gate 零命中）。
5. 失败计数：复审 changes ≥ 2 轮或 CI 同一 HEAD 失败 ≥ 2 次 → `hold`。

## 6. 保护机制

- main 分支保护由 Owner 启用（现状：**未启用**，404——Owner 待办）。
- 不 force push；不自动 Release/PyPI；不自动打 tag。
- 不覆盖本地 main 的 37 个未推送提交与用户 v1.4 文件（只读对账除外）。
- 未经 Formal 的结果不得标 QUALIFIED（§4 diff 检测）。
- 全部自动操作留痕：state 文件 + Issue 评论（操作者、HEAD、依据、证据）。

## 7. 权限矩阵

| 动作 | Agent（自动） | Agent（实现窗口） | Reviewer 窗口 | Owner |
|---|---|---|---|---|
| propose / approve(AUTO 清单内) | ✅ / ✅ | ✅ / — | ✅ / ✅ | ✅ |
| approve(OWNER_GATE) | ❌→升级 | ❌ | ❌ | ✅ |
| 实现 / commit / push(分支) / 建 PR | ✅ | ✅ | — | ✅ |
| 独立复审 | ❌(实现窗口) | ❌ | ✅ | ✅ |
| merge（§5 门全过） | ✅ | ❌(自身 PR) | ❌ | ✅ |
| merge（gate 命中） | ❌→hold | ❌ | ❌ | ✅ |
| Release / tag / PyPI | ❌ | ❌ | ❌ | ✅ |
| policy 修改 | ❌ | ❌ | ❌ | ✅ |

## 8. 受控试运行（Step 4）

5 个低风险 Issue（P1 重载 signature 观察、P2 stage0 同步〔预期 gate/hold〕、
P3 验证 fixture 反例、P4 defect-guide 状态同步、P5 版本号变更〔预期 gate 拦截〕），
验证：自动批准、派发、独立复审、修复重审、CI 门、自动合并、关闭、
gate 拦截、中断恢复。不得降低检查条件换取 PASS。

## 9. 回滚方案

1. AGENTS.md 与本文件声明"已停用"（一条评论/一次提交即可）——所有自动
   命令入口检查 `policies/solo-mode.md` 的 `状态：` 行，非 ACTIVE 即拒绝。
2. 已建 PR 人工走既有 owner 流程（review/merge 命令不变，仅自动路径停用）。
3. state 文件删除即失去幂等记忆，重新执行 advance 会安全停在各"等待"态
   而不会重复 merge（merge 前 HEAD 绑定 + lgtm SHA 校验兜底）。
4. 分支保护启用后自动路径天然受 GitHub 侧约束。

## 10. Step 0 现状核查记录（2026-10-20）

- issue-pilot 仓库：sunSUNQ/issue-pilot；worktreeRoot=D:\tasco-temp\issue-pilot\worktrees。
- CLI：propose/approve/run/submit/review/verify/close + need:* 自动维护（6ab63d3）。
- provenlattice main 分支保护：**未启用**（API 404）→ Owner 待办（§6）。
- 本地 main 与 origin/main：平行历史，本地领先 37 commit（含 stage0 报告、
  callers closure；只读对账于试运行 Issue P2 处理）。
- 开放 Issue：#4 decision(owner gate) · #5 research(approved，他窗实现中) ·
  #6 research(candidate)。
- CI：3 job（test-windows / test-linux / linux-jdt-verify），全绿基线在案。
