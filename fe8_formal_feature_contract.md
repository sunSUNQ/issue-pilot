# Issue #50 FE-8 — 显式结构化 pragma Feature 合同（FROZEN）

**Task**: `PL-FE8-FEATURE-CONTRACT-FREEZE-V1`
**Decision authority**: Human Owner（sunSUNQ）
**Recorder**: Owner 指定的 Agent 代为留痕（不构成 Agent 自行扩权）
**Date**: 2026-11-04
**Baseline**: product `origin/main` = `de006ef`（FE-8 只读研究基线；独立 Reviewer 事实核验同样基于该提交）
**研究依据**: `fe8_r1_fact_chain_inventory.md`、`fe8_r2_solution_comparison.md`、
`fe8_r2_fixture_design.md`、`fe8_r3_go_no_go_and_minimal_feature_contract.md`
**复审依据**: #50 独立 Reviewer LGTM（关键事实断言逐条回溯到产品代码，fail-closed，无重复覆盖）

---

## 0. 总判定

```text
FE8_RESEARCH_COMPLETE                 = YES   （独立 Reviewer LGTM）
FE8_TYPE_CONVERTED_TO_FEATURE         = YES
FE8_SYNTAX_FROZEN                     = YES   （pragma-only v1）
FE8_FIELD_CONTRACT_FROZEN             = YES
FE8_DETERMINISTIC_ID_FROZEN           = YES
FE8_NESTING_SEMANTICS_FROZEN          = YES
FE8_FORMAL_IMPLEMENTATION_AUTHORIZED  = NO    （实现拆分为后续 Owner 单独决策）
FE8_DEFAULT_ENABLED                   = NO
FE8_MERGE_AUTHORIZED                  = NO
```

本文件是**语法/字段/ID/嵌套语义的冻结合同**，不是实现授权。研究 go/no-go 已裁定：

```text
SOURCE_NATIVE_STRUCTURED_PRAGMA = GO_WITH_OWNER_CONTRACT
ARBITRARY_COMMENT_MARKER        = NO_GO
TEXT_SIMILARITY_OR_DISTANCE_JOIN= NO_GO
EXTERNAL_SCENARIO_MANIFEST      = DEFER
PURE_FUNCTION_GROUPING_AS_SCENARIO = NO_GO
```

---

## 1. 语法（FREEZE）

只支持以下显式白名单 C pragma region：

```c
#pragma provenlattice scenario <scenario_id> begin
/* zero or more statements */
#pragma provenlattice scenario <scenario_id> end
```

- `<scenario_id>` 字符集：`[A-Za-z_][A-Za-z0-9_.-]*`（ASCII identifier，不含 `:`、空白、引号、反斜杠）。
- namespace / name / action 必须完全匹配，字段序固定：`provenlattice` `scenario` `<id>` `begin|end`；
  不做模糊匹配、不做大小写折叠、不做前缀/后缀近似。
- begin/end 必须同文件；同一 `<scenario_id>` 可在多个函数拥有多个独立 region（P5/X2）。
- 首版**明确不支持**：普通 comment、`// scenario` / `// TODO` / benchmark marker、GCC/Clang
  attribute、`_Pragma`、外部 manifest。这些一律产出 0 annotation。

---

## 2. 字段合同（FREEZE）

### 2.1 `scenario_annotations[]`

| 字段 | 类型 | 语义 |
|---|---|---|
| `annotation_id` | string | 确定性生成（见 §3） |
| `scenario_id` | string | 显式 pragma ID；仅来自源码，不从 comment/文本推断 |
| `syntax_kind` | enum | 首版仅 `pragma_region` |
| `relative_path` | string | repo-relative path（正斜杠） |
| `start_byte` / `end_byte` | integer | region 内容边界（begin 之后、end 之前） |
| `start_line` / `end_line` | integer | 人类可读边界 |
| `function_symbol_id` | string/null | enclosing function 可确定时填写，否则 null + limitation |
| `parse_status` | enum | `resolved` / `unknown` / `invalid` |
| `limitations[]` | string[] | 见 §5 unknown 语义 |

### 2.2 `scenario_access_relations[]`

| 字段 | 类型 | 语义 |
|---|---|---|
| `annotation_id` | string | 精确引用 annotation |
| `scenario_id` | string | denormalize 冗余，便于查询 |
| `access_event_id` | string | 精确引用既有 access event |
| `relation` | enum | 首版仅 `CONTAINS_ACCESS` |
| `join_kind` | enum | 仅 `byte_range_exact`；不得 fuzzy/text/distance |
| `function_symbol_id` | string/null | 双方一致时记录 |
| `limitations[]` | string[] | 无则空；unknown 不建 relation |

### 2.3 `function_scenario_groups[]`

- key = `(scenario_id, function_symbol_id, annotation_id)`。
- access IDs 稳定排序（§5/§6 确定性）。
- 一个 access 可因多个合法嵌套 annotation 出现在多个 group（P4）。
- 由明确 relation 聚合，而不是由函数名/文本相似度猜测。
- 与 #46 `function_access_groups` 并存，**不改变其语义**。

### 2.4 命名空间隔离（FREEZE，防 `scenario_id` 撞名）

- 本 feature 的 `scenario_id`（source pragma ID）与候选层**内建 CWE-1123 机制 `scenario_id`**
  （`concurrency_race_scenarios.py` `build_race_scenarios`，取值 `non_atomic_incdec` /
  `bool_flag_race` / `shared_state_race`）是**两个不同命名空间**，分字段/分数组存放，永不混用、
  永不相互覆盖。
- FE-8 只写入 `scenario_annotations[]` / `scenario_access_relations[]` / `function_scenario_groups[]`；
  **禁止**修改候选层的 `scenario_id` / `source_spans` / `supporting_locations` / `function_access_groups`。
- 即使源码 pragma 的 `<scenario_id>` 与内建 ID 文本相同（如 `shared_state_race`），它也仅作为
  `scenario_annotations[].scenario_id` 出现，不改变候选层内建 `scenario_id` 的判定语义。

---

## 3. deterministic ID（FREEZE · 2026-11-04 Owner Decision V1 修订）

> **Owner Decision**：`PL-FE8-F1-DETERMINISTIC-ID-OWNER-DECISION-V1`（APPROVED WITH CONDITIONS）。
> 本修订消除原 §3 种子字段 bullet 顺序与编码模板顺序的不一致，并把最终字节编码冻结为
> 「无条件确定性哈希」，不再以冒号拼接作为默认形式。

- **种子字段（冻结，不得增删），顺序固定（与最终哈希输入顺序一致）**：

  `(repo, relative_path, syntax_kind, scenario_id, start_byte, end_byte)`

  各字段语义（构造上均为非空 / 非 null）：
  - `repo`：稳定的 `store.repo_id`（`identity.repository_id(root)` = root 解析路径 casefold
    后正斜杠化的 SHA-256，跨次索引确定，不随重跑漂移）。
  - `relative_path`：repo-relative path，统一正斜杠（`\` → `/`）。
  - `syntax_kind`：恒为 `pragma_region`（§1 / §2.1）。
  - `scenario_id`：显式 pragma ID，字符集 `[A-Za-z_][A-Za-z0-9_.-]*`，非空。
  - `start_byte` / `end_byte`：确定非负整数（region 内容边界），不会为 null。

- **明确排除 `analyzer_version` 为 ID 种子**：annotation identity 是内容派生的，不随分析器改进而改变；
  analyzer 版本只用于 cache 失效，不进入 ID。

- **最终字节编码（冻结，无条件哈希）**：

  ```text
  canonical = "\x1f".join([repo, relative_path, syntax_kind, scenario_id, start_byte, end_byte])
  annotation_id = "scenario:" + sha256(canonical.encode("utf-8")).hexdigest()
  ```

  - 六字段按上述顺序以 ASCII 控制字符 `\x1f`（unit separator）分隔，UTF-8 编码，SHA-256，
    输出小写十六进制（64 hex）。
  - 无条件哈希：正常路径与含 `:` 路径使用同一算法，不因 `relative_path` 含裸 `:` 而切换编码，
    彻底消除冒号分隔歧义。
  - 各字段以 `str()` 序列化为十进制字符串参与编码；`scenario_id` 字符集不含 `:`（§1 已冻结）。
  - `scenario:` 前缀隔离本 feature 命名空间，与候选层内建 `scenario_id`（§2.4）永不同名。
  - Golden Test 固化字节结果，覆盖：普通路径、含 `:` 路径、重复索引、不同 scenario ID、不同仓库身份。

---

## 4. exact containment / 嵌套 / multi-association 语义（FREEZE）

建立 `CONTAINS_ACCESS` relation 必须**全部**满足：

1. annotation `parse_status == resolved`；
2. annotation 与 access 的 `relative_path` 相同；
3. access 有确定 byte span（`start_byte`/`end_byte` 均可用）；
4. access span **完全位于** region 内容 span：
   `region.start_byte <= access.start_byte ∧ access.end_byte <= region.end_byte`，
   且不包含 begin/end pragma 行本身；
5. function owner 可比较时（annotation.function_symbol_id 与 access 的 function owner 均非 null）
   必须一致；单侧 null 时记录 `limitations=["function_owner_unresolved"]`，仍可建立 relation；
6. source hash 与 `ast:c` analyzer version 均为 current。

缺任何一项 → 不建 relation + 输出对应 limitation；**不得**退化为行距、函数名或文本相似度。

嵌套与 multi-association（对齐 fixture 矩阵）：

| 情形 | 语义 |
|---|---|
| P4 合法嵌套（A 含 B，B 含访问） | 访问对 A、B 各建一条 relation，顺序确定 |
| U3 crossing overlap（A begin→B begin→A end→B end） | 两 region 均 `parse_status=invalid`，0 relation |
| X1 单 region 跨函数边界 | 不允许；limitation，0 relation |
| P5/X2 同 scenario_id 多 region | 各独立 annotation_id；group 按 scenario_id + function 汇总，不合并 span |

---

## 5. unknown / missing 语义（FREEZE，fail-closed）

| limitation | 触发 | 结果 |
|---|---|---|
| `unclosed_scenario_region` | begin 无 end | 0 relation |
| `orphan_scenario_end` | end 无 begin | 0 relation |
| `crossing_scenario_regions` | 非法 crossing overlap | 受影响 region 0 relation |
| `access_span_insufficient` | access 无 byte span 且同行边界不可判定 | 0 relation |
| `annotation_parse_partial` | pragma 被 error/missing 覆盖 | 0 relation |
| `source_hash_stale` | source hash 不匹配 | 全量 stale，0 relation |
| `analyzer_version_stale` | `ast:c` 版本不匹配 | 全量 stale，0 relation |
| `function_owner_unresolved` | annotation 或 access 单侧 function owner 缺失 | relation 可建，标注 limitation |

- unknown 绝不当作 `false`，绝不当作 definite containment。
- 无任何合法 pragma → 三个数组均为空，旧 candidate/envelope 与 #46 三字段逐字节不变。

---

## 6. 确定性 / 稳定性（FREEZE）

1. 同一输入两次输出逐字节稳定。
2. 排序固定：`relative_path` → `start_byte` → `end_byte` → `scenario_id` → `access_event_id`。
3. 删除全部合法 pragma 后，旧 candidate/envelope 与 #46 三字段逐字节不变。
4. 任意普通 comment 数量变化不得改变 scenario relation。
5. source hash 或 analyzer version 改变后旧分析必须 stale，不得复用。

---

## 7. 文件边界与版本（FREEZE，供实现拆分决策引用）

- **owned（候选，待拆分决策最终圈定）**：
  - pragma 解码：从 `PREPROCESSOR` 节点（`analysis_c_frontend.py` `_kind` 已归类）的白名单 pragma
    中解码 `<scenario_id>` 与 begin/end 类型（可落在 `analysis_c_frontend.py` 或新独立模块）。
  - additive 物化 `scenario_annotations[]`（`analysis_c_ast.py` `_materialize` 或新物化层）。
  - `sparsecfg.py` walker point additive 发布 `start_byte/end_byte`（或在 byte 缺失时 fail-closed；
    当前 public point payload 只发 `start_line/end_line`）。
  - 新 query-time relation producer：`scenario_access_relations[]` + `function_scenario_groups[]`。
  - 新测试。
- **forbidden**：
  - `sparsedfg.py`（不新增 DFG 边）；
  - `concurrency_*`（不改变 competing_access 判定）；
  - `defect.py` / `evidence.py` / `defect_query.py`（不改变候选判定语义）；
  - 不新增物理图 edge；不改 SQL schema；不改 #46 三字段语义。
- **版本 bump**：`ANALYZER_VERSIONS["ast:c"]` 3 → 4；`ANALYZER_VERSIONS["sparse_cfg:cpp"]` 1 → 2
  （使旧 cache 自动 stale）。其中 `sparse_cfg:cpp` 1 → 2 系 walker point payload 增加 byte span 所致，
  经 `PL-FE8-F1-SPARSE-CFG-VERSION-BUMP-OWNER-DECISION-V1` 范围例外授权。
- **默认 OFF**：feature 未请求时不增加默认扫描范围；开关 OFF = 旧行为零回退。

---

## 8. 合并门（FREEZE，任一实现子任务 merge 前必须全部满足，同 #43 §3）

1. 真实语料 FP/FN 对照（不得只以合成 fixture 代替）。
2. 性能实测（pragma 解码 + additive 物化 + join 的增量成本，需 profiling）。
3. 开关回退测试（OFF = 零回退）。
4. 全量 CI 绿。
5. 独立 Reviewer（未参与实现的 Agent 或人）。
6. 不改变旧 envelope 默认行为（字节稳定）。

---

## 9. Issue 治理与下一步

- **状态转换**：`type:research → type:feature`；`status:in-review → status:needs-owner`；
  `need:owner` 保持（下一步仍是 Owner：实现拆分 + 正式实现授权）。
- 实现拆分 + 正式实现授权（`FE8_FORMAL_IMPLEMENTATION_AUTHORIZED`）为**后续 Owner 单独决策**，
  沿用 #43 → #49/#48 拆分先例。
- #46 保持 CLOSED / verified，不重开。#50 不重写为 SUB-10 的返工。
- 本决策**不启动 Worker、不创建 worktree/分支/PR、不修改产品代码**。

---

## 10. 最终裁决块

```text
FE8_RESEARCH_COMPLETE                 = YES
FE8_TYPE_CONVERTED_TO_FEATURE         = YES
FE8_SYNTAX_FROZEN                     = YES（pragma-only v1）
FE8_DETERMINISTIC_ID_FROZEN           = YES
FE8_NESTING_SEMANTICS_FROZEN          = YES
FE8_FORMAL_IMPLEMENTATION_AUTHORIZED  = NO
FE8_DEFAULT_ENABLED                   = NO
FE8_MERGE_AUTHORIZED                  = NO
NEXT_ACTION                           = OWNER_DECIDE_IMPLEMENTATION_SPLIT（后续 Owner 决策，非本治理任务）
```