# Issue Pilot Agent Protocol

Issue Pilot 是 owner-governed 的研发控制平面。Issue 保存变化中的任务、讨论、
决策和进度；产品仓库只保存代码与必要文档；PR 是唯一代码交付路径。

issue-pilot 也是 ProvenLattice 的图谱能力研发任务池：第一优先级是持续增加和改进
图谱能力并尽快交付真实客户，改进方向主要由客户使用反馈驱动；图谱能力研发遵循
`policies/graph-capabilities.md`。

## 会话开始

1. 运行 `npm run pilot -- doctor`。
2. 运行 `npm run pilot -- brief`，优先处理自己负责且已有回复的 Issue。
3. 阅读目标仓库自己的 `AGENTS.md`，其约束优先于本文件。
4. 阅读 Issue 全文和对应 `policies/<policy>.md` 后再工作。

## 状态机

```text
candidate -> needs-triage -> needs-owner -> approved
          -> in-progress -> in-review -> verified -> closed
```

## Solo Mode（policies/solo-mode.md）

单人开发自治模式：`advance`/`autopilot` 自动推进 candidate → approved →
实现 → PR → 复审 → merge → verify → close。AUTO 清单（bug/maintenance/
research + 五要素 + 查重 + policy 范围）外的任务、Owner Gate 文件命中、
失败超阈值一律 hold 升级。phase=DRAFT 时全部自动路径拒绝；PILOT 仅限
清单内 Issue；ACTIVE 需 Owner 一次性启用授权。Agent 不得修改 policy
扩大自身权限。

## 行动标签（need:*）

每个 open Issue 恰有一个 `need:*` 标签，指向下一步行动者；`brief` 按
该标签分组。多窗口的 Agent 与 owner 按标签认领工作，不靠口头协调。

- `need:owner`：等 owner（approve、merge、close、方向决策）。Agent 禁止代替执行。
- `need:reviewer`：等独立复审。必须由未参与实现的 Agent 或人执行。
- `need:author`：等实现者（开始实现、按 review 意见修复）。Agent 可认领。

标签由 CLI 在状态转换时自动维护：propose→owner、approve→author、
run→author、submit→reviewer、review lgtm→owner、review changes→author、
verify→owner、close→清除。手工改标签只应用于与上述转换等价的情况，
并在 Issue 评论中说明原因。

- Agent 可以自主创建 `candidate`，但必须先查重并提供可证伪的依据。
- 只有人类 owner 可以执行 `approve`。Agent 禁止代替 owner 批准自己的提议。
- 未经批准只能调查和补充 Issue，不得修改产品代码。
- 每次执行使用独立 worktree；一个运行只服务一个 Issue。
- PR 必须关联控制仓库 Issue，禁止把过程日志写进产品仓库。
- 合并、默认启用、发布、版本号和 tag 始终由 owner 决定。

## Issue 分类

图谱能力研发（ProvenLattice 主线，见 policies/graph-capabilities.md）：

- `GRAPH_FEATURE`：新增图能力。
- `GRAPH_QUERY`：将已有图能力转化为可消费查询。
- `GRAPH_BUG`：客户或工程测试发现的真实图谱错误。
- `GRAPH_SCALE`：索引性能、增量计算、缓存、大仓库支持。
- `INTEGRATION`：CLI / MCP / analyzer registry / packaging 等产品集成。

治理与元类：

- `type:bug`：已有行为与合同不符。
- `type:maintenance`：回归、遥测、兼容性、依赖或文档漂移。
- `type:research`：尚未证实的假设、实验或新能力候选；默认不进产品主线，须 Owner 单独授权。
- `type:decision`：必须由 owner 选择方向；不得由 Agent 开始实现。
- `type:feature`：已有批准合同的用户可见能力。

## 图谱能力研发治理

默认流程：Roadmap → Capability Issue → Implementation → Golden Tests → Necessary
Regression → PR / CI → Merge → Customer Usage → Feedback-driven Improvement。

普通 Feature 不自动触发 Formal 实验、Benchmark、独立多轮 Review、Readiness、
Evidence Closure、多模型 Judge、大规模实验；仅在正式版本发布前、客户报告真实错误、
高风险架构变更、Owner 明确批准的论文/研究任务时才增加专项验证。

普通 Feature 的最小验收：Golden Tests + 受影响模块 Regression + GitHub CI +
PR 合入 main + capability matrix / 必要文档更新。满足即关闭，不得因未来高级能力
未实现而延长当前 Issue。

Roadmap 由 Owner 控制（policies/graph-capabilities.md §3）；Agent 可提出建议但
不得自行调整优先级或自动启动下一项开发。禁止：将普通 Feature 自动升级为研究项目、
拆分大量 Readiness/Closure Issue、验收通过后继续自动开展 Formal、以"缺少完美验证"
阻止功能进入 main、自行扩大 Roadmap、为理论完整性无限增加能力范围。

## 提议质量门

每个 candidate 必须包含：观察证据、期望行为、反例或失败条件、允许修改范围、
验收方式。没有客观证据的“也许可以优化”不得创建 Issue。

图谱能力 Issue 创建前还必须回答创建门四问（policies/graph-capabilities.md §7）：
Roadmap Alignment（属于哪个已批准方向）、Product Value（客户新增什么能力）、
Minimal Scope（最小可交付范围）、Necessity（是否必须新建而非并入当前 Issue）。
任何一项无法回答，先提交 Owner 决策，不自动创建。

创建前用 `npm run pilot -- search "关键词"` 查重。命中已有 Issue 时只补充评论。

## 执行纪律

1. `npm run pilot -- run <issue>` 创建 D 盘 worktree。
2. 只修改 Issue 合同允许的文件。
3. 执行目标仓库政策要求的检查，记录准确的测试层级。
4. commit 后运行 `npm run pilot -- submit <issue>`。
5. PR review 必须由未参与实现的 Agent 或人完成。
6. 有修改意见时回到 `in-progress`；新 commit 使旧 review 失效。
7. 合并后必须记录验证证据并进入 `verified`，才能总结关闭。
8. GitHub 凭据一律经 `launchers/start-<role>-agent.ps1` 注入（App-only、fail-closed、
   自动续签、身份钉扎）；未经 launcher 验证的会话不得执行需要 GitHub 写权限的操作；
   身份与续签留痕写入 state 文件与 Issue 评论（不含任何令牌值）。

## 写入与安全边界

- 所有临时文件和 worktree 写入 `D:\tasco-temp\issue-pilot\`。
- 不在 C 盘创建临时目录。
- 不自动合并 PR，不自动关闭决策 Issue，不自行发布。
- 不读取或输出凭据；不把本机绝对路径提交到产品仓库。
- 不绕过目标仓库 Hook、安全门或测试门。
