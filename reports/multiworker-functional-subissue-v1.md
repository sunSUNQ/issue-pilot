# 功能拆分子 Issue 多 Worker 协作流程（V1 设计）

> 状态：**APPROVED — Owner 已批准 V1 方向（ISSUE-PILOT-MULTIWORKER-V1-APPROVAL）**
> 关联工单：ISSUE-PILOT-FUNCTIONAL-SUBISSUE-MULTIWORKER-V1
> 范围：仅流程设计 + P1 落地（标签、模板）。不修改代码、不创建试点 Issue、不启动 Worker。
> 约束：不改变现有 OWNER_GATE、独立 Review、Owner Merge 规则；不开发新的调度系统；
> 优先复用现有 issue-pilot 与 GitHub 能力。

---

## 0. Owner 决策与裁定（D1–D5，已生效）

| # | 决策 | 裁定 |
|---|---|---|
| D1 | Parent/Sub 标签 | 批准新增 `kind:parent`、`kind:sub`；保留 `type:*`/`status:*`/`need:*` 治理标签，不改变审批逻辑 |
| D2 | Planner | V1 由 **Owner 兼任规划职责**；Agent 可辅助分析起草，但不新增带审批权限的 Planner 身份 |
| D3 | 依赖策略 | 默认「冻结接口后并行」；纯文档合同可在 Parent 冻结，需实际共享代码接口时必须先前置合并；无法冻结则严格串行 |
| D4 | split 命令 | **不开发** `split`；沿用现有 `propose` 流程手动创建子 Issue |
| D5 | Parent 集成 | Parent 负责规划、依赖追踪、最终验收；预留集成 PR，仅在确有胶水代码/跨模块修改时创建 |

### 0.1 实施澄清（约束）

1. **一个 Sub-Issue 同一时间只有一个负责 Worker**；Worker 自领（assignee + 认领评论），
   认领后独占该 sub 的分支/worktree/PR，直至交付或释放。
2. **每个 Sub-Issue 独立走完整生命周期**：独立 approve、develop、review、merge、verify、close；
   互不合并门，互不共享可写目录。
3. **Parent 批准拆分 ≠ 自动批准子 Issue 实现**：拆分批准只代表边界合法；每个 sub 仍按
   自身 `type:*` 走 OWNER_GATE（AUTO 清单内的 bug/maintenance/research 可 auto-approve，
   feature 由 Owner approve）。
4. **不新增调度器、不开发 `split` 命令、不修改现有审批与合并 Gate**；并行来自多 Worker 窗口
   各自认领 + 各自 `advance`/`autopilot`，parent 由 Owner/Planner 手动追踪。

---

## 1. 目标

当一个 Issue 规模过大时，把「功能边界分析」前置为一次 Owner 掌舵的规划动作：
把 `parent issue` 拆成多个互相独立、可并行交付的 `sub issue`，每个 sub 由一个
Worker 全权负责（分支、PR、复审、验收），最后在 parent 层统一验收与关闭。

拆分的粒度是**独立功能**，不是开发/测试/文档等工作类型。

---

## 2. 现状只读分析（复用基础）

现有 issue-pilot 已经天然具备多 Worker 所需的绝大部分基础设施，本设计只做「编排」，
不造新轮子。

| 需要的多 Worker 能力 | 现有实现 | 依据 |
|---|---|---|
| 每个 Issue 独立工作目录 | `worktreePath = {root}/{alias}-{number}` | `scripts/lib.mjs:205` |
| 每个 Issue 独立分支 | `issue-pilot/{number}-{slug}` | `scripts/cli.mjs:197` |
| 每个 Issue 独立状态文件 | `config/state/{alias}-{number}.json` | `scripts/lib.mjs:224` |
| 下一步行动者路由 | `need:author/reviewer/owner` + `brief` 分组 | `scripts/cli.mjs:106-127` |
| 独立复审 | `review --verdict --sha`，SHA 绑定 | `scripts/cli.mjs:250` |
| 自动合并质量门 | HEAD 绑定 / LGTM 匹配 / CI 全绿 / gate 审计 | `scripts/cli.mjs:444` |
| 角色凭据隔离 | Worker App vs Owner/Reviewer App 双 launcher | `launchers/start-*.ps1` |
| 单 Issue 全链自动推进 | `advance` / `autopilot` | `scripts/cli.mjs:545-631` |

**结论**：多 Worker 的关键缺口只有两点——

1. 没有 Parent/Sub 的显式关联与依赖表达。
2. 没有「一个 sub = 一个 Worker」的分派约定，以及 sub 之间的文件边界/依赖校验。

这两点都不需要新的调度系统，用 label + 正文合同 + 现有命令即可覆盖。

---

## 3. 多 Worker 功能拆分流程

### 3.1 全流程（Parent 视角状态机）

```text
parent(candidate, kind:parent)
  → 规划(planner 起草边界, need:owner)
  → approved(Owner 批准功能拆分, kind:parent)
  → in-progress(子 Issue 逐个推进)
  → verifying(所有 sub verified 后做集成验证)
  → closed(Owner 关闭)
```

每个 sub 走**与现在完全相同的单 Issue 状态机**，互不干扰：

```text
sub(candidate, kind:sub)
  → approved → in-progress → in-review → [review:lgtm] → merge → verified → closed
```

### 3.2 六个执行步骤

**S1 · 规划与拆分（Parent，Owner 掌舵）**

- Planner Agent（或 Owner）读 parent 需求，按「功能边界拆分标准」（§7）起草拆分表，
  写入 parent 正文（DRAFT 注明未批准）。
- 依赖建模成 DAG，并在拆分表标注可并行集合。
- Parent 置 `need:owner`，等 Owner 批准边界。

**S2 · 批准拆分（Owner 门，不可自动）**

- Owner 确认每条 sub 的输入/输出合同、文件边界互不重叠、DAG 无环。
- 这是一次 `approve` 语义：给 parent 打 `status:approved`（Owner 批准的是「拆分」，
  不是批准实现每个 sub）。

**S3 · 生成 sub Issue**

- 每个 sub 用 `propose --body-file=templates/sub.md` 创建，正文含五要素 + 功能合同；
  label 加 `kind:sub`、`repo:<alias>`、`type:<feature/bug/research/…>`。
- sub 正文写 `Parent: #<N>`、`依赖 #<N>`（无依赖写「无，可并行」）。
- sub 一律 `status:candidate`，交给各自的 OWNER_GATE 判断（AUTO 清单内的
  bug/maintenance/research 可走 auto-approve；feature 由 Owner 批准）。

**S4 · 分派 Worker**

- 每个 sub 恰由一个 Worker 认领：`gh issue edit #sub --add-assignee <bot>` + 评论
  「Worker claim」。认领即分派，无中心调度器。
- 每个 Worker 独立窗口 `. launchers/start-worker-agent.ps1`，只 `run` 自己认领的 sub。
- `run <sub>` 产出独立 `worktree` + 独立分支（见 §2），天然不共享可写目录。

**S5 · 各 sub 走既有交付链（并行）**

- 无依赖的 sub 并行执行：各自 implement → submit → 独立 review → merge → verify → close。
- 每条链沿用现有 OWNER_GATE、独立复审、Owner/自动合并规则（不变，见 §8）。

**S6 · 集成验收与 Parent 关闭**

- parent 的「关闭条件」：所有声明 sub 均 `closed` + 集成验证通过（§9）。
- 若存在跨 sub 的胶水代码，parent 才创建自己的集成 PR；否则 parent 仅是追踪/决策 Issue，
  不建 worktree、不建 PR。
- Parent 由 **Owner 关闭**（不自动关闭，符合「不自动关闭决策/feature」约束）。

---

## 4. Parent / Sub-Issue 模板

> 模板落地为 `templates/parent.md`、`templates/sub.md`。
> sub 模板保留五要素原文字段（`scripts/cli.mjs:310` 的 `AUTO_ELEMENTS` 按这些
> 关键词做自动批准检测），确保 AUTO 判定不变。

### `templates/parent.md`

```markdown
## 目标（Parent 契约）

<!-- 整体要交付的用户可见能力 / 待决策目标。 -->

## 功能边界拆分（Planner 起草 · Owner 批准）

<!-- 每条一行，批准前标 DRAFT。 -->
| # | 子功能 | 输入合同 | 输出合同 | 文件边界 | 依赖 | 验收 | Worker |
|---|---|---|---|---|---|---|---|
| DRAFT |  |  |  |  |  |  |  |

## 依赖图（DAG）

<!-- mermaid/列表，标注可并行集合；不允许成环。 -->

## 集成验收

<!-- 所有 sub verified 后如何整体验收；是否需要集成 PR（仅当有跨 sub 胶水代码）。 -->

## 关闭条件

<!-- 全部 sub closed + 集成验证通过 + Owner 确认。 -->
```

### `templates/sub.md`

```markdown
## 子功能（功能合同）

<!-- Parent: #N · 功能名（一条 sub 对应一个独立功能，非工作类型拆分）。 -->

## 观察证据

<!-- 可复现事实、失败输出、遥测或文档冲突。 -->

## 期望行为

## 反例或失败条件

## 输入合同（依赖的已冻结接口）

<!-- 本 sub 假定已经稳定存在的外部接口 / schema / fixture。 -->

## 输出合同（本 sub 对外承诺）

<!-- 完成后承诺稳定的接口 / 类型 / 数据形态。 -->

## 文件边界

<!-- owned：本 sub 独占可写目录/文件；forbidden：其他 sub 的 owned 文件一律不改。 -->

## 依赖

<!-- depends-on: #N；无依赖写「无，可并行」。 -->

## 允许修改范围

## 验收方式

<!-- 测试层级、命令、指标和人工 Gate。 -->
```

---

## 5. Parent/Sub 关联方式（Label + 正文链接）

最小改动，只用两项现有能力：

1. **Label**（新增 2 个静态 label，`setup` 或 `gh label create`）：
   - `kind:parent` —— 追踪/集成 Issue；
   - `kind:sub` —— 功能子 Issue。
   不新增 `need:*` 值，保持「恰一个 need:* ∈ {author, reviewer, owner}」不变。

2. **正文交叉引用**（GitHub 原生自动链接）：
   - parent 的拆分表列出 sub 编号（GitHub 自动生成本仓库内「x/y 子任务」进度）；
   - sub 正文写 `Parent: #N`、`依赖 #N`（本仓库内用 `#N` 短路引用）。
   - **跨仓库引用必须写完整 `owner/repo#N`**（如 `sunSUNQ/provenlattice#37`）：
     GitHub 不会把裸 `#N` 解析到其他仓库；跨仓库的 sub 仍用 `repo:*` label 区分其
     交付仓库与凭据边界。

依赖方向用**正文文本**表达，不用动态 label（避免为每个依赖关系创建 label）。

---

## 6. Worker 分派与权限矩阵

### 6.1 分派规则（一个 sub = 一个 Worker）

- 分派 = Worker **自领 sub**（assignee + 认领评论），无中心调度。
- 多个 Worker 窗口可能共用同一 GitHub 身份（如 `pl-issue-worker[bot]`）；此时认领
  评论必须附加唯一任务/窗口标识（如 `w<窗口号>` + `<issue>-<slug>`），用于审计区分
  操作者，不能仅凭 assignee 身份判断是谁认领。
- **同一时间一个 sub 恰有一个负责 Worker**；Worker 独占该 sub 的分支/worktree/PR，
  直至交付或释放（`need:author` 转移时解除）。
- Worker 只对自己的 sub 出分支 / PR / worktree（路径按 sub 编号天然隔离）。
- Reviewer 必须 ≠ 实现该 sub 的 Worker（沿用「实现者窗口不得认领自己 PR 的 review」）。
- 并行度 = 同 DAG 前沿上的 Worker 窗口数；每个窗口独立 launcher。

### 6.2 权限矩阵

| 动作 | Planner(规划 Agent) | Worker(实现窗口) | Reviewer | Owner |
|---|---|---|---|---|
| 起草功能拆分 parent | ✅ 起草(need:owner) | — | — | ✅ |
| 批准功能拆分 / 边界 | ❌(仅起草) | ❌ | ❌ | ✅ |
| 生成 sub Issue | ✅ | — | — | ✅ |
| 认领 sub(自领) | — | ✅(自己 sub) | — | ✅ |
| 实现 / commit / push(分支) / PR | — | ✅(自己 sub) | — | ✅ |
| 独立复审 | ❌ | ❌(自己 sub) | ✅ | ✅ |
| merge(sub，§8 门全过) | — | ❌(自己 sub) | ❌ | ✅ / solo-auto |
| merge(gate 命中) | ❌ | ❌ | ❌ | ✅ |
| 冻结接口 / 变更已冻结接口 | 起草→Owner | — | — | ✅ |
| 集成验证 / 关闭 parent | — | — | — | ✅ |
| policy / label / gate 规则修改 | ❌ | ❌ | ❌ | ✅ |

> 与 `policies/solo-mode.md` §7 完全一致，只新增「Planner」列且**不授予任何新权限**。

---

## 7. 功能边界拆分标准 & 依赖/并行规则

### 7.1 拆分标准（每个 sub 必须可独立回答）

1. **输入合同**：依赖哪些已冻结接口/schema/fixture（来自 main 或先合入的 sub）。
2. **输出合同**：承诺交货哪些接口/类型/数据形态，供依赖者消费。
3. **文件边界**：owned（独占可写）与 forbidden（他人 owned 不碰）的文件/目录。
4. **依赖**：`depends-on #N` 或「无，可并行」。
5. **验收**：测试层级 + 命令 + 指标 + 人工 Gate（仍含五要素）。

反例（不允许这样拆）：按「后端开发 / 前端开发 / 写文档 / 写测试」拆；任何一个 sub
无法独立描述交付合同；两个 sub 的 owned 文件重叠。

### 7.2 并行执行规则

- DAG 分层，同一前沿上的 sub 全并行；不同层之间按依赖序。
- 无依赖 sub：立即并行发车。
- 有依赖 sub（B 依赖 A）两种合法时序：
  1. **冻结接口（推荐）**：A 先交一个 `preflight` 合同 PR（类型/头文件/schema/fixture）
     合入 main，B 按冻结合同并行编码，A 继续实现细节。
  2. **严格串行**：等 A merge + verify 后再 `run` B。

### 7.3 依赖 / 集成冲突处理

| 场景 | 处理 |
|---|---|
| sub B 依赖的接口尚未冻结 | B 阻塞：`status:blocked, need:owner`，或走 `preflight` 冻结 |
| 两个 sub 修改同一文件（边界违约） | V1 尚无自动 cross-sub 文件冲突审计；依赖 Reviewer / Owner 人工比对 sibling 的 owned 文件，命中 → `need:owner`，不改（自动 gate 校验留待 P3） |
| 合并冲突（共享文件） | rebase 到最新 main → 重跑 CI → 重新 review（现有 SHA 绑定自动失效旧 LGTM） |
| 已冻结接口需要变更 | 属于 parent 合同变更 → Owner 决策，受影响 sub 重新规划 |
| 依赖成环 | 拆分非法，Planner 重新排序或冻结接口破环 |
| 复审 changes ≥2 轮 / CI 同 HEAD 失败 ≥2 次 | 沿用现有 `hold`（`scripts/cli.mjs:317-318`） |

> V1 未实现 cross-sub 文件边界自动审计与依赖/接口冻结自动校验；这些核查由
> Reviewer（认领时人工比对 sibling 的 owned 文件）与 Owner（集成验收）承担；
> P3 才考虑在 `gateAudit` 落自动校验。

---

## 8. 不改变既有规则（约束声明）

- OWNER_GATE 清单、文件级 gate 检测（`scripts/cli.mjs:311-315` + `gateAudit`）**不变**。
- 独立复审（need:reviewer、实现者不得自审）**不变**。
- Owner Merge 语义与 §5/§8 自动合并质量门**不变**，只是**每个 sub 各自**过门。
- Release/tag/版本号、policy/AGENTS 修改仍 Owner-only。
- sub 的类型决定其审批路径：feature 仍需 Owner approve；AUTO 清单（bug/maintenance/research）
  才可 auto-approve —— 与「Agent 不扩权」一致。

---

## 9. Parent 整体验收与关闭条件

关闭 parent **前必须同时满足**：

1. 拆分表内**所有** sub 均已 `closed`（merge + verify 完成）。
2. 集成验证通过：跨 sub 的 smoke / 红线回归 / 合同校验（已冻结接口与实现一致）。
3. 若需胶水代码，集成 PR 已走独立复审 + 合并 + verify。
4. Owner 确认并执行 `close`（parent 不进入 auto-close）。

---

## 10. 落地方案与当前进度

| 阶段 | 动作 | 状态 |
|---|---|---|
| P0 | Owner 审批本设计（V1 direction） | ✅ 已批准（D1–D5） |
| P1 | 创建 `kind:parent`、`kind:sub` label | ✅ 已完成（GitHub label 已存在，无需 PR） |
| P1 | 新增 `templates/parent.md`、`templates/sub.md`（含本设计报告） | ✅ 本地完成，待 PR 合并（本次交付） |
| P2 | `split <parent>` 命令 | ⏸ 暂不开发（D4） |
| P3 | `gateAudit` cross-sub 文件边界校验 | ⏸ 暂不开发（后续另立 Issue） |
| P4 | 取一个真实大 Issue 拆 2–3 个 sub 试运行 | ⏸ 等 Owner 选择真实任务 |

**零调度器原则**：并行来自多个 Worker 窗口各领一个 sub 后各自 `advance/autopilot`；
parent 由 Owner（兼任 Planner，D2）按拆分表清单人工追踪，不引入编排进程。

---

## 11. Owner 决策结果（已全部裁定）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 新增 `kind:parent` / `kind:sub` | ✅ 批准（D1） |
| 2 | Planner 角色 | Owner 兼任；Agent 仅辅助起草，不新增审批身份（D2） |
| 3 | 依赖时序默认策略 | 冻结接口后并行；无法冻结则严格串行（D3） |
| 4 | 是否实现 `split` 命令 | 不开发，沿用 `propose` 手动创建（D4） |
| 5 | Parent 纯追踪 vs 预留集成 PR | 预留集成 PR，按需创建（D5） |