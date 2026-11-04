# G0 Call Relation Contract — DRAFT（SUB-09 / R6 输入合同，待 Owner 冻结）

**Decision ID**: `ISSUE-PILOT-SUB09-G0-CALL-RELATION-V1-DRAFT`
**Parent**: #36 · **Sub**: #45（SUB-09 / R6）· **Status**: DRAFT（待独立 Reviewer → Owner 冻结）
**Date**: 2026-11-04
**Frozen precedent**: 本合同不新增 Schema/edge，只界定 #45 可消费与必须新增的「call relation」事实语义。

---

## 1. 目的

界定「调用关系」事实在 ProvenLattice 各层的当前真实形态（已冻结输入），以及 #45 建立
`MAY_CALL` 所必须新增的事实与 unknown 语义。本合同本身是治理文档，不改变任何生产行为。

## 2. 已冻结输入（G0 · 现存，无需改动）

### 2.1 语法层：`ParsedReference`（`parsing/cpp.py:_call`）

每个 call 产出 `ParsedReference(type="CALLS", target=<normalized callee text>, metadata)`，
C 语言路径（`language == "c"`）由 `_classify_callee` 标注：

| 字段 | 取值 | 语义 |
|---|---|---|
| `call_kind` | `direct` / `indirect` | 是否可被名字绑定 |
| `callee_shape` | `identifier` / `qualified` / `field_access` / `deref` / `subscript` / `nested_call` / `complex` / `missing` | callee 语法形态 |
| `callee_symbol`（field_access）| 接收者名（`g_timePara`）| `g_timePara.procFunc()` 的 receiver |
| `field`（field_access）| 成员名（`procFunc`）| 字段名，**未**与 receiver 合成 `field_path` |
| `callee_expression`（deref/subscript/complex）| 表达式文本 | 兜底形态 |

### 2.2 绑定层：`resolver.py:_resolve_reference`

- `call_kind == "direct"` → 可解析，唯一目标时产生 L1 `CALLS` edge（`resolved_symbol_id`）。
- `call_kind == "indirect"` → **永不名字绑定**：返回 `[], None, "indirect_call_shape", 0.0`。这是现有 fail-closed 约定，本子不得破坏（不得把间接调用升级为 definite）。

## 3. 事实缺口（FE-6 · 本子需新增）

全仓库无 `MAY_CALL` / `CALL_TARGET` / `is_indirect`（access 事件）/ `field_path`。缺三项事实：

1. **field_path 合成**：`g_timePara.procFunc()` 现只有 `callee_symbol` + `field` 两个分离串，无
   `field_path = "g_timePara.procFunc"` 合成事实，故无法发出 call-site `AccessEvent(READ)`。
2. **fp 赋值事实**：`_is_function_pointer_declarator` 只识别 fp **声明**（`int (*fp)(int);`）并加入
   `local_callables`；**没有** `procFunc = timer_fn`（字段成员赋值）或 `fp = &foo`（局部赋值）这类
   「该 fp 被赋成了哪个函数」事实。MAY_CALL 目标解析因此无输入。
3. **call-site READ 事件**：间接调用的 callee 字段目前不发任何 READ 访问事实（R6 要求
   `AccessEvent(g_timePara.procFunc, READ, is_indirect=true)`）。

## 4. 本子输出合同（MAY_CALL 语义，additive）

| 情形 | 行为 |
|---|---|
| 已赋值 fp（`procFunc = timer_fn`）| `MAY_CALL=[timer_fn]` + call-site field `READ`（`is_indirect=true`）|
| 未赋值 fp | `MAY_CALL={}` + field `READ` 仍发 + `may_be_false_positive=true` |
| unknown / 复杂 receiver / 数组 dispatch / 跨 TU 多目标 | 保持 unknown/`{}`，**永不**升级 definite `CALLS` |

约束：
- additive：不新增物理 edge / SQL schema；`MAY_CALL` 目标集合为查询期派生。
- 不改变既有 direct `CALLS` 解析语义；不改变旧 envelope 默认行为。
- fail-closed：未赋值 fp 绝不产生确定 CALLS。

## 5. 证据来源（可追溯性）

- 间接调用分类：`parsing/cpp.py:_classify_callee` + `resolver.py:234-238`（`indirect_call_shape`）。
- fp 声明识别：`parsing/cpp.py:_is_function_pointer_declarator` / `callable_typedefs` / `local_callables`。
- 缺口实证：全 `src/` 无 `MAY_CALL`/`CALL_TARGET`/`is_indirect`/`field_path`（`graph_requirements_gap_matrix_v2.md` R6 行）。

## 6. 兼容性要求

- 冻结后仅作为 #45 输入合同与 MAY_CALL 输出语义依据，不授权任何生产代码修改。
- 正式 feature 实现仍需 Owner 单独授权（`FE-6/MAY_CALL` 当前 HOLD）。
- 若后续发现本合同的 field_path / fp 赋值事实需改动 Schema 或扩大文件边界，必须 STOP 上报，不实施。

## 7. 状态

- NEXT GATE = `INDEPENDENT_REVIEW_OF_CONTRACT` → Owner 决定是否冻结（`call relation contract 冻结`）。