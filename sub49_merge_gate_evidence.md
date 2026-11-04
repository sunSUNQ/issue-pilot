# S7-F1 (#49) — §3 合并门证据汇总

**PR**: provenlattice#51 · head `1d173d95d1e789c8003d4a438da1027a4901ff53`
**基线**: `7647ade`（origin/main）
**日期**: 2026-11-04

## 改动范围（核验）

3 文件，全 additive，无运行时开关、无 schema 变更、无 DFG 边：

```
M src/provenlattice/parsing/declarations.py  (+66)
M src/provenlattice/sparsecfg.py             (+102)  ← 仅 THREAD_SPAWN 局部区域
A tests/test_thread_argument_scoped.py       (+250 新增测试)
```

## §3 六项逐一核验

| # | 门槛 | 结论 | 证据 |
|---|---|---|---|
| 1 | 真实语料 FP/FN 对照 | **结构性不适用**（见下） | 无独立 C 语料；S7-F1 为 additive 事实生产 |
| 2 | 性能实测 | ✅ **已实测** | 300 spawns，增量 ~0.3ms，落在噪声内 |
| 3 | 开关回退测试 | ✅ 绿 | 无运行时开关；「OFF」= additive 非消费字段；字节稳定由测试钉死 |
| 4 | 全量 CI | ✅ 绿 | linux-jdt-verify / test-linux / test-windows 3/3 pass |
| 5 | 独立 Reviewer | ✅ 绿 | pl-owner-reviewer（非实现者）LGTM @ 1d173d9 |
| 6 | envelope 默认行为不变 | ✅ 绿 | 709 测试回归绿 + 旧字段字节稳定 |

## 性能实测（§3 item 2）

benchmark：`sub49_perf_bench.py`，合成 C 文件 N 个 `pthread_create` spawn，跑真实
pipeline（`full_index` → `analyze_scope(sparse_cfg)` → `query_analysis`），对比基线 vs PR。

| 分支 | total（3 次） | 中位 |
|---|---|---|
| 基线 `7647ade` | 0.2523 / 0.2717 / 0.2479s | ~0.252s |
| PR `1d173d9` | 0.2721 / 0.2486 / 0.2526s | ~0.253s |

**结论**：300 spawns 下增量 ≈ 0.3ms，远小于运行噪声（±10ms）。`scoped_identity`
是每个 THREAD_SPAWN 一次常数时间的字符串拼接 + 字典查询，无任何可测开销。满足
「非定性推演、需 benchmark」的要求。

## 真实语料 FP/FN 对照（§3 item 1）—— 诚实论证

**结论：对 S7-F1 结构性不适用，需 Owner 显式裁决（接受结构性论证 或 给予 S7-F1
additive 步骤的显式豁免）。**

理由：

1. **FP/FN 是消费属性，不是生产属性。** FP = 误报竞争对，FN = 漏报竞争对。两者都由
   `concurrency_*` / `defect_query` 的判定路径产生。S7-F1 只 ADD 一个新注解字段
   `thread_argument_decl_scoped`，不触碰任何判定/排序/候选路径。
2. **新字段无人消费。** 消费（`DEREF_RESOLVES_TO` / `same_storage`）是 S7-F2，被
   `blocked` gate 锁住，本 PR 不含任何消费代码。一个不被消费的字段不可能改变 FP/FN。
3. **旧字段字节稳定。** `thread_argument_decl` 逐字节不变（A1 拼写），由
   `test_thread_argument_scoped.py` 断言钉死；`thread_argument` / `thread_argument_form` 同理。
4. **仓库无独立真实 C 语料。** 全仓库唯一 `.c` 是 `tests/fixture_cpp/src/{callbacks,plain}.c`
   及测试内联 fixture；`benchmarks/` 是 Python harness，`evidence/` 是 Java 语料
   （gson/hikaricp/jgit）。不存在可跑 FP/FN 的 C 语料。
5. **S7-F1 的正确「语料级」证据 = 碰撞区分套件 + 字节稳定 + 全量回归。** 6 碰撞用例 → 12
   THREAD_SPAWN，scoped 身份全部可区分（同函数同名 shadowing 由 byte 区分），709 测试回归绿。

**FP/FN 的真实风险属于 S7-F2（消费步骤）。** S7-F2 的 `same_storage=true`（仅 must）将由
冻结的 `cwe1123_v2_query_contract.md` §5.11 三态约束，并在 S7-F2 合并门单独要求真实语料
FP/FN。把 FP/FN 门槛前置到 S7-F1 是类别错配。

## 建议 Owner 裁决项

合并是 Owner 独占动作（§4：本 gate 仅授权受限功能实现，不授权合并）。请 Owner 对 §3
item 1 做二选一：

- **A**：接受「S7-F1 为 additive 事实生产、FP/FN 结构性不适用、真实 FP/FN 由 S7-F2
  消费门承接」的结构性论证，视为 §3 item 1 对 S7-F1 已满足；则六项全绿，可放行 merge。
- **B**：要求显式豁免文书（scope 限定 S7-F1 additive 步骤）后放行 merge。

（其余 §3 item 2-6 已由本证据 + CI + 独立 Reviewer 满足。）
