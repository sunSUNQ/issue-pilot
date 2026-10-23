# Graph Capabilities Policy（图谱能力研发任务池）

issue-pilot 是 ProvenLattice 的图谱能力研发任务池。第一优先级是持续增加和改进
ProvenLattice 的图谱能力，并尽快交付真实客户使用。产品能力的最终改进方向主要由
客户使用反馈驱动，而不是在每个功能发布前进行大量实验和 Formal 验证。

## 1. 执行原则

默认开发流程：

```
Roadmap -> Capability Issue -> Implementation -> Golden Tests -> Necessary Regression
-> PR / CI -> Merge -> Customer Usage -> Feedback-driven Improvement
```

普通 Feature 不自动触发：Formal 实验、Benchmark、独立多轮 Review、Readiness、
Evidence Closure、多模型 Judge、大规模实验。

仅以下情况增加专项验证：

1. 正式版本发布前；
2. 客户报告真实错误；
3. 高风险架构变更；
4. Owner 明确批准的论文 / 研究任务。

## 2. Issue 类型（图谱能力）

- `GRAPH_FEATURE`：新增图能力。如 Java Field Data Flow、Interprocedural Data Flow、
  Program Slice、Alias / Points-to、Exception CFG。
- `GRAPH_QUERY`：将已有图能力转化为可直接消费的查询能力。如 get_definition、
  get_uses、get_backward_slice、get_forward_slice、get_dataflow_path。
- `GRAPH_BUG`：客户或工程测试发现的真实图谱错误。
- `GRAPH_SCALE`：索引性能、增量计算、缓存、大仓库支持。
- `INTEGRATION`：CLI / MCP / analyzer registry / packaging 等必要产品集成。

Research Issue 默认不进入产品主线，必须有 Owner 单独授权。

## 3. Roadmap（Owner 控制的方向清单）

已完成（进入 main）：Java Field Data Flow V1、Java Interprocedural
Parameter / Return Data Flow V1。

Owner 调整后的下一阶段优先级（2026-10-23）：

### P0

1. Def-Use / Dataflow Query API（get_definition / get_uses / get_dataflow_path / get_backward_slice 最小版）
2. 跨文件 Interprocedural Data Flow（复用 CALLS resolution，替代短名唯一匹配）

### P1

3. Lightweight Alias / Points-to（仅局部 assignment / parameter / return alias）
4. Program Slice V1

### P2

5. Java Exception CFG
6. 更完整的 field / heap flow

### 长期方向

7. Interprocedural CFG
8. Cross-function Slice
9. Root-cause / Impact Query
10. Source-Sink / Taint V1
11. Python / C / C++ / Java 图能力逐步对齐
12. Incremental Graph Update
13. Large Repository Scale
14. Task-driven Analysis / Task Context 集成

Roadmap 是 Owner 控制的方向清单。Agent 可以提出建议，但不得自行调整优先级或
自动启动下一项开发。

## 4. 普通 Feature 的最小验收

默认只要求：

1. 新能力 Golden Tests；
2. 受影响模块 Regression；
3. GitHub CI；
4. PR 合入 main；
5. 能力矩阵和必要文档更新。

完成上述条件即可关闭 Issue。不得因为未来还有高级能力未实现而延长当前 Issue。

## 5. 客户反馈驱动

客户反馈必须优先转化为以下问题之一：

- Graph Coverage：缺少关系；
- Graph Correctness：关系错误；
- Graph Precision：关系过粗；
- Query Usability：已有图难以直接消费；
- Scale：性能或资源问题。

根据实际客户问题创建定向 Issue。不因为理论上"还能进一步完善"就自动创建任务。

## 6. 发布前验证（Release Gate）

完整验证集中在版本发布前进行，可包括：

- 全量单元 / 回归；
- Linux / Windows CI；
- Packaging Smoke；
- 代表性 Python / C / C++ / Java 仓库；
- CLI / MCP Smoke；
- 性能明显退化检查；
- capability matrix 一致性。

普通 Feature 不重复执行完整 Release Gate。

## 7. Issue 创建门

创建新 Issue 前必须回答：

- Roadmap Alignment：属于哪个已批准图谱能力方向？
- Product Value：完成后客户能够新增使用什么能力？
- Minimal Scope：最小可交付范围是什么？
- Necessity：必须创建新 Issue，还是属于当前 Issue 正常实现范围？

任何一项无法回答，则先提交 Owner 决策，不自动创建。

## 8. 禁止事项

- 将普通 Feature 自动升级为研究项目；
- 一个功能拆出大量 Readiness / Closure Issue；
- 工程验收通过后继续自动开展 Formal；
- 因为缺少"完美验证"阻止功能进入 main；
- 自行扩大 Roadmap；
- 为追求理论完整性无限增加能力范围。
