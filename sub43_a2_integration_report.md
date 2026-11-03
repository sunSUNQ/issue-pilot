# SUB-07 / #43 — Gate A2 集成验证报告（spike-only）

**Task**: `PL-SUB07-GATE-A2-INTEGRATION-V1`
**角色**: Master Agent（执行 Owner 放行的 A2 隔离验证 spike；不批准正式实现）
**基线**: provenlattice `main` = `4a7ff06`（含 SUB-01/02/04/05/06 merge）
**Worktree**: `D:\tasco-temp\issue-pilot\worktrees\provenlattice-43-a2`，branch
`issue-pilot/43-provenlattice-sub-alias-storage-a2-spike`（隔离，非生产）

## 0. 总判定

```text
A2_PORT_APPLIED                    = YES（A1+A1B → 4a7ff06，cherry-pick auto-merge，0 冲突）
A2_INTEGRATION_VALIDATED           = YES（6 碰撞用例 → 12 个 THREAD_SPAWN，scoped 身份全部可区分）
A2_UNKNOWN_DEGRADATION             = YES（不可解析 → ""，pointer_var/deref/opaque → may/unknown）
A2_REGRESSION                      = 148/148 PASS（相关 concurrency/sparsecfg/evidence/mechanism/trace）
A2_PERF_OBSERVED                   = QUALITATIVE（未 benchmark；仅 THREAD_SPAWN+pthread_create 触发，可回退）
A2_ROLLBACK_AVAILABLE              = YES（纯 additive；丢弃 worktree 即完全回退；未生产合并）
SUB07_FORMAL_IMPLEMENTATION_AUTHORIZED = NO
SUB07_DEFAULT_ENABLE_AUTHORIZED        = NO
SUB07_PRODUCTION_MERGE_AUTHORIZED      = NO
```

## 1. Port（A1+A1B → 当前 main）

- 源：A1 worktree `provenlattice-sub07-a1` 的 `953811d`（`declarations.py` +66/−1、
  `sparsecfg.py` +102）。
- 目标：`4a7ff06`（当前 main）。`cherry-pick` **auto-merge 成功，0 冲突**（SUB-02 的
  `access_kind/is_write` 与 A1B 的 thread-argument 注解落在 `sparsecfg.py` 不同区域）。
- 落地 commit：`d7bd38b`（A2 worktree 本地，**未 push、未 PR、未 merge**）。

## 2. 集成验证（正反例，可复验）

Harness：`_a1b_verify/sub43_a2_integration_probe.py`（真实管道 `full_index →
analyze_scope → query_analysis`），输出 `sub43_a2_integration_raw.json`（12 行）。

| 用例 | 旧 `thread_argument_decl`（frame-blind） | 新 `thread_argument_decl_scoped` | 判定 |
|---|---|---|---|
| 不同函数同名 local | `local:fd` / `local:fd`（**碰撞**） | `local:src/a.c:main:fd:42` ≠ `local:src/a.c:helper:fd:131` | 可区分 |
| 同函数遮蔽 local | `local:fd` / `local:fd`（**碰撞**） | `local:src/a.c:f:fd:64` ≠ `local:src/a.c:f:fd:117`（byte 区分） | 可区分 |
| global/local 同名 | `local:fd` / `global:fd`（storage 前缀已分） | `local:src/a.c:main:fd:133` ≠ `global:fd` | 可区分 |
| 不同函数 function_static | `function_static:cache`（**碰撞**） | `function_static:src/a.c:spawn_w:cache:42` ≠ `...:spawn_c:cache:135` | 可区分 |
| 不同函数 parameter | `parameter:fd`（**碰撞**） | `parameter:src/a.c:f:fd:28` ≠ `parameter:src/a.c:g:fd:98` | 可区分 |
| struct 不同成员 | `global:s.a` / `global:s.b`（已分） | `global:s.a` ≠ `global:s.b` | 可区分 |

关键：旧 `thread_argument_decl` **逐项字节不变**（仍 `local:fd` 等），新键纯增量 →
证明未破坏既有字段语义（与 A1B 第 8 项一致）。

## 3. must / may / unknown 降级

- `thread_argument_form`：`address_of`（must-eligible）/ `pointer_var` / `deref` /
  `opaque` / `empty`。本次用例均为 `address_of`。
- `pointer_var`/`deref`/`opaque` 永不升级 must（`_thread_argument_form` 按语法分流）。
- 不可解析声明 → `thread_argument_decl_scoped = ""`（`_scoped_decl_token` 对 `_resolve`/
  `_resolve_member` 返回 None 时返回空，绝不猜测）——见 A1B 第 7 项先验证据。
- 静态声明 token 只证明「声明点身份」，递归/循环/重入下**不**证明运行时 must-alias
  （A1B §4 结论，消费端必须遵守）。

## 4. 既有行为回归

`PYTHONPATH=<A2>/src;<venv>/site-packages python -m pytest`：

- `tests/test_concurrency_context.py` + `tests/test_sparse_cfg_i1b.py` = 23/23 PASS。
- 追加 `test_concurrency_{access_kind,access_lockset,access_semantics,lock_scenarios,
  lock_semantics,profile,race_scenarios}` + `test_evidence` + `test_mechanism_facts` +
  `test_trace_chain_t01` = 125/125 PASS。
- 合计 **148/148 PASS**，无新增失败。

## 5. 性能观察（诚实，未 benchmark）

- 新注解在 `event_type == "THREAD_SPAWN"` 且 `matched_name == "pthread_create"` 时才计算，
  属低频路径；声明索引 `scoped_identity` 为常数时间查表 + 反查 innermost frame。
- 未运行 benchmark / profiling，**不做数量化性能宣称**。aditive 注解缺失不影响既有判定
  （可回退）。

## 6. 回退说明

- 改动为**纯 additive**：新增 `_Scope.function_name`（私有）、`scoped_identity`（新公共方法）、
  `_thread_argument_facts` / `_scoped_decl_token` / `_thread_argument_form`（新私有方法）、
  `thread_argument_decl_scoped`（新注解键）。未改 `scope_token` / `StorageObject` /
  `concurrency_*` / `defect.py` / `evidence.py`。
- 生产零影响：本能力只在 A2 隔离 worktree，未 push / 未 PR / 未 merge。
- 回退 = 丢弃 worktree（`git worktree remove`）+ 删除 branch，即完全还原。

## 7. STOP 声明

- 未创建功能 PR、未默认启用、未生产合并。
- 未解除 #44–#47 的功能开发依赖。
- #43 保持 `type:research`；正式实现、默认启用、生产合并均仍待 **Human Owner 单独决策**。

```text
SUB07_A2_COMPLETE = true
SUB07_A2_STARTED  = true
SUB07_READY_FOR_FORMAL_IMPLEMENTATION_GATE = true
```