# SUB-07 / #43 — Formal Implementation Contract（FROZEN）

**Task**: `PL-SUB07-FORMAL-IMPLEMENTATION-GATE-V1`
**Decision authority**: Human Owner
**Recorder**: Master Agent（仅治理 + 合同冻结，不启动 Worker）
**Date**: 2026-11-03
**Baseline**: product `main` = `4a7ff06`（A2 spike `d7bd38b` 为 throwaway worktree，未合并、未 push）

---

## 0. 总判定

```text
SUB07_FORMAL_IMPLEMENTATION_AUTHORIZED = YES   （受限功能实现；非默认启用、非生产合并）
SUB07_DEFAULT_ENABLED                 = NO
SUB07_MERGE_AUTHORIZED                = NO
S7_F1_READY                           = YES
S7_F2_READY                           = YES
DOWNSTREAM_SUBS_UNLOCKED              = NO
```

---

## 1. 冻结合同（Step 1）

| # | 冻结项 | 冻结值 |
|---|---|---|
| 1 | 方案 | **Scheme A only**（pthread_create 实参绑定）；B/C 不推进 |
| 2 | 首要支持目标 | **pthread_create**；`thrd_create` 及其他 spawn API 未经核验，不得宣称支持 |
| 3 | 新字段 | `thread_argument_decl_scoped` 为 **additive** 字段 |
| 4 | 文件归属 | `sparsecfg.py` **THREAD_SPAWN 局部区域**为 SUB-07 owned（窄 carve-out） |
| 5 | query-time 消费 | `DEREF_RESOLVES_TO` **仅处理可证明的身份链** |
| 6 | same_storage | `same_storage=true` **仅来自 must** |
| 7 | 不支持情形 | 保留 **may/unknown**，永不升级 |
| 8 | 开关 | **默认关闭**，可显式启用 |

### 1.1 Scheme A only（冻结依据）

- R2 设计对照（`sub07_r2_abc_design_comparison.md`）推荐 A；B（单层 points-to）需叠加 A 且趋近小型
  通用引擎、C（裸名传播）跨方法跳失去 owner 帧、确定性误配风险高，二者均**不推进**。
- 禁止引入：通用 points-to、SSA、heap/heap-shape、字段敏感、跨程序 points-to（沿用
  `owner_gate_43_decision.md` §5）。

### 1.2 pthread_create 为首要支持目标

- 首要且唯一已核验的 spawn API = `pthread_create`（A1 已验证真实 THREAD_SPAWN 路径）。
- `thrd_create` 及 `_THREAD_ENTRY_ARGUMENT` 表内其他 API（CreateThread/std::thread 等）**未经事实
  核验**，不得宣称支持；不在本阶段范围内。

### 1.3 `thread_argument_decl_scoped` 为 additive 字段

- 新注解键 `thread_argument_decl_scoped` 纯增量；旧 `thread_argument_decl` / `thread_argument` /
  `thread_argument_form` 字段与公共 `StorageObject` / `scope_token` 语义**不得改变**。
- A2 已验证旧 `thread_argument_decl` 逐项字节不变（`local:fd` 等仍 frame-blind），新键独立。
- scoped identity 仅来自解析器真实声明事实：storage class + repository-relative path + enclosing
  function + declaration name + `Declaration.start_byte`；**禁止 owner+name 字符串拼接**。
- A2 已验证 token 形状：`local:<relpath>:<owner>:<name>:<byte>`、`function_static:<relpath>:<owner>:<name>:<byte>`、
  `parameter:<relpath>:<owner>:<name>:<byte>`、`global:<name>`（无函数帧，直接 `global:fd`）。

### 1.4 `sparsecfg.py` THREAD_SPAWN 局部区域为 SUB-07 owned（窄 carve-out）

- owned 区域（仅事实生产，不动判定语义）：
  - `_thread_function`（`:1320` 邻近）
  - `_call_arguments`（`:2101` 邻近）
  - `_THREAD_ENTRY_ARGUMENT`（`:2188`）及新 `_THREAD_ARGUMENT` 位置表
  - 新 `_thread_argument_facts` / `_scoped_decl_token` / `_thread_argument_form`
  - THREAD_SPAWN annotation 组装处（`:916-922` 邻近）
- `sparsecfg.py` **其余区域**（`access_kind`、WRITE/READ 发射、`escaped_to`、`alias_source`/`write_source`/
  `alias`、lock 相关）**仍为 SUB-07 forbidden**，不得改判定语义。
- 此 carve-out **不解除** `sparsecfg.py` 在 SUB-03/04/05/06 合同（§3.3/§4.3/§5.10/§5.11.4）中的
  forbidden 地位；其他 sub 仍不得触碰该文件。

### 1.5 `DEREF_RESOLVES_TO` 仅处理可证明的身份链

- 仅当：`form==address_of` ∧ 入口单参 ∧ 帧内裸拷贝链完整且唯一 ∧ 无运行时实例歧义 → **must**。
- 任一条件缺失 → 降级 may/unknown；**不得**以静态声明 token 单独证明运行时 must（递归/循环/重入/
  同声明点多实例场景）。
- `ADDRESS_PASSED_TO_THREAD` 仅承载「地址被传递」，不承载「逃逸」或「must-point-to」。
- `DEREF_RESOLVES_TO` 为 query-time 派生字段，**不写回 DFG、不新增跨方法边**。

### 1.6 `same_storage=true` 仅来自 must

- `same_storage` 三态语义已冻结（`cwe1123_v2_query_contract.md` §5.11.1）：可证明同 → true；可证明异 →
  false；不可证 → unknown（**不得视为 false，不得当作 definite**）。
- SUB-07 只**消费**已冻结的 competing_access 载体；`same_storage=true` **仅当** DEREF_RESOLVES_TO 的
  must 结论成立时才能置 true。
- 不重新实现 SUB-05 的 pair builder；不改变 `competing_access` 的排序 / top-K / hard-cap。

### 1.7 不支持情形保留 may/unknown

- `pointer_var`、opaque expression、条件重赋值、入口不可解析、声明不可解析、跨函数持锁 → 保持
  may/unknown，**永不升级 must**。
- local/parameter/function_static 在 scoped declaration identity 不可用时 → 降级 unknown。

### 1.8 默认关闭、可显式启用

- 新增 SUB-07 行为（S7-F2 消费 must 链使 FIX-05 候选非空）置于显式开关后，**默认 OFF**。
- 开关 OFF = 既有行为完全不变（FIX-05 仍 0 candidate，旧 envelope 默认行为零回退）。
- 开关 ON = 仅在可证明 must 时置 `same_storage=true` 并产出候选；不可证情形仍 may/unknown。

---

## 2. 实现拆分（Step 2）

两任务**分别提交、独立 Review**，**不允许跨阶段偷跑**：S7-F1 未 merge 不得启动 S7-F2 生产实现。

### S7-F1：A2 事实生产代码正式化

- 内容：将 A2 已验证的 `parsing/declarations.py` scoped identity + `sparsecfg.py` THREAD_SPAWN
  annotation 生产代码正式化。
- owned：
  - `src/provenlattice/parsing/declarations.py`（additive `scoped_identity` + `_Scope.function_name`）
  - `src/provenlattice/sparsecfg.py`（**仅** §1.4 THREAD_SPAWN 局部区域）
  - 新测试
- forbidden：
  - `sparsecfg.py` 其余区域
  - `concurrency_*` 全部；`defect.py` / `defect_query.py` / `evidence.py` / `analysis_concurrency_context.py`
  - `sparsedfg.py`（不新增 DFG 边）
  - storage/schema、CLI/MCP、policy、AGENTS、版本与发布文件
- 验收：字段兼容性回归（旧 `thread_argument_decl` 字节不变）+ 作用域身份回归（6 碰撞用例 scoped 身份
  可区分，沿用 A2 harness）+ 相关 concurrency/sparsecfg 回归全绿。

### S7-F2：受限 query-time 消费

- 内容：受限 query-time `DEREF_RESOLVES_TO` 派生 + `same_storage=true`（仅 must）接线 + FIX-05 完整
  候选链 + unknown/may 防误配。
- owned：新 query-time 派生/消费模块（DEREF_RESOLVES_TO 组装：S7-F1 annotation + 现有
  `alias_source`/`alias`）+ 新测试。
- forbidden：
  - `sparsecfg.py`（F2 只读 F1 产出，不再改生产侧）
  - `sparsedfg.py`（不新增 DFG 边）
  - `concurrency_race_scenarios.py`（SUB-05 owned，不重实现 competing_access）
  - `defect.py` / `evidence.py` / `defect_query.py`
  - 不新增通用 points-to / SSA / heap / 字段敏感 / 跨程序引擎
- 验收：FIX-05 完整候选链（`fd → &fd → p → f → *f` 同 storage → WRITE/READ pair 候选非空）；不同对象
  控制例不误配；指针变量/间接入口/分支重赋值 → may/unknown 不误判 must；开关 OFF 下 FIX-05 仍 0 candidate。

---

## 3. 合并门（Step 3）

任一任务进入 merge 前，**必须全部满足**：

1. **真实语料 FP/FN 对照**：补齐 R3 缺失的 `REAL_CORPUS_FP_FN`（不得只以 10/10 合成样本代替代替真实语料）。
2. **性能实测**：补齐 `PERF_OVERHEAD`（声明索引 + 回溯链增量成本，需 benchmark/profiling，非定性推演）。
3. **开关回退测试**：开关 OFF = 旧行为零回退；开关 ON 增量正确。
4. **全量 CI**：linux-jdt-verify / test-linux / test-windows 全绿。
5. **独立 Reviewer**：未参与实现的 Agent 或人独立 LGTM（Worker 自评 ≠ LGTM）。
6. **不改变旧 envelope 默认行为**：`candidates` / `evidence_bundles` / `competing_access` 数量、顺序、
   字段、确定性零回退；默认开关下输出字节稳定。

---

## 4. 明确禁止（沿用 `owner_gate_43_decision.md` §5）

- 通用 points-to 引擎；SSA；heap/heap-shape analysis。
- 用 owner/name 字符串拼接制造声明身份。
- 把研究 spike 结果写成正式实现授权。
- **默认启用、生产合并**（本 gate 仅授权受限功能实现，不授权合并）。
- 解锁 #44–#47。

---

## 5. Issue 治理与审计链（Step 4）

- #43 保持 `type:research`，**不改成** `type:feature` / `status:approved`。
- 采用**明确阶段授权**（沿用 `owner_gate_43_decision.md` 先例）保持研究/特征审计链：以本文件 + #43
  Issue 评论表达「研究完成 + 受限功能实现授权 + 合并门」的阶段边界。
- S7-F1 / S7-F2 的 Worker 启动为**后续单独动作**，本治理任务不启动 Worker。
- 下游：`DOWNSTREAM_SUBS_UNLOCKED = NO`；#44/#45/#47 保持 `blocked`，不随本授权自动解锁。

---

## 6. 最终裁决块

```text
SUB07_FORMAL_IMPLEMENTATION_AUTHORIZED = YES
SUB07_DEFAULT_ENABLED                 = NO
SUB07_MERGE_AUTHORIZED                = NO
S7_F1_READY                           = YES
S7_F2_READY                           = YES
DOWNSTREAM_SUBS_UNLOCKED              = NO
NEXT_ACTION                           = WAIT_FOR_S7_F1_KICKOFF（Owner 触发，非本治理任务）
```
