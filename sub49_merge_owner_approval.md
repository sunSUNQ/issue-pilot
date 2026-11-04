# #49 S7-F1 — Owner Merge 授权 + 执行记录

**Issue**: #49 `[ProvenLattice][SUB] THREAD_SPAWN argument scoped identity (SUB-07 S7-F1)`
**Date**: 2026-11-04
**决策主体**: Human Owner（sunSUNQ）

## 1. Owner 决策（merge gate §3 item 1 裁决）

**DECISION: A — ACCEPTED。**

- §3 item 1 对 S7-F1 判定为 **N/A by design**：本子任务仅新增未被消费的 additive fact
  （`thread_argument_decl_scoped`），不改变候选生成、判定、排序或过滤行为，因此不存在
  可归属于 S7-F1 的真实语料 FP/FN 增量。
- FP/FN 验收责任**延后至首次消费该事实的 S7-F2**，受 `cwe1123_v2_query_contract.md` §5.11 约束。
- 结合性能（0.3ms/300 spawns）、回退语义、全量 CI（3/3）、独立 Reviewer LGTM、envelope
  稳定性证据，**§3 merge gate 视为全绿**。

## 2. 执行记录（agent 按 Owner 授权执行）

| 动作 | 结果 |
|---|---|
| merge gate 证据 | `sub49_merge_gate_evidence.md`（commit `30b93ae`） |
| merge | PR provenlattice#51 → `main`，merge commit `55ad30b56fa4d22930d738c78d1ef7f74867443b`，2026-11-04T02:09:42Z，mergedBy `sunSUNQ` |
| verify | `sub49_verify_evidence.md` → `status:verified` / `need:owner` |

## 3. 当前状态

```text
#49: status:verified / review:lgtm / need:owner
```

close 为 Owner 动作（`need:owner`），待 Owner 关闭或授权。

## 4. 下游解锁

#48（S7-F2）硬前置 `#49 verified/closed`。**#48 的解锁需 #49 关闭 + Owner 单独授权
S7-F2 实现**；本次不自动解锁、不启动 Worker。