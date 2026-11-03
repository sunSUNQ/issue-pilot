# CWE-1123 V2 Query Contract（Evidence Schema V2 冻结版）

> 状态：**R0_SCHEMA_FROZEN** —— 已冻结 G0 lock 字段（§3，#40）、R0 `mechanism_facts` 附加块（§4，#42）、`competing_access` 字段（§5.1，#41）以及 SUB-03 所有的完整五块装配/序列化合同（§5，#39）。
> 本文件为「恢复版」：原文缺失，依据现有受控资料整合重建，不凭空补充算法、不修改既定判定规则。
> 本次冻结只使 #39 具备等待人类 Owner 批准的合同条件；**不构成 approve，不授权实现，不启动 Worker**。SUB-07/08/09/11 的分析职责与授权状态不变。

## 0. 来源与基线

- 重建依据（只读）：
  - 父 Issue #36「Seven-file graph improvement program」
  - 子 Issue #40（SUB-04/R4）、#42（SUB-06/R10）
  - `pl_sub_issue_sub04_r4_lockset.md`、`pl_sub_issue_sub06_r10_mechanism_exposure.md`
  - `graph_requirements_gap_matrix_v2.md`
  - `pl_graph_improvement_dependency_dag.md`、`pl_graph_improvement_wave_plan.md`、`pl_graph_improvement_sub_issue_matrix.md`
  - `pl_t01_implementation_contract_v1.md`（E-DEFECT 关联与 trace_evidence 链合同，已冻结）
- 产品代码基线：`sunSUNQ/provenlattice` v1.6.0 原始基线 `b6e656681da4c04d34a237b925176221129e0b24`；本文件冻结时 `main` 已含全部 5 个 producer merge，HEAD = `4a7ff06dcf492b5e8674a25a5b1bb8404ba8494e`（2026-11-03）。
- 5 个 producer 已全部落地并 merge：SUB-01 `7a6d602`（PR #46）、SUB-02 `855b498`（PR #45）、SUB-04 `2abe216`（PR #48）、SUB-05 `4a7ff06`（PR #49）、SUB-06 `562c12a`（PR #47）。
- 冻结决策记录：`g0_partial_contract_freeze_decision.md`、`sub03_r0_schema_freeze_decision.md`。

## 1. 范围与所有权

| 块 | 字段 | 本轮状态 | 合同所有权 | 落地 Sub |
|---|---|---|---|---|
| access 事实 | `access_kind`、`is_write` | 已落地（Wave 1） | SUB-02（R1） | #38（closed） |
| trace 证据链 | `trace_evidence[]`、`evidence_id` | 已冻结（T01） | SUB-01（R9） | #37（closed） |
| **lock 事实** | `held_locks[]`、`lock_identity`、`SAME_LOCK/DIFFERENT_LOCK/PROTECTS`、`UNLOCK_OMITTED_ON_PATH` | **本轮冻结** | SUB-04（R4） | #40 |
| **competing_access 事实** | `same_storage`、`at_least_one_write`、`may_execute_concurrently`、`common_lock`、`different_lock`、`unprotected` + confidence 排序 + top-K | **本轮冻结** | SUB-05（R5） | #41 |
| **mechanism_facts 附加块** | `race_condition`、`lock_order`、`resource_lifetime`、`unlock_discipline` | **本轮冻结（块名+语义）** | SUB-06（R10） | #42 |
| 五块 evidence schema | `candidate.evidence_v2` 下的 access/lock/competing_access/trace_evidence/confidence_limitation | **FROZEN（装配/序列化）** | SUB-03（R0） | #39 |

> 关键澄清：`mechanism_facts` 是 R0 候选记录的**独立可选附加块**，**不纳入** SUB-03 的五块 evidence schema。二者无所有权重叠。

---

## 2. access 事实字段（已落地，参考）

- `access_kind ∈ {READ, WRITE, READ_MODIFY_WRITE}`；`is_write ∈ {true, false}`。
- `READ_MODIFY_WRITE` 仅限自读写更新（`x+=y`/`x++`/`--x`）；`x = x + 1`（右值读非自读）为 `WRITE`，不得判为 RMW。
- `event_type` 与事件身份、组包逻辑不变（仅 additive `access_kind/is_write`）。
- 事实来源：`sparsecfg.py:110-125`（`_is_read_modify_write`）、`:1412/1439`（WRITE/READ 发射）；`concurrency_race_scenarios.py`（`_rmw_spans` 读 `access_kind`）。
- 未在本轮重冻；供 SUB-04/SUB-05 参考。

---

## 3. lock 事实字段（G0 局部冻结 · #40 / SUB-04 / R4）

### 3.1 字段契约（语义级冻结）

| 字段 | 语义 | 数据类型（语义） | 事实来源 | 状态 |
|---|---|---|---|---|
| `held_locks[]` | 访问点处被持有的锁集合，元素为**可证明的锁对象身份**（非名字字符串） | 数组（元素为锁身份） | 由 lock events + 方法内 `CONTROL_REACHES` 投影 | FROZEN（语义） |
| `lock_identity` | 单个锁的对象身份 | 身份 token | `analysis_c_events.py:210-220`（`lock_identity`）；`concurrency_lock_scenarios.py:60`（`_identity`） | FROZEN（语义） |
| `SAME_LOCK` | 同一锁保护两个访问 → 不报（排除） | 关系 | 由 lockset 比较推导 | FROZEN（语义） |
| `DIFFERENT_LOCK` | 访问对由不同锁 / 无锁保护 → 报（候选） | 关系 | 由 lockset 比较推导 | FROZEN（语义） |
| `PROTECTS` | 锁保护某访问的关系 | 关系 | 由 lockset 推导 | FROZEN（语义） |
| `UNLOCK_OMITTED_ON_PATH` | 存在可达路径在访问点后未释放已获取锁 | flag | 由方法内 CFG 走查 | FROZEN（语义） |

补充语义约束（契约不可违反）：

- `held_locks` 必须有可证明的**对象身份**；身份不可断定即不得计入 held。
- `try`/`timed` acquire **不直接认定为 held**。
- RAII 隐式释放**不误判为泄漏**（不产 `UNLOCK_OMITTED_ON_PATH`）。
- 跨函数持锁 / 未知路径 → 标 `limitation`，**不升级 definite**。
- 方法内无法闭合的漏 unlock 路径 → `unknown`（不产 `UNLOCK_OMITTED_ON_PATH`）。
- **不新增 points-to、不新增底层关系**：只复用现有 lock facts + 方法内 `CONTROL_REACHES`。

### 3.2 事实来源（代码证据，v1.6.0）

- events 层已提供 `lock_identity / subject_exact / acquire_kind / raii`：`analysis_c_events.py:207`（raii 判定）、`:210-220`（lock 事件 dict 字段）。
- lock 场景现有 `lock_pairing`（`:116-171`）与 `lock_discipline`（`:185-279`）：`concurrency_lock_scenarios.py`（当前因缺控制流恒 `ambiguous`、`missing_evidence=control_flow`）。
- 方法内 CFG：sparse_cfg 产出的 `CONTROL_REACHES` 边（方法级，无跨函数）。

### 3.3 文件边界（owned / forbidden）

- owned：`src/provenlattice/concurrency_lock_scenarios.py`、`src/provenlattice/analysis_concurrency_context.py`、新测试。
- forbidden：`sparsecfg.py`、`concurrency_race_scenarios.py`、`defect.py`、`defect_query.py`。

### 3.4 精确形状落地状态

- SUB-04 已落地 `access_locksets[]`（`held_locks` 为锁身份 string 数组）与异构 `relations[]`；SUB-03 的精确消费和 candidate 过滤规则冻结于 §5.3。
- `PROTECTS` 已落地为 `lock -> access_event_id`；`SAME_LOCK/DIFFERENT_LOCK` 已落地为 `access_event_ids` pair；不再是 #39 的未决项。

---

## 4. mechanism_facts 附加块（R0 局部冻结 · #42 / SUB-06 / R10）

### 4.1 块契约（块名+语义冻结）

`defect_query` 输出新增 additive `mechanism_facts` 块，按机制分块：

| 块名 | 语义 | 事实来源 | 状态 |
|---|---|---|---|
| `race_condition` | race 候选机制结果 | `defect.py:2341`（`race_condition` 查询） | FROZEN |
| `lock_order` | 锁序反演 / self-deadlock 机制结果 | `defect.py:1753`（`lock_order` 查询） | FROZEN |
| `resource_lifetime` | 资源生命周期（alloc/release、未释放锁）机制结果 | `defect.py:1008`（`resource_lifetime` 查询） | FROZEN |
| `unlock_discipline` | 解锁纪律机制结果 | **UNRESOLVED（无既有查询状态；`QUERY_NAMES` 不含此名）** | FROZEN（块名）· 来源 UNRESOLVED |

语义约束（契约不可违反）：

- **只序列化已计算状态，不新算、不改判定**。
- `unlock_discipline` 无既有状态 → SUB-06 不填充、不发散；待 SUB-04 `UNLOCK_OMITTED_ON_PATH` 或未来 unlock 查询产出后，再 additive 填充。
- 机制事实与 race 候选**按身份绑定一致**（同一 subject/identity）。
- 旧 `candidates` / `evidence_bundles` 列表字段**零回退**。
- 即使 race 候选为 0，`lock_order` / `resource_lifetime` 等已存在状态仍须可见。

### 4.2 事实来源（代码证据，v1.6.0）

- 8 类查询已实现：`defect.py:95-108` `QUERY_NAMES = (resource_lifetime, lock_order, race_condition, null_flow, use_after_free, double_free, taint_path, error_handling)`。
- `defect_query.py:93`（`query_defect_candidates`）、`:210`（`for query_name in SUPPORTED_DEFECT_QUERIES`）、`:223-237`（排序/平铺）、`:264-265`（`candidates` + `evidence_bundles` 平铺）。
- concurrency profile 独立暴露 lock 场景：`concurrency_profile.py:234-268`。

### 4.3 文件边界（owned / forbidden）

- owned：`src/provenlattice/defect_query.py`、`src/provenlattice/defect.py`、新测试。
- forbidden：`sparsecfg.py`、`concurrency_*`、`evidence.py`。

### 4.4 落地状态与剩余非阻断项

- `unlock_discipline` 块的事实来源（见 §4.1，标注 UNRESOLVED）。
- 各块的精确 payload 已由 SUB-06 落地为既有 Candidate 完整序列化；#39 不改写该形状。
- 其余 5 类既有查询（`null_flow/use_after_free/double_free/taint_path/error_handling`）是否纳入 `mechanism_facts` —— **不在本轮冻结，留待 Owner 后续决策**。

### 4.5 与五块 schema 的关系

- `mechanism_facts` 是**独立可选附加块**，不并入 SUB-03 五块（access/lock/competing_access/trace_evidence/confidence-limitation）。
- 五块归属 SUB-03（#39，R0），完整装配/序列化合同冻结于 §5；`mechanism_facts` 仍是独立顶层附加块。

---

## 5. Evidence Schema V2 完整五块合同（FROZEN · #39 / SUB-03 / R0）

### 5.1 容器、适用面与关联键

每个由 `defect_query` 或 concurrency profile 序列化的 candidate additive 携带且始终携带：

```json
{
  "evidence_v2": {
    "access": [],
    "lock": {
      "access_locksets": [],
      "relations": []
    },
    "competing_access": [],
    "trace_evidence": [],
    "confidence_limitation": {
      "analysis_kind": "unknown",
      "confidence": null,
      "may_be_false_positive": true,
      "limitations": []
    }
  }
}
```

- Schema 名称：**Evidence Schema V2**；唯一容器路径：`candidate.evidence_v2`。
- 五块固定为 `access`、`lock`、`competing_access`、`trace_evidence`、`confidence_limitation`；五块不得因无事实而省略。
- candidate 主关联键为 candidate 自身 `evidence_id`；`defect_query.evidence_bundles[].candidate_id` 必须与之精确相等。concurrency candidate 的 `evidence_id` 保持 `E-DEFECT-*`。
- access/lock/competing 子事实只用精确 `access_event_id` 关联。V2 adapter 可把 SUB-02 `related_accesses[].event_id` 映射为 `access_event_id`，但不得凭 subject 名称、行号或近似字符串关联。
- 精确关联失败时，对应集合保持空并加入稳定 limitation token；不得做 fuzzy join。
- 产品事实基线为已验证合并：SUB-01 `7a6d602`、SUB-02 `855b498`、SUB-04 `2abe216`、SUB-05 `4a7ff06`、SUB-06 `562c12a`。

### 5.2 `access` 块

`access` 为按 `(source_span.start, source_span.end, access_event_id)` 稳定排序的数组。每条记录形状：

```json
{
  "access_event_id": "event-id",
  "event_type": "READ",
  "access_kind": "READ",
  "is_write": false,
  "owner": "reader",
  "source_span": [12, 12]
}
```

| 字段 | 类型 / 枚举 | 精确来源 |
|---|---|---|
| `access_event_id` | non-empty string | SUB-02 `related_accesses[].event_id` |
| `event_type` | `READ \| WRITE` | SUB-02 既有事件类型 |
| `access_kind` | `READ \| WRITE \| READ_MODIFY_WRITE \| unknown` | SUB-02 `access_kind` |
| `is_write` | boolean or `null` | 仅把精确字符串 `"true"/"false"` 确定性规范化；其他值为 `null` |
| `owner` | string | SUB-02 access owner |
| `source_span` | `[integer, integer]` | `start_line/end_line` |

- `access_event_id` 缺失的记录不得进入 V2 `access`，并加入 `access_event_linkage_unavailable`。
- `access_kind` 缺失或不在枚举内时写 `unknown` 并加入 `access_kind_unavailable`；`is_write` 不是精确 `"true"/"false"` 时写 `null` 并加入 `is_write_unavailable`。
- 规范化只发生在 V2 adapter；不得修改 SUB-02 的底层字符串注解、事件身份或旧 `related_accesses`。

### 5.3 `lock` 块

`lock.access_locksets[]` 精确消费 SUB-04 `build_access_lockset()` 的记录，并只保留 `access_event_id` 属于当前 candidate 的条目：

```text
access_event_id: string
event_type: string
owner: string
owner_symbol_id: string
subject: string
subject_decl: string
start_line/end_line: integer
held_locks: string[]
limitation: string[]
candidate_state: ambiguous
```

`lock.relations[]` 精确消费 SUB-04 已落地的四类异构关系：

- `PROTECTS`：`relation/lock/access_event_id/owner/owner_symbol_id`；目标 access 属于当前 candidate。
- `UNLOCK_OMITTED_ON_PATH`：同上并带 `candidate_state=ambiguous`；目标 access 属于当前 candidate。
- `SAME_LOCK`：`relation/subject/subject_decl/access_event_ids/owners/locks`；两端 access 都属于当前 candidate。
- `DIFFERENT_LOCK`：`relation/subject/subject_decl/access_event_ids/owners/unprotected`；两端 access 都属于当前 candidate。

规则：

- 保留 SUB-04 的稳定顺序；#39 不重新推导 lockset，不改变 `limitation`（生产者字段为单数）或关系 arity。
- `held_locks` 只含 SUB-04 已证明的锁对象身份；不得将名字级 proxy 升级为锁身份。
- `lock.coverage` 不复制到每个 candidate；查询/profile 级 coverage 可原样保留。
- 无法取得 lockset 输入时两个数组均为空，并加入 `lock_facts_unavailable`；不得推断为 unprotected。

### 5.4 `competing_access` 块

每条记录精确沿用 SUB-05 已落地字段：

```text
subject: string
identity: string or null
same_storage: "true" | "false" | "unknown"   (string 三态)
at_least_one_write: boolean
may_execute_concurrently: boolean
common_lock: boolean
different_lock: boolean
unprotected: boolean
confidence: number
candidate_state: ambiguous
accesses: [{access_event_id, event_type, access_kind, is_write,
            owner, start_line, source_span, held_locks}]
```

- pair 的两个 `access_event_id` 都必须属于当前 candidate，才能装入该 candidate 的 V2 块。
- `same_storage=unknown` 可作为诊断候选保留，但不得升级为 `true` 或 `definite`；当前生产者不能证明 `false` 时不得 fabrication。
- #39 必须在 `concurrency_profile.py` 仅接通已存在的 sparse CFG `edges` 与 events `lock_facts`，使 SUB-05 builder 能消费 SUB-04；该 wiring 不得重新实现或改变 access、lock、pair、confidence 逻辑。
- #39 **不得重新排序、不得二次 top-K、不得二次 hard-cap**。必须逐项保留 SUB-05 输出顺序和集合。
- SUB-05 的默认 `top_k=3`、同 confidence tie-preserving、hard cap 100 保持不变。#39 不新增 config/CLI/MCP 参数。
- `coverage.competing_access.{total,returned,truncated,top_k}` 只允许从 SUB-05 coverage 原样传播；不得重新计算。tie-preserving 可能使 `returned > top_k`，这不是二次截断理由。

### 5.5 `trace_evidence` 块

`trace_evidence` 原样消费 SUB-01 已落地的有序数组；每步固定字段与枚举：

```text
step: positive integer
step_type: access | lock | flow | call | limitation
from_loc/to_loc: {file: string|null, line: integer} | null
label: string
refs: string[]
ground: fact | limitation
```

- #39 不重新生成、不重新排序、不改写 label/refs/ground。
- `refs` 继续只引用 candidate 已有事件 ID 与 candidate 自身 `evidence_id`。
- 现有 candidate 没有 trace 时数组为空，并加入 `trace_evidence_unavailable`；不得调用新分析补链。

### 5.6 `confidence_limitation` 块

```json
{
  "analysis_kind": "may",
  "confidence": 0.5,
  "may_be_false_positive": true,
  "limitations": ["may_parallel"]
}
```

`analysis_kind` 与 `confidence` 是两个独立维度，禁止互相推导数值或确定性：

| 精确来源状态 | `analysis_kind` | `may_be_false_positive` |
|---|---|---|
| 已有明确 `analysis_kind=definite`（未来 additive 来源） | `definite` | `false` |
| concurrency `candidate_state=ambiguous` | `may` | `true` |
| defect `resolution_status=resolved` 或 `ambiguous` | `may` | `true` |
| `candidate_state/resolution_status=unresolved` | `unknown` | `true` |
| 无可识别状态来源 | `unknown` | `true` |

- `resolution_status=resolved` 只表示图上的决定性关系已解析，不是 Verified Finding，故不得映射为 `definite`。
- `confidence` 只复制当前 candidate 或匹配 `DefectEvidenceBundle` 的既有数值；不得从 `analysis_kind`、missing evidence 数量或 pair 数量计算。
- `competing_access[].confidence` 是 pair 级 band，不得提升为 candidate 级 confidence。
- concurrency E-DEFECT 的历史占位 `0.0` 不作为可靠 candidate score；没有其他明确 candidate 数值来源时写 `null` 并加入 `confidence_unavailable`。
- confidence 是 band/启发式分数而非校准概率；#39 不重校准、不改值。

`limitations[]` 是以下稳定 token 的去重并集，并按字典序排序：

1. candidate 或匹配 evidence bundle 的 `missing_evidence[]`；
2. 当前 candidate 已关联 `access_locksets[].limitation[]`；
3. adapter 自身产生的缺块/缺关联 token（如 `access_event_linkage_unavailable`、`lock_facts_unavailable`、`trace_evidence_unavailable`、`confidence_unavailable`）。

trace step 的自然语言 `label` 不得反向解析为 limitation；其底层 `missing_evidence` 才是稳定来源。

### 5.7 unknown / null / false 语义

| 情况 | 冻结编码 |
|---|---|
| 三态关系未知（如 `same_storage`） | string `"unknown"` |
| 数值未知（如 candidate confidence） | JSON `null` |
| boolean 未知 | JSON `null` |
| 没有集合事实 | `[]` |
| 没有块事实 | 块仍存在，内部集合为空 |
| 缺失原因 | 稳定 token 写入 `confidence_limitation.limitations[]` |

- `false` 只表示生产者可证明为 false；unknown 不得序列化为 false。
- 当前无事实来源的 `field_path/acquire_site/release_site` 不进入本次冻结结构，不以占位字段扩张 schema。

### 5.8 `mechanism_facts` 独立边界

- `mechanism_facts` 保持 SUB-06 已落地的查询结果顶层独立附加块，不进入 `candidate.evidence_v2`。
- #39 不改变 `race_condition/lock_order/resource_lifetime` 的条目、数量、顺序或内容。
- `unlock_discipline` 仍因无生产者而缺省；该缺口不由 #39 填补。

### 5.9 旧 envelope 兼容合同

- 旧 `candidates`、`evidence`、`evidence_bundles` 的数量、顺序、已有字段和值零回退；仅 additive 增加 `evidence_v2`。
- 旧 `status/candidate_count/coverage/truncated/grade/level/matrix_keys/provenance` 不得删除或改变既有语义。
- 生产 wiring 只允许使 SUB-05 已定义的 `competing_access` 与其 coverage 在 profile 中可达，不得改变旧 candidate/evidence 列表。
- 同一输入两次运行的 JSON 必须字节稳定。

### 5.10 SUB-03 文件边界与最小验收

owned：

- `src/provenlattice/evidence.py`
- `src/provenlattice/defect_query.py`
- `src/provenlattice/concurrency_profile.py`
- #39 直接相关的新测试/现有测试

forbidden：

- `src/provenlattice/defect.py`
- `src/provenlattice/sparsecfg.py`
- `src/provenlattice/concurrency_race_scenarios.py`
- `src/provenlattice/concurrency_lock_scenarios.py`
- storage/schema、CLI/MCP 参数面、policy、AGENTS、版本与发布文件

最小验收：

```text
python -m pytest tests/test_evidence.py tests/test_analysis_query.py \
  tests/test_concurrency_profile.py tests/test_concurrency_race_scenarios.py \
  tests/test_concurrency_lock_scenarios.py tests/test_mechanism_facts.py -q
```

必须断言：五块恒在；`is_write` 为 boolean/null；生产 profile 的 SUB-05 pair 可达；无 lock facts 不伪造 unprotected；ambiguous/unresolved 不升级 definite；confidence 无来源为 null；unknown 不等于 false；旧 envelope 零回退；不二次排序/截断 pair；`mechanism_facts` 独立；输出确定性。

---

### 5.11 competing_access 生产者语义（既有局部冻结 · #41 / SUB-05 / R5）

`defect_query` / concurrency race 场景输出 additive `competing_access[]`（访问级 per-pair 语义 + confidence），由主体级 MAY_PARALLEL 提升而来。

#### 5.11.1 字段契约（语义级冻结）

| 字段 | 语义 | 事实来源 | 状态 |
|---|---|---|---|
| `same_storage` | 两访问是否指向同一存储对象：可证明同 → true；可证明异 → false；无法证明 → **unknown**（不得视为 false，不得当作 definite） | 复用 SUB-02/SUB-04 已冻结事实（`access_kind`/`held_locks`/`lock_identity`），不 guess | FROZEN（语义） |
| `at_least_one_write` | 访问对至少一个是写 | SUB-02 `access_kind`/`is_write`（`READ/WRITE/READ_MODIFY_WRITE`） | FROZEN（语义） |
| `may_execute_concurrently` | 两访问可能并发执行 | `analysis_concurrency_context.py:179-199` 主体级 `may_parallel` | FROZEN（语义） |
| `common_lock` | 两访问受同一锁保护 → 排除 | SUB-04 `held_locks` → `SAME_LOCK` | FROZEN（语义） |
| `different_lock` | 两访问受不同锁 / 无锁 → 竞争候选 | SUB-04 `DIFFERENT_LOCK` | FROZEN（语义） |
| `unprotected` | 无锁保护 | SUB-04 锁关系 | FROZEN（语义） |

#### 5.11.2 confidence 排序 + top-K（语义级冻结）

- 排序键 = 既有 confidence **band 值**（`defect.py:126-146`，lookup 非估计），降序。
- `top-K = 3`（默认，可配置）；**确定性排序**（相同输入结果稳定）；不得截掉必要候选；维持 hard cap。
- **不修改原有 confidence 语义**（band lookup 与取值不变，不重校准、不新增枚举）。

#### 5.11.3 语义约束（契约不可违反）

- `same_storage` 无法证明时保留 `unknown`，**不得视为 false**、**不得当作 definite**。
- 不得新增 points-to / alias / heap analysis：`same_storage` 仅基于既有 storage 身份证据，证据不足即 `unknown`。
- 不得重新实现 SUB-02（`access_kind`/`is_write`）或 SUB-04（`held_locks`/锁关系），只消费其已冻结输出。
- read/read 不构成竞争（=0）；同锁排除。
- 无法确认同一 storage 的样本：保留诊断证据，但**不得计作已确认的竞争关系**。

#### 5.11.4 文件边界（owned / forbidden）

- owned：`src/provenlattice/concurrency_race_scenarios.py`、`src/provenlattice/analysis_concurrency_context.py`、`src/provenlattice/defect.py`(race_condition)、新测试。
- forbidden：`concurrency_profile.py`、`sparsecfg.py`、`concurrency_lock_scenarios.py`。

#### 5.11.5 已解决形状项

- per-pair 精确 JSON 形状由 SUB-05 实现和 §5.4 冻结；#39 原样消费。
- #39 不扩大 config/CLI/MCP：继续使用 SUB-05 默认 `top_k=3`，只原样传播 coverage。

---

## 6. RESOLVED / UNRESOLVED 登记表

| # | 项 | 类别 | 是否阻断本轮 | 说明 |
|---|---|---|---|---|
| U1 | lock 字段精确 JSON 形状（`held_locks[]` 元素 / `SAME_LOCK` 等关系表示） | 形状 | **已解决** | SUB-04 实现 + §5.3 原样消费 |
| U2 | `PROTECTS` arity / 引用目标 | 形状 | **已解决** | `lock -> access_event_id`，见 §5.3 |
| U3 | `unlock_discipline` 块事实来源（无既有查询状态） | 事实来源 | 否 | SUB-06 不填充；SUB-04/未来 unlock 产出后回填 |
| U4 | mechanism 各块 payload 形状 | 形状 | 否 | 块名+语义已冻结；SUB-06 序列化既有状态 |
| U5 | 其余 5 类既有查询是否入 mechanism_facts | 范围 | 否 | 不属于本轮冻结；Owner 后续决策 |
| U6 | competing_access per-pair 字段精确 JSON 形状（`same_storage` 三态载体 / 关系字段表示） | 形状 | **已解决** | SUB-05 实现 + §5.4 原样消费 |
| U7 | `top-K` 可配置参数暴露位置（config / CLI / MCP） | 形状 | **已解决（#39）** | #39 不新增公开参数；默认 3，原样传播 coverage |

> 阻断判定：U1/U2/U6/U7 已由真实生产者与本次 adapter 合同解决；U3/U4/U5 属 `mechanism_facts` 或后续范围，不阻断 #39。当前不存在未解决的 R0 五块字段冲突。

---

## 7. 冻结范围边界与授权状态（防越权）

- 冻结 §3（lock 生产者语义）、§4（mechanism_facts 块名+语义）、§5.11（competing_access 生产者语义）及 §5（#39 完整五块装配/序列化合同）。
- 不宣称 SUB-07 的 canonical storage / points-to、SUB-08 lifetime、SUB-09 MAY_CALL、SUB-11 precision guardrail 已冻结或获实现授权。
- 本次冻结不修改其他 Sub 授权状态，不构成人类 Owner 对 #39 的 `approve`。
- #39 当前只达到 `READY_FOR_OWNER_APPROVAL`；在 Owner 通过治理流程批准前不得启动 Worker、创建实现 worktree 或提交功能 PR。
- 任何已冻结接口变更 = 父合同变更，走 Owner 决策，受影响 Sub 重新规划（见 DAG 约束）。
