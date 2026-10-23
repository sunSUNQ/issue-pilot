# Single Control Plane Policy（单一控制面）

`sunSUNQ/issue-pilot` 是 ProvenLattice 后续研发工作的唯一任务控制面。
ProvenLattice 仓库继续作为产品代码、测试、PR、CI 和 Release 的执行仓库，
不再承担独立 Roadmap 和任务规划职责。

## 1. 工作流

```
Owner / Customer Feedback
-> issue-pilot Issue
-> Owner Approval
-> ProvenLattice Implementation
-> Tests
-> ProvenLattice PR / CI
-> Merge
-> 回写 issue-pilot
-> Close Issue
```

## 2. Source of Truth

### issue-pilot（control plane）

- Roadmap
- Priority
- Issue scope
- Product value
- Minimal scope
- Acceptance criteria
- Owner decisions
- Blocked / Deferred 状态
- Customer feedback
- Completion status

### ProvenLattice（execution plane）

- Source code
- Tests
- Feature branch
- Pull Request
- CI
- Merge
- Release

ProvenLattice PR 是执行产物，不是任务规划源。

## 3. 新任务规则

所有新的 ProvenLattice 工作默认先在 issue-pilot 创建 Issue。Issue 必须属于：

- GRAPH_FEATURE
- GRAPH_QUERY
- GRAPH_BUG
- GRAPH_SCALE
- INTEGRATION

Research 必须有 Owner 单独授权。Agent 不得在 ProvenLattice 自行创建新的产品
方向或 Roadmap Issue。

## 4. 执行规则

Agent 接到 issue-pilot Issue 后：

1. 读取 Issue 的目标、范围、验收条件和禁止事项；
2. 在 ProvenLattice 创建工作分支；
3. 实现能力；
4. 执行 Golden Tests + Necessary Regression；
5. 创建 ProvenLattice PR；
6. 等待 CI / Review；
7. 合并后将 PR、merge commit、测试结果回写 issue-pilot；
8. 满足验收条件后关闭 issue-pilot Issue。

## 5. ProvenLattice Issue 使用原则

默认不为每个研发任务重复创建 ProvenLattice Issue。仅以下情况可以创建：

- 对外公开的客户 Bug；
- 需要 GitHub 原生公开跟踪；
- 第三方贡献者需要参与；
- Release blocker；
- Owner 明确要求。

否则仅使用 issue-pilot Issue + ProvenLattice PR。

## 6. 禁止双轨管理

禁止：

- issue-pilot 与 ProvenLattice 同时维护两套 Roadmap；
- 同一个功能在两个仓库重复维护完整 Issue；
- ProvenLattice Issue 改变 issue-pilot 已批准的 scope；
- Agent 在实现过程中自行扩大 Roadmap；
- PR 合并后因为未来增强项而不关闭原 Issue。

## 7. 验收完成

普通功能满足以下条件即可关闭：

- 代码进入 ProvenLattice main；
- Golden Tests PASS；
- Necessary Regression PASS；
- GitHub CI 满足要求；
- issue-pilot 验收条件满足。

后续增强另建 Issue。

## 8. 客户反馈

客户反馈统一进入 issue-pilot，并分类为：

- Graph Coverage
- Graph Correctness
- Graph Precision
- Query Usability
- Scale

由 Owner 决定是否进入 Roadmap。

## 9. 最终原则

- issue-pilot = control plane
- ProvenLattice = execution plane

Owner 只需要主要管理 issue-pilot；Agent 负责在 ProvenLattice 完成实际产品变更
并回写结果。
