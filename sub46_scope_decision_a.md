# #46 SUB-10 — Owner 方向决策 A（缩小范围授权）

**Issue**: #46 `[ProvenLattice][SUB] Marker/scenario mapping + candidate span`
**Date**: 2026-11-04
**决策主体**: Human Owner（sunSUNQ）

## 1. 背景

Worker 只读探针（`PL-SUB10-ISSUE46-FE8-SCENARIO-PROBE-V1`）结论 `PROBE_VERDICT = PARTIAL`：

- 可 additive 交付：`candidate.span`、`supporting_locations[]`、函数→访问分组。
- 不可交付：泛化 scenario（marker/annotation）映射 —— FE-8 注释/标注行 span 在 pipeline 未落地
  （`analysis_c_frontend.py` 的 `"comment":"COMMENT"` 被 `child.is_named` 过滤丢弃）。

## 2. Owner 决策

**DECISION: A —— 先落地三件套。**

- 授权交付：`candidate.span` + `supporting_locations[]` + 函数→访问分组（纯 additive、无缺口）。
- 泛化 scenario（marker/annotation）映射 → **列为显式缺口**，不在本轮 #46 交付；后续单独子任务或
  单独 Owner 决策。

## 3. 状态转换

```text
need:owner -> need:author   （Worker 继续实现三件套）
status:approved 保持
```

## 4. 边界（不变 + 缩小）

- owned / forbidden 边界不变（原 #46 合同）。
- scenario / marker 映射及 FE-8 注释 span 物化 → 本轮禁止，列缺口。
- 不得回改或扩大 SUB-03 / Evidence Schema V2 合同。
