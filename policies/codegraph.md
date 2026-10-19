# CodeGraph Policy

CodeGraph 是确定性 evidence producer。它生产版本化的关系事实；TASCO 是否消费、
何时注入以及是否产生任务收益属于独立 Issue 和独立 PR。

## 默认可自动推进的范围

- parser / resolver 覆盖；
- import、require、symbol、call、dependency edge 的正确性；
- 增量索引、缓存失效、确定性排序；
- 性能、内存、fixture 和跨平台兼容性；
- schema versioning 和 fail-closed 行为。

## 每个实现 PR 的最低 Gate

- 同一输入产生字节稳定输出；
- frozen fixture 不退化；
- 新增行为同时有正例与反例；
- hallucinated edge = 0；
- 无法解析时显式 unresolved 或省略，不猜测；
- repository HEAD 或相关输入变化后缓存正确失效；
- 报告 precision、recall、运行时间和峰值内存的适用指标。

## 必须由 owner 决策

- edge 语义或 schema 的 breaking change；
- 引入近似、概率或 LLM 推断；
- 默认扫描范围显著扩大；
- 将 graph 自动注入 TASCO 或其他 Agent；
- 发布和兼容性承诺。
