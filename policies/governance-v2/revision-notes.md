# Governance V2 — 最终合同修订差异说明

> 任务：GOVERNANCE-V2-FINAL-CONTRACT-REFINEMENT
> 状态：设计交付物，供 Master 逐条合同复核。
> 边界：不创建 App、不生成/修改 Token、不修改 Launcher、不修改 cli.mjs、不修改 Rulesets、不开 Strict Mode。

本文记录本轮 5 项合同修订的**改前 → 改后**差异与落地位置，作为 Master 复核的对照索引。

---

## 修订 1 · PL_PRINCIPAL 主体命名空间与无法确认处理

| 项 | 内容 |
|---|---|
| 动机 | Master 指出：`PL_PRINCIPAL` 必须能与 GitHub Assignee 可靠比对，否则约束 2/3「是否兼任 issue owner」无法判定。 |
| 改前 | `PL_PRINCIPAL` 是「治理主体」自由字符串（reviewer→`pl-issue-reviewer`、worker→`pl-issue-worker`），未要求 GitHub login 形态，未定义无法确认时的处理。 |
| 改后 | `PL_PRINCIPAL` 必须是**合法 GitHub 主体**（人类 login 或 bot login 形态，如 `sunSUNQ` / `pl-issue-reviewer[bot]`），与 GitHub Assignee **同命名空间**才可直接比对；不接受自由字符串。无法确认时**一律 fail-closed**（4 条）。 |

**落地位置**
- `reviewer-bot-design.md` §1：注入 env `PL_PRINCIPAL=pl-issue-reviewer[bot]`（GitHub-login 形态）。
- `reviewer-bot-design.md` §3：字段定义表取值示例改为带 `[bot]` 后缀；分角色取值表 worker/reviewer 均改为 `pl-issue-worker[bot]` / `pl-issue-reviewer[bot]`；新增「主体命名空间与无法确认处理」小节。
- `reviewer-bot-design.md` §4：review 允许性判定中 `principal` 缺失/非法（非 GitHub 主体形态）→ fail。

**无法确认时的 4 条 fail-closed 处理**
1. `PL_PRINCIPAL` 缺失 / 空 / 不符合 GitHub login 形态 → 拒绝 review。
2. `PL_PRINCIPAL` 无法解析为可比 GitHub 主体 → 拒绝 review。
3. assignee 缺失或多值 → 拒绝 review（决策④）。
4. 任一方无法求值时，视为「可能兼任 issue owner」，按 fail-closed 拒绝。

---

## 修订 2 · getRequiredChecks 保留 context + integration_id

| 项 | 内容 |
|---|---|
| 动机 | 原实现只返回 `context` 字符串列表，跨 App 同名 context 会被误判为同一 required check，存在绕过风险。 |
| 改前 | `getRequiredChecks` 返回 `context` 字符串列表；Rulesets 优先、Branch Protection 兼容，按 context 名并集去重。 |
| 改后 | 返回 `[{ context, integration_id\|null }]` 二元组；Rulesets 保留 `context` + `integration_id`，Branch Protection 记 `integration_id: null`；并集去重 key = `(context, integration_id)`；任一来源不可读或并集为空 → fail-closed。 |

**匹配规则（关键）**
- `integration_id != null`：head 上 `name==context` 的 check 还须 `app.id == integration_id`，跨 App 同名 context 不算满足。
- `integration_id == null`：仅按 context 名匹配（legacy）。

**落地位置**
- `design.md` §6：`getRequiredChecks` 伪代码、匹配规则、`canEnterReview` 全部重写。
- `design.md` §4：新增 **G10**（二元组保留 + 并集 + fail-closed）。
- 关联 `reviewer-bot-design.md` §6 **T22**（跨 app 同名 context 不匹配 integration_id → 不视作通过）。

---

## 修订 3 · Reviewer Bot 只提交结构化结果，CLI 派生标签

| 项 | 内容 |
|---|---|
| 动机 | Master 明确：标签流转须由 Governance CLI 确定性派生，Reviewer Bot 不得自由改标签（防绕过 CI Gate）。 |
| 改前 | Bot 写结果 **并设置 `review:lgtm`**；`CHANGES` 输出直接「置 `need:author`」。 |
| 改后 | Bot **只提交结构化 Review 结果**（评论 + state 记录），**不直接改标签**；标签由 CLI 依据结果派生。 |

**CLI 标签派生规则**
- `lgtm` → `review:lgtm` + `need:repo-owner`
- `changes` → `need:author`
- `blocked` → 标签不变

**落地位置**
- `reviewer-bot-design.md` §0 数据流、§2 安装范围表（写侧目的改为「写结构化 review 结果（评论）」）、权限明细表（Issues:Write 理由改为「标签由 CLI 派生」）。
- `reviewer-bot-design.md` §5 输出三态 + 新增「结果与标签的职责边界」小节。
- `design.md` §4 新增 **G7**；§5 项 8（`lgtm` 分支「标签由 CLI 派生」）。
- 关联 `reviewer-bot-design.md` §6 **T19**。

---

## 修订 4 · 消除 LGTM SHA 循环依赖 + 三态输出

| 项 | 内容 |
|---|---|
| 动机 | 原 LGTM 前置门要求「`reviewed_head_sha == PR head`」，但 LGTM 尚未产生即要求其 SHA 与 head 一致，构成循环依赖。 |
| 改前 | `review lgtm` 需「重跑 CI 门 + 校验 `reviewed_head_sha == PR head`」；输出仅 LGTM / CHANGES 两态。 |
| 改后 | 引入 `state.ciHeadSha` 单向链：`ci` 全绿时记录 head → `review` 绑定 `ciHeadSha` → `merge` 复核 head。review 采用 **LGTM / CHANGES / BLOCKED** 三态。 |

**三态定义**
- `BLOCKED`：无 `ciHeadSha` / PR head ≠ `ciHeadSha` / `--sha` ≠ `ciHeadSha` / 身份异常；前置未满足，**不构成代码判定**，不推进不退回。
- `CHANGES`：实质审查不满足 R1–R5。
- `LGTM`：绑定 `reviewed_head_sha: ciHeadSha`。

**落地位置**
- `design.md` §3 状态机图（BLOCKED 分支 + LGTM「绑定 green head SHA」）。
- `design.md` §5 项 7（`ci` 记录 `ciHeadSha`）、项 8（三态处理，消除循环依赖）。
- `design.md` §4 R7 记录字段 `reviewer_verdict ∈ {lgtm, changes, blocked}`；新增 **G8**。
- `reviewer-bot-design.md` §5「前置判定（消除 SHA 循环依赖 —— 三态第一层）」+ 输出三态。
- 关联 `design.md` §7 **E28**、`reviewer-bot-design.md` §6 **T20**。

---

## 修订 5 · Review 异常处理（中断 / 写入失败 / 幂等 / 重复 / HEAD 变化）

| 项 | 内容 |
|---|---|
| 动机 | Master 要求补齐 review 的异常路径，避免中断或失败产生半状态、重复标签、矛盾标签。 |
| 改前 | 无 review 事务/异常处理定义。 |
| 改后 | 明确事务顺序与 5 类异常处理。 |

**事务顺序（写入顺序 = 恢复依据）**
1. 写 state 先行（`reviewing` 标记）。
2. 写结果评论。
3. 再派生标签。

**异常处理**
- 中断（state 已写、comment 未写）→ 幂等重放补齐 comment+标签，不重复。
- 写入失败（comment/标签失败）→ 无标签应用或可回滚；可重试；无半状态。
- 重复 review（同 SHA 同 reviewer）→ 幂等 no-op。
- 重复 review（同 SHA 不同 reviewer）→ 记录并存，最新有效者胜出。
- HEAD 变化（review 时 PR head ≠ `ciHeadSha`）→ BLOCKED，保持 `need:reviewer`，不 LGTM 不退回，须重跑 `ci`。

**落地位置**
- `design.md` §5 新增项 19（review 事务/异常）。
- `design.md` §7 新增 **E25–E28**。
- `design.md` §4 新增 **G9**。
- 关联 `reviewer-bot-design.md` §6 **T21**。

---

## 新增验收项汇总

| 类别 | 新增编号 | 归属文件 |
|---|---|---|
| 验收项 G | G7（CLI 派生标签）、G8（三态）、G9（幂等恢复）、G10（二元组并集） | design.md §4 |
| 异常测试 E | E25（中断重放）、E26（写入失败）、E27（重复 review）、E28（HEAD 变化 → BLOCKED） | design.md §7 |
| 联动测试 T | T19（CLI 派生标签）、T20（前置未满足 → BLOCKED）、T21（中断幂等）、T22（跨 app 同名 context） | reviewer-bot-design.md §6 |

---

## Final Contract Review 复核补充修订（4 处精确化）

Master 最终合同复核提出的四个关注点中，发现正文 3 处真实缺口/矛盾，逐条修正如下：

### 复核补充 1 · BLOCKED 状态机语义统一（修正矛盾）

- **问题**：状态机图 §3 写 `BLOCKED → need:author`，与正文 G8/E28「不推进不退回」矛盾。
- **修正**：状态机图 BLOCKED 箭头改为 `need:reviewer`（保持）；G8 + §5-8 `blocked` 分支 + reviewer-bot-design §5 输出三态统一为四要素：**保持 `need:reviewer` / 禁止生成 `review:lgtm` / 禁止进入 `need:repo-owner` / 修复环境后可重新 review**；E28 措辞由「回到 CI Gate」改为「保持 need:reviewer，须重跑 ci」。

### 复核补充 2 · Ruleset 不可读 vs Branch Protection 404 区分（修正矛盾）

- **问题**：§6 伪代码「任一来源不可读 → 抛错」与 §0「BP 404 预期」冲突；多 Ruleset 并集语义未显式。
- **修正**：§6 `getRequiredChecks` 明确：`GET /rulesets` 失败（403/网络错误）→ fail-closed；BP 404 → 跳过（预期）；BP 其他错误（403/500）→ fail-closed；多个 Ruleset 累加并集；E3 拆分两者；G10 补「同 context 不同 integration_id 视为不同检查」。

### 复核补充 3 · 恢复重放前置判定（补缺口）

- **问题**：§5-19 幂等重放未显式要求重放前重跑 HEAD 一致性，旧 HEAD LGTM 可能在恢复中重新生效。
- **修正**：§5-19 补「恢复重放前必须先重跑前置判定（R7 身份 + 三态前置：`ciHeadSha` 存在且 PR head == `ciHeadSha`）；HEAD 已变 → BLOCKED，旧 LGTM 不生效」；E25 补强。

### 复核补充 4 · Reviewer Bot 权限闭环（补澄清）

- **问题**：`Issues: Write` 在 GitHub 权限层无法拆分为「只写评论不改标签」，需明确约束层次。
- **修正**：reviewer-bot-design §2 补「权限层 vs 协议层」：Bot 不改标签是**协议层约束**（Review Contract 硬禁止 + CLI 派生 + 审计），非 GitHub 权限层约束；acceptance-matrix「三条治理边界」追加第 4 条。

---

## GOVERNANCE-V2-FINAL-CONSISTENCY-REPAIR 修复记录（本轮 8 项）

Master 最终违规核验提出 8 个问题（P0×3 + P1×3 + 治理澄清×2），逐项修复：

### P0-1 · R7 身份定义逻辑矛盾（修正）
- **问题**：§4 R7 约束 3（owner 可审）与约束 4（必须 reviewer launcher）矛盾；reviewer-bot-design §4 身份校验强制 `PL_ROLE==reviewer`，Owner Launcher 符合 R7-3 却无法通过校验。
- **修正**：R7-3 →「兼任复审仅记录，不产有效 merge LGTM」；R7-4 →「独立 Reviewer Launcher 是专用 Reviewer 身份的必要条件，仅其产出有效 merge LGTM」；新增「审查资格 × merge 有效性矩阵」；身份校验拆「通用校验 + 角色专属校验」。

### P0-2 · Reviewer App 权限模型（修正，方案 B）
- **问题**：单 App 逐仓库权限描述不成立——GitHub App 权限是 App 级 / installation 级，非逐仓库。
- **修正**：采纳方案 B，拆两个 App：`pl-issue-reviewer-read[bot]`（只读 provenlattice，无 Issues）+ `pl-issue-reviewer-write[bot]`（只写 issue-pilot 评论）；Launcher 双 token（`PL_GIT_TOKEN` 读 / `PL_WRITE_GIT_TOKEN` 写）。

### P0-3 · Required Checks 数据结构闭环（修正）
- **问题**：Check Runs 与 Commit Status 字段不同（`name/status/conclusion/app.id` vs `context/state`），原伪代码合并用同一套匹配。
- **修正**：§6 分别匹配；Commit Status 仅满足 integration_id==null 的 legacy 项；Branch Protection 兼容补读 `checks` 数组（含 app_id）。

### P1-4 · 标签反向清理（补充）
- **修正**：§5-8 增三态标签转换表（设置/清除并重）；BLOCKED/CHANGES 主动清除已失效 `review:lgtm`+`need:repo-owner`；新增 E29。

### P1-5 · Review 幂等恢复（补充）
- **修正**：§5-19 增 `review_id` 唯一标识 + 幂等 key（`issue+PR+head_sha+reviewer+verdict`）+ 评论写前判重 + 标签派生前重读 + 并发确定性事件顺序（`reviewed_at`+`review_id`）；E26/T21 补「评论成功标签失败」场景。

### P1-6 · strict_required_status_checks_policy 描述校正（修正）
- **修正**：§0 明确 strict checks 控制「分支与目标最新（up-to-date）」，非 SHA 绑定；CLI G2/G3 由 `ciHeadSha` 自行实现。

### 治理澄清-7 · Assignee 路由 vs 身份授权（澄清）
- **修正**：reviewer-bot-design §4 明确 approve/verify/close 的「Issue Owner」是**路由语义**，非身份级强制隔离。

### 治理澄清-8 · Launcher 信任边界（澄清）
- **修正**：reviewer-bot-design §4 明确环境变量不可伪造；真正边界 = Launcher 控制配置 + 独立 App 凭证 + Token 验证 App + 密钥隔离 + fail-closed。

### 矩阵同步
- G8/G9/G10 增强；E25–E29（新增 E29）；T21 增强；acceptance-matrix R7-3/R7-4 澄清 + 审查资格矩阵 + 边界第 5 条。

---

## 红线遵守声明

本轮仅修订 `design.md` 与 `reviewer-bot-design.md` 两个设计交付物，并新增本文件与 `acceptance-matrix.md`。未创建 App、未生成/修改 Token、未修改任何 Launcher、未修改 `scripts/cli.mjs`、未修改 Rulesets、未开启 Strict Mode。
