# #48 S7-F2 — Owner 实现授权 + §5.11 三态核对

**Task**: `PL-S7-F2-AND-SUB10-AUTHORIZATION-V1`
**Date**: 2026-11-04
**决策主体**: Human Owner（sunSUNQ）

## 1. Owner 授权

- **#48 S7-F2**：批准解除由 #49 前置依赖产生的阻断，允许 Worker 按冻结范围认领并实现。
- **#46 SUB-10**：亦在本次实现权限内（**已由并行 Worker 完成**：PR #52 `a0aa684`，
  in-review / review:lgtm / need:owner，等 Owner merge）。
- #43/#44/#45/#47 保持原状态，不授权实现。
- Merge / Close 仍 Owner 决策；实现者禁止自审。

## 2. §5.11 same_storage 三态核对（cwe1123_v2_query_contract.md）

| 条款 | 核对结果 |
|---|---|
| `same_storage` 三态 | 可证明同=true；可证明异=false；不可证=unknown（不得恒 false，不得 upgrade definite） |
| §5.11.3 约束 | 不得引入通用 points-to/alias/heap；证据不足即 unknown |
| SUB-07 carve-out | 仅处理**可证明身份链**（`form==address_of` ∧ 单参入口 ∧ 帧内裸拷贝链完整唯一 ∧ 无运行时实例歧义）→ must |
| §1.6 | `same_storage=true` 仅当 DEREF_RESOLVES_TO 的 must 结论成立 |
| §1.7 | pointer_var / 间接入口 / 分支重赋值 → may/unknown，永不升级 |
| §1.8 | 默认 OFF；ON 仅在可证明 must 时置 true |

**结论**：S7-F2 实现须严格三态、must-only、default-OFF；`unknown` 不被推断为确定事实，也不被视为 false。

## 3. 实现边界（#48 owned / forbidden）

- owned：新 query-time 派生模块（`DEREF_RESOLVES_TO` 组装）+ 新测试。
- forbidden：`sparsecfg.py` / `sparsedfg.py` / `concurrency_race_scenarios.py`（不重实现 competing_access）/
  `defect.py` / `evidence.py` / `defect_query.py`；不新增通用 points-to/SSA/heap。

## 4. 数据事实（probe 实证，S7-F1 output）

- THREAD_SPAWN：`thread_function` / `thread_argument_decl_scoped` / `thread_argument_form`(=address_of)。
- DEREFERENCE `*f`：`subject_decl=local:f` / `alias=p` / `owner_qualified_name=writer|closer`。
- WRITE `f=p`：`write_source=p` / `unconditional=true`（帧内裸拷贝唯一）。
- FIX-05：writer+closer 均 must-resolve 到 `local:src/a.c:main:fd:42` → same_storage=true。
- 反例：FIELD_MEMBER（`global:s.a` vs `global:s.b` 异构）不误配；UNDECLARED（scoped 空）→ unknown。

## 5. 实现结果（2026-11-04）

- Worktree `provenlattice-48`，分支 `issue-pilot/48-provenlattice-sub-restricted-deref-resolve`。
- 交付文件（仅 2 个 owned，additive）：
  - `src/provenlattice/deref_resolution.py`（`build_deref_resolution(events, *, enable=False)`）
  - `tests/test_deref_resolution.py`（6 用例：FIX05 must 对 / default-OFF / FIELD_MEMBER / PARAMETER_TWO_FUNCTIONS / UNDECLARED / POINTER_VAR）
- 测试：全量 `772 passed`（no regression，含 #46 已合并的 4 新用例）；CI 待跑。
- PR：[provenlattice#53](https://github.com/sunSUNQ/provenlattice/pull/53)，HEAD `11b0b98`，
  rebase 于最新 main `de006ef`（#46 合并后），`mergeable: MERGEABLE`。

## 6. 独立复审（非实现者）

- 复审者：`pl-owner-reviewer[bot]`（App 身份，非实现 Worker / 非 Owner sunSUNQ）。
- **最终状态（Owner 已裁定）**：03:15/03:16 的**真正独立** Reviewer（非我上一轮被撤销的自审子代理）
  对 PR #53 复核通过 LGTM，代码满足 §1.5/§1.6/§1.7/§1.8 与 §2 S7-F2 全部要求；按状态机
  `review lgtm→owner`，**#48 保持 `need:owner`**（接受独立 LGTM，不撤销）。
- **Merge 被 §3 门 GATED**（该 review 明确标注）：§3 第 1 项（REAL_CORPUS_FP_FN）与第 2 项
  （PERF_OVERHEAD）尚未产出，故 **Owner 须 Hold merge**，不得自动放行（合同 §0
  `SUB07_MERGE_AUTHORIZED = NO` / `SUB07_DEFAULT_ENABLED = NO`）。
- 实现者不自审、不代审、不 merge；Merge/Close 仍由 Owner 决策。
- 独立 Review 观察（供 Owner 知悉）：
  - 模块为独立 query-time 模块，未接线到 `concurrency_profile.py`/`defect_query.py`
    （二者为 forbidden；FIX-05 same_storage=true 候选链在本模块边界演示，端到端接线留待后续 R3）。
  - `_sole_param_name` 依赖单参签名最后一个空白 token；异常格式 → may 降级，永不误 must。