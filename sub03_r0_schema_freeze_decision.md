# SUB-03 / R0 Evidence Schema V2 冻结决策记录

决策标识：`PL-SUB03-R0-SCHEMA-FREEZE-V1`

状态：`R0_SCHEMA_FROZEN`；`SUB03_READY_FOR_OWNER_APPROVAL`；实现未授权。

## 1. 权威依据

- Parent：Issue #36。
- Producer Issues：#37 / #38 / #40 / #41 / #42。
- Target：Issue #39 / SUB-03 / R0。
- 合同：`cwe1123_v2_query_contract.md`。
- 需求证据：`graph_requirements_gap_matrix_v2.md`。
- 顺序约束：`pl_graph_improvement_dependency_dag.md`。
- 产品事实基线：ProvenLattice main，已验证 merge `7a6d602`、`855b498`、`2abe216`、`4a7ff06`、`562c12a`。

## 2. Owner 已提供的冻结前约束

1. 生产 wiring 不得破坏旧候选及证据列表。
2. `analysis_kind` 和 confidence 分离，数值必须有可靠来源。
3. #39 不重新排序或二次截断 #41 competing pair。
4. 五块始终存在，缺失事实显式表示 limitation。

本记录落实这些约束，但不代替人类 Owner 执行 approve。

## 3. 冻结结论

- Schema：Evidence Schema V2。
- 容器：`candidate.evidence_v2`。
- 固定五块：`access`、`lock`、`competing_access`、`trace_evidence`、`confidence_limitation`。
- 主关联：candidate `evidence_id`；bundle `candidate_id` 必须精确相等。
- 子事实关联：只用 `access_event_id`；禁止 subject/行号/fuzzy join。
- 缺失编码：三态关系 `"unknown"`；未知数值/boolean 为 `null`；无集合为 `[]`；块不省略；原因进入排序去重的 `limitations[]`。
- `false` 仅代表可证明的 false，禁止把 unknown 写成 false。
- `analysis_kind` 与 confidence 独立：resolved/ambiguous 均不自动成为 definite；confidence 只复制现有 candidate/bundle 数值，pair confidence 不提升为 candidate confidence。
- #41 输出原样保序；#39 不二次 top-K/hard-cap；只原样传播 `coverage.competing_access`。
- 授权 profile wiring 仅传递已存在 `edges/lock_facts`，不得重新实现分析。
- `mechanism_facts` 保持顶层独立块，不进入五块。
- 旧 `candidates/evidence/evidence_bundles` 以及 envelope 既有字段零回退。

精确字段、类型、枚举、关系形状、文件边界和最小验收以 `cwe1123_v2_query_contract.md` §5 为准。

## 4. 真实生产者核对

| 块 | Producer | 已验证实际输出 |
|---|---|---|
| access | SUB-02 / #38 | `access_kind` 三值；底层 `is_write` 为精确字符串 `true/false`，V2 确定性规范化为 boolean |
| lock | SUB-04 / #40 | `access_locksets[]`、`relations[]`；四类关系；每 access 的 `limitation[]` 与 `candidate_state=ambiguous` |
| competing_access | SUB-05 / #41 | pair 字段、pair confidence、确定性排序、tie-preserving top-K=3、hard cap 100、coverage |
| trace_evidence | SUB-01 / #37 | `evidence_id=E-DEFECT-*`；七字段 step；固定 step_type/ground 枚举 |
| confidence_limitation | defect candidate/bundle + adapter | 三态来源与既有 confidence 分离；无可靠 candidate 数值时为 null |
| mechanism_facts（边界） | SUB-06 / #42 | 顶层 `race_condition/lock_order/resource_lifetime`；不属于五块 |

## 5. 冲突审计

- `is_write` 类型差异：**RESOLVED**。底层 access 注解为字符串，SUB-05 pair 为 boolean；V2 只对精确字符串作无损规范化，异常值为 `null + is_write_unavailable`。
- `resolution_status=resolved` 与 definite：**RESOLVED**。产品合同明确前者不是代码 verdict；V2 映射为 `may`，不得升级 definite。
- concurrency Evidence 占位 confidence `0.0`：**RESOLVED**。不作为可靠 candidate score；无其他来源时输出 `null + confidence_unavailable`。
- #41 production wiring：**RESOLVED BY CONTRACT**。#39 可传递既有 `edges/lock_facts`，不得改变 builder 语义。
- #41 top-K tie：**RESOLVED BY CONTRACT**。不二次排序/截断，coverage 原样传播。

`SCHEMA_CONFLICTS = 0`。

## 6. 非授权声明

- 本记录不批准 #39，不启动 Worker，不创建产品 worktree，不提交功能 PR。
- 本记录不扩大 SUB-07/08/09/11 权限，不冻结其分析合同。
- 人类 Owner 仍需通过 Issue Pilot 治理流程独立执行 approve。
