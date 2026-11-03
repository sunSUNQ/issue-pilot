# #36 Parent 追踪合同 — Owner Approval 决策记录

> 任务：`ISSUE-PILOT-OWNER-GATE-43-36-V1`（续：Parent 批准）
> 角色：Master Agent（记录 Owner 决策并落地状态转换）
> 日期：2026-11-03
> 决策主体：人类 Owner（sunSUNQ）

## 1. Owner 决策

**DECISION: APPROVED** —— 批准 #36 Parent「Seven-file graph improvement program」的**追踪合同**。

本批准只批准：追踪范围、依赖关系与整体验收合同。**绝不自动批准任何 Sub**；每个 Sub
继续走自己的 Owner Gate / Worker / Reviewer / PR / merge / verify 流程。

## 2. Owner 已核对的 5 项确认点（`parent36_dag_amendment.md` §5）

1. 接受实际状态表：`#37/#38/#40/#41/#42` verified+closed；`#39` in-review/PR #50；
   `#43` research/A2 分阶段；`#44–#47` blocked。
2. 接受 #43 的 `research → A1 → A1B → A2 spike → Owner 正式实现决策` 分阶段 Gate。
3. 接受 #44/#45 各自独立授权（不因 #43 spike 通过而自动 approved）。
4. 接受 #46 仅依赖 #39 verified 后的稳定 `candidate.evidence_v2` surface；`candidate.span`
   / `supporting_locations` / scenario mapping 归 #46 自身。
5. 明确 Parent approved 不自动批准任何 Sub。

## 3. 依赖边（本批准生效）

```text
FOUNDATION_VERIFIED = {#37, #38, #40, #41, #42}
#39  <- FOUNDATION_VERIFIED
#43  <- frozen storage/access contracts（spike-only 条件授权）
#44  <- #43 正式可消费输出 + THREAD_JOIN handle 事实 + 独立 Owner approval
#45  <- #43 所需 fp/identity 能力 + call relation contract 冻结 + 独立近似分析 Owner approval
#46  <- #39 verified 稳定 surface
#47  <- #41 verified + #43 正式输出 + #44 verified + #45 verified
```

## 4. 状态转换

- #36：`status:candidate → status:approved`，`need:owner` 保留（Parent 为追踪伞，持续由
  Owner 治理各 Sub 的 Gate）。
- 手工改标签的理由：Parent 是 `type:decision / kind:parent` 追踪伞，不存在单一 author 去
  “实现” Parent；CLI `approve` 会误设 `need:author`，故等价改为 `approved + need:owner`。

## 5. 边界声明

- 不自动批准/解锁任何 Sub。
- #43 仅 spike-only 条件授权，正式实现未授权。
- #44–#47 保持 `blocked`；#4/#21 保持 HOLD。