# Issue Pilot Agent Protocol

Issue Pilot 是 owner-governed 的研发控制平面。Issue 保存变化中的任务、讨论、
决策和进度；产品仓库只保存代码与必要文档；PR 是唯一代码交付路径。

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

- Agent 可以自主创建 `candidate`，但必须先查重并提供可证伪的依据。
- 只有人类 owner 可以执行 `approve`。Agent 禁止代替 owner 批准自己的提议。
- 未经批准只能调查和补充 Issue，不得修改产品代码。
- 每次执行使用独立 worktree；一个运行只服务一个 Issue。
- PR 必须关联控制仓库 Issue，禁止把过程日志写进产品仓库。
- 合并、默认启用、发布、版本号和 tag 始终由 owner 决定。

## Issue 分类

- `type:bug`：已有行为与合同不符。
- `type:maintenance`：回归、遥测、兼容性、依赖或文档漂移。
- `type:research`：尚未证实的假设、实验或新能力候选。
- `type:decision`：必须由 owner 选择方向；不得由 Agent 开始实现。
- `type:feature`：已有批准合同的用户可见能力。

## 提议质量门

每个 candidate 必须包含：观察证据、期望行为、反例或失败条件、允许修改范围、
验收方式。没有客观证据的“也许可以优化”不得创建 Issue。

创建前用 `npm run pilot -- search "关键词"` 查重。命中已有 Issue 时只补充评论。

## 执行纪律

1. `npm run pilot -- run <issue>` 创建 D 盘 worktree。
2. 只修改 Issue 合同允许的文件。
3. 执行目标仓库政策要求的检查，记录准确的测试层级。
4. commit 后运行 `npm run pilot -- submit <issue>`。
5. PR review 必须由未参与实现的 Agent 或人完成。
6. 有修改意见时回到 `in-progress`；新 commit 使旧 review 失效。
7. 合并后必须记录验证证据并进入 `verified`，才能总结关闭。

## 写入与安全边界

- 所有临时文件和 worktree 写入 `D:\tasco-temp\issue-pilot\`。
- 不在 C 盘创建临时目录。
- 不自动合并 PR，不自动关闭决策 Issue，不自行发布。
- 不读取或输出凭据；不把本机绝对路径提交到产品仓库。
- 不绕过目标仓库 Hook、安全门或测试门。
