# #46 SUB-10 — Owner Approval 决策记录

**Issue**: #46 `[ProvenLattice][SUB] Marker/scenario mapping + candidate span`
**Type**: `type:feature` · `kind:sub` · `repo:provenlattice`
**Date**: 2026-11-03
**决策主体**: Human Owner（sunSUNQ）

## 1. Owner 决策

**DECISION: APPROVED** —— 批准 #46（SUB-10 / R8）进入实现。

## 2. 前置依赖核对（已满足）

#46 的 `depends-on` 仅 SUB-03（#39）verified 后的稳定 `candidate/evidence_v2` surface：

- #39 已于 2026-11-03 merge（merge commit `7647ade`）→ verified → closed。
- **前置依赖已满足**。

#46 不依赖 SUB-03 产出 `candidate.span`：`candidate.span` / `supporting_locations[]` /
scenario mapping 归 #46 自身装配（`parent36_dag_amendment.md` §3.3）。

## 3. 状态转换

```text
status:blocked -> status:approved
need:owner     -> need:author
```

## 4. 边界（不越权）

- owned：新 scenario-mapping 模块、`src/provenlattice/defect_query.py`、
  `src/provenlattice/concurrency_profile.py`（span 输出）、新测试。
- forbidden：`sparsecfg.py`、`concurrency_race_scenarios.py`、`concurrency_lock_scenarios.py`。
- 若既有 `source_spans` / FE-8 事实不足以形成通用 span，**STOP 并上报缺口**，不得回改或扩大
  SUB-03 / Evidence Schema V2 合同。
