# Parent Issue 模板

> 用途：当一个 Issue 规模过大时，将其作为 Parent 承载功能拆分、依赖追踪与整体验收。
> 建议 label：`kind:parent` + 对应 `type:*`（feature / decision 等）+ `repo:*`。
> Parent 批准拆分 ≠ 批准子 Issue 实现；每个子 Issue 仍走独立审批。

## 目标（Parent 契约）

<!-- 整体要交付的用户可见能力 / 待决策目标。 -->

## 功能边界拆分（Planner 起草 · Owner 批准）

<!-- 每条一行，批准前标 DRAFT。依赖用 Issue 编号，无依赖写「无」。 -->
| # | 子功能 | 输入合同 | 输出合同 | 文件边界 | 依赖 | 验收 | Worker |
|---|---|---|---|---|---|---|---|
| DRAFT |  |  |  |  |  |  |  |

## 依赖图（DAG）

<!-- mermaid/列表，标注可并行集合；不允许成环。依赖子优先冻结接口后并行，无法冻结则严格串行。 -->

## 集成验收

<!-- 所有 sub verified 后如何整体验收；是否有跨 sub 的胶水代码需要集成 PR。 -->

## 关闭条件

<!-- 全部 sub closed + 集成验证通过 + Owner 确认。 -->