# TASCO Policy

## 可自主提议并在批准后实现

- 明确复现的 bug；
- telemetry、manifest、schema、adapter 和兼容性问题；
- regression fixture、测试基础设施和文档漂移；
- 已有冻结合同内的有界修复；
- 与正式运行路径隔离的离线研究原型。

## 必须先由 owner 批准实验协议

- 新 compression primitive 或 capability；
- positive zone、negative boundary、threshold、router 或 classifier 变化；
- semantic compression、recovery-aware compression 和 CodeGraph 接入；
- 任何真实 Agent A/B、Stability、Qualification 或 Canary。

每次实验只改变一个 primitive。Primitive A/B 中 guidance、router、recovery 和
其他非目标机制关闭。必须区分 Regression、Integration、Smoke、Boundary、A/B、
Stability、Qualification 和 Canary，禁止用低层结果宣称 Release Ready。

## 禁止 Agent 自主执行

- 修改 E1-E15 冻结定义或为了指标修改冻结数据；
- 扩大正式默认能力；
- 修改版本号、创建 release tag、发布 RC/GA；
- 同一 PR 同时改变 primitive 和 routing/policy；
- 将一次 PASS 解释为稳定能力或因果结论。

公共 runtime 修改必须执行目标仓库规定的跨能力回归：正区不退化，负区不误介入。
