# FE8-F1 (#51 / PR #54) — §8 Merge-Gate Evidence

**Task**: `PL-FE8-F1-PR54-MERGE-GATE-EVIDENCE-V1`
**Role**: Worker（补齐 §8 第 1、2 项证据并复核 3–6 项，不 Merge / Close / 改 PR HEAD）
**Date**: 2026-11-04
**PR**: https://github.com/sunSUNQ/provenlattice/pull/54
**Frozen HEAD**: `4194d529aa3a5acf4d95744cc25bd39e40e95f3e`（未改动）
**Base**: `de006ef`（origin/main）
**Contract**: `fe8_formal_feature_contract.md` §8（FROZEN，同 #43 §3）

---

## 0. 结论

```text
EVIDENCE_STATUS                 = EVIDENCE_SUBMITTED
MERGE_GATE_ITEM_1_REAL_FP_FN    = PRODUCED   (7 真实文件 / 0 annotation / 0 FP / FN=0 vacuously；正反例由 21 golden tests 锁定)
MERGE_GATE_ITEM_2_PERF_OVERHEAD = PRODUCED   (decode ~2.7ms 单文件；ast:c 端到端 +0.46ms ≈ 0.1%，落在噪声内)
MERGE_GATE_ITEM_3_OFF_SWITCH    = PASS       (无运行时开关；无 pragma 文件 0 annotation 字节稳定，test_default_off_old_envelope_unchanged 锁定)
MERGE_GATE_ITEM_4_FULL_CI       = PASS       (3 job SUCCESS + 本地 787 passed)
MERGE_GATE_ITEM_5_INDEP_REVIEW  = PASS       (pl-owner-reviewer LGTM @ 4194d529，未撤销)
MERGE_GATE_ITEM_6_ENVELOPE      = PASS       (+735/−7 全 additive + 2 版本 bump 使旧 cache 自动 stale；旧字段字节稳定)
FE8F1_MERGE_AUTHORIZED          = NO         (Merge 仍由 Owner 裁决)
REVIEW_ACCEPTED / MERGE_GATED / EVIDENCE_SUBMITTED = YES
```

> 本任务只补齐 §8 第 1、2 项并复核 3–6 项，**不** revoke 独立 LGTM，**不**改 PR
> HEAD / 正式实现 / 冻结合同 / 评测标准，**不** Merge / Close。

---

## 1. 改动范围（核验）

PR #54 diff（base `de006ef` → HEAD `4194d529`）：**8 文件，+735 / −7**，全 additive，
无运行时开关、无 schema 变更、无 DFG 边、无候选层改动：

```
M src/provenlattice/analysis.py              (版本 bump：ast:c 3→4, sparse_cfg:cpp 1→2)
M src/provenlattice/analysis_c_frontend.py   (+100  decode_scenario_pragmas + ScenarioPragma)
M src/provenlattice/analysis_c_ast.py        (+193  scenario_annotation_id + _pair_scenario_annotations + SCENARIO_ANNOTATION 物化)
M src/provenlattice/analysis_c_scfg.py       (+1    point 载荷发布 start_byte/end_byte)
M src/provenlattice/models.py                (+5    ParsedPoint.start_byte/end_byte，可选 None)
M src/provenlattice/sparsecfg.py             (+13   walker point additive byte span)
M tests/test_c_singleline_for_cfg.py         (+1/−2 既有硬编码 "c-ast-v3" 断言改为 C_AST_CONTRACT)
A tests/test_fe8_scenario_annotations.py     (+423  21 个 golden tests)
```

无 `sparsedfg.py` / `concurrency_*` / `defect.py` / `evidence.py` / `defect_query.py`
改动；无物理图 edge；无 SQL schema 变更；无 #46 三字段语义改动。`test_c_singleline_for_cfg.py`
的 3 行改动是版本 bump 后既有断言的**失效修复**（`c-ast-v3` → `C_AST_CONTRACT`），非行为变更。

---

## 2. §8.1 REAL_CORPUS_FP_FN

### 2.1 语料（provenance）

语料为**真实开源生产源码**，逐文件含许可证头，非合成 fixture、非本任务编写。与 #48 同一
套 7 个 SHA-1 钉扎文件（下载镜像 jsDelivr，内容与 GitHub 原始文件逐字节一致）：

| # | 文件 | 来源（tag） | 许可证 | SHA-1 |
|---|---|---|---|---|
| 1 | `redis__bio.c` | redis/redis@7.0.0/src/bio.c | BSD-3-Clause | `9B0BADDB0A2F64183F25F334C760725113CEB896` |
| 2 | `redis__networking.c` | redis/redis@7.0.0/src/networking.c | BSD-3-Clause | `558B6A918D45E4965A67EEBC1D4D3944777D29E4` |
| 3 | `curl__threaded-ssl.c` | curl/curl@curl-8_9_1/docs/examples/threaded-ssl.c | curl | `14825E12DF96A7046FFE7ECDFDE2798174D25B63` |
| 4 | `memcached__thread.c` | memcached/memcached@1.6.24/thread.c | BSD-3-Clause | `741124B194860467C576A5A58CF8AF87142CEDD1` |
| 5 | `ffmpeg__pthread_frame.c` | FFmpeg/FFmpeg@n6.1/libavcodec/pthread_frame.c | LGPL-2.1+ | `934D6967DC145A144A461FE6E9E9C4080A4CF506` |
| 6 | `iperf3__iperf_client_api.c` | esnet/iperf@3.16/src/iperf_client_api.c | BSD-3-Clause | `2D2C0641C2AC43F8FFF951E1E775CCAD594FC965` |
| 7 | `libuv__test-thread.c` | libuv/libuv@v1.48.0/test/test-thread.c | MIT | `ACD82FEF17065EC94DBB0DBB6F6294A0821B7B42` |

### 2.2 FE8-F1 的 FP/FN 面

FE8-F1 是**事实生产**步骤：产出 `scenario_annotations[]`（物化为 `ast:c` v4 下 FILE 根的
`SCENARIO_ANNOTATION` 叶子节点）+ walker `start_byte`/`end_byte`。消费（
`scenario_access_relations[]` / `function_scenario_groups[]`）是 FE8-F2（#52），**blocked，
尚不存在**。因此该步骤的 FP/FN 面只有两个：

- **FP** = 假阳性 annotation：在不存在精确 `#pragma provenlattice scenario <id> begin|end`
  对的地方产出任何 annotation。真实生产 C 代码**不含该 pragma**，解码器必须保持沉默。
- **FN** = 漏检 annotation：存在合法 pragma 对但解码器未产出。真实语料**不含**该 pragma，
  故 FN 面在真实语料上**结构性为空**；正反例形状由 21 个 golden tests 锁定。

### 2.3 方法

1. 对每个语料文件在隔离临时仓库 `src/<file>` 下跑真实管线：
   `full_index → analyze_c_ast_scope`（触发 `decode_scenario_pragmas` + 物化），
   再读 `ast:c` feature 表里全部 `SCENARIO_ANNOTATION` 节点。
2. 再跑 `analyze_scope(sparse_cfg)`，断言每个 walker event 都发布 `start_byte`/`end_byte`
   （additive byte span 不回归、不缺失）。
3. 记录每个文件的 tree-sitter parse 覆盖（error/missing/coverage），以证明「若存在 pragma，
   它落在正确解析区、可被解码；即便落在 ERROR 区也只保守降级，绝不静默丢弃」。

### 2.4 实测结果（PR HEAD）

| 文件 | parse errors | parse coverage | annotations | walker events | byte-span 缺失 |
|---|---|---|---|---|---|
| curl__threaded-ssl.c | 0 | 1.000000 | 0 | 36 | 0 |
| ffmpeg__pthread_frame.c | 18 | 0.997271 | 0 | 1064 | 0 |
| iperf3__iperf_client_api.c | 0 | 1.000000 | 0 | 755 | 0 |
| libuv__test-thread.c | 2 | 0.998517 | 0 | 181 | 0 |
| memcached__thread.c | 1 | 0.999625 | 0 | 873 | 0 |
| redis__bio.c | 1 | 0.999915 | 0 | 220 | 0 |
| redis__networking.c | 1 | 0.999994 | 0 | 4006 | 0 |
| **合计** | — | — | **0** | **7135** | **0** |

parse coverage 全部 ≥ 0.997（>99.7% 字节落在正确解析区）。ffmpeg/libuv/memcached/redis 的
少量 error 节点来自「单文件隔离仓库缺失其 `#include` 头」的语法恢复，属真实语料噪声，不
在本 feature 面内，也不影响结论（见 §5 限制 1）。

### 2.5 FP / FN 判定

| 指标 | 数值 | 依据 |
|---|---|---|
| **FP**（假阳性 annotation） | **0** | 7 个真实文件、7135 个 walker event，`decode_scenario_pragmas` 产出 **0** 个 `SCENARIO_ANNOTATION` |
| **FN**（漏检本可产出的 annotation） | **0（vacuous）** | 真实语料不包含 `#pragma provenlattice scenario`，无 ground-truth 正例可漏 |
| 正例覆盖（非真人语料可达） | 21 golden tests | P1/P2/P4/P5 正例 + N1–N4 反例 + U1/U2/U3/U6 limitation，锁定产出/沉默/降级三态 |
| walker byte span | **7135/7135 具备** | 全部 event 发布 `start_byte`/`end_byte`，0 缺失 |

**核心结论（非 N/A，是实测）**：在真实生产 C 语料上，FE8-F1 的解码器产生 **0 个假阳性
annotation**，这正是 §1 语法冻结的苛刻白名单（exact token 匹配 `provenlattice scenario
<id> begin|end`、`<id>` `fullmatch [A-Za-z_][A-Za-z0-9_.-]*`）的预期行为——真实代码中的
`#pragma`、普通 comment、`// TODO`、`/* GT marker */`、GCC attribute 等一律正确沉默。
正例与反例（真实代码里不存在 `provenlattice` pragma，故无法从真实语料获取）由合成 golden
fixture 表达——这与「§8.1 不得只以合成 fixture 代替真实语料」不冲突：真实语料负责 FP 面，
合成 fixture 负责正反例形状面，两者互补。

---

## 3. §8.2 PERF_OVERHEAD（实测）

度量对象：FE8-F1 增量成本 = `decode_scenario_pragmas`（每 C 文件一次 O(N) 树遍历）+
`_pair_scenario_annotations`（无 marker 时 O(0)）+ walker byte span（把已计算的字节偏移
复制进点载荷）。压力样本：最大真实文件 `redis__networking.c`（4006 events / ~25k AST 节点）。

可复现命令：`python fe8f1_perf.py <corpus_dir>`（20 次重复，fresh DB 每次强制重新物化）。

### 3.1 `analyze_c_ast_scope` 端到端（baseline vs PR，20 次重复）

| 分支 | p50 (ms) | mean (ms) | min (ms) | p95 (ms) | max (ms) |
|---|---|---|---|---|---|
| baseline `de006ef` | 433.02 | 433.42 | 413.63 | 445.54 | 446.40 |
| PR `4194d529` | 433.48 | 433.80 | 424.70 | 438.94 | 441.64 |
| **增量** | **+0.46** | +0.38 | — | — | — |

- 端到端增量 **+0.46 ms ≈ +0.11%**，落在 20 次重复的测量噪声内（spread ±~15 ms）。

### 3.2 `decode_scenario_pragmas` 隔离（PR，40 次重复）

| 路径 | min | p50 | p95 | max | mean |
|---|---|---|---|---|---|
| decode_scenario_pragmas (ms) | 2.64 | **2.71** | 3.00 | 3.19 | 2.76 |

- 这是该 feature 唯一的新增「每文件必付」成本：一次 O(N) 树遍历 + preproc 排序，
  在最大文件上 ~**2.7 ms**，占该文件完整 `ast:c` 物化（~433 ms）的 **~0.6%**。
  端到端 delta 之所以小于隔离值，是因为 baseline 的 `analyze_c_ast_scope` 本身已做一次
  全树 `_normalize` 遍历 + DB 写入（占绝对大头），第二次遍历的边际成本被基线噪声淹没。

### 3.3 `analyze_scope(sparse_cfg)` 端到端（baseline vs PR，20 次重复）

| 分支 | p50 (ms) | mean (ms) |
|---|---|---|
| baseline `de006ef` | 369.15 | 369.93 |
| PR `4194d529` | 366.92 | 367.38 |
| **增量** | **−2.23** | −2.55 |

- walker byte span 是「把 tree-sitter 节点里**已计算**的 `start_byte`/`end_byte` 复制进
  点载荷」的纯 additive 字段，无可测开销（实测 delta 为负，纯噪声）。

### 3.4 结论

FE8-F1 增量成本 = 每个 C 文件一次 O(N) 解码遍历（最大文件 ~2.7 ms，~0.6% of 物化），
+ 可忽略的物化分支（无 pragma 时 O(0)）+ 零成本 byte span 复制。复杂度 O(N)（N=AST 节点数），
无二次排序（`_pair_scenario_annotations` 只在有 marker 时运行）、无 per-pair 爆炸。
满足「非定性推演、需 profiling」要求。

环境：Python 3.12.10 / tree_sitter 0.26.0 / Windows 11 x64；baseline worktree
`D:\tasco-temp\issue-pilot\worktrees\provenlattice-46`（`de006ef`），PR worktree
`D:\tasco-temp\issue-pilot\worktrees\provenlattice-51`（`4194d529`）。

---

## 4. §8.3–8.6 复核（仍有效）

- **§8.3 开关回退**：FE8-F1 **无运行时开关**；「OFF」= 无 pragma 文件不产出任何
  `SCENARIO_ANNOTATION` 节点，旧 AST 节点集逐字节不变（由
  `test_fe8_scenario_annotations.py::test_default_off_old_envelope_unchanged` 锁定）。
  walker `start_line`/`end_line` 保留，`start_byte`/`end_byte` 为新增键，无载荷回归。
- **§8.4 全量 CI**：PR #54 `statusCheckRollup` 三 job 全 `SUCCESS`
  （`linux-jdt-verify` / `test-linux` / `test-windows`，run `41790235213`）；
  本地 `python -m unittest discover -s tests` = **787 passed (OK)**（原 766 + 21 新增）。
- **§8.5 独立 Reviewer**：`pl-owner-reviewer[bot]` 独立 LGTM（审 `4194d529`，非实现 Worker、
  非 Owner），记录于 #51 评论，**未撤销**。审后无新实现改动（本任务只补证据，不改 HEAD），
  故 LGTM 仍对当前 HEAD `4194d529` 有效。
- **§8.6 旧 envelope 默认稳定**：PR 全 additive（+735/−7）；唯一删除/改写是版本 bump
  后的既有测试断言（`c-ast-v3` → `C_AST_CONTRACT`）。无 pragma 文件旧 AST 节点集字节稳定
  （§8.3 测试锁定）+ 版本 bump 使旧 cache 自动 stale（`ast:c` 3→4、`sparse_cfg:cpp` 1→2）。

---

## 5. 发现与限制（如实记录，非回归）

1. **单文件隔离仓库的 parse error 节点**：ffmpeg（18）/libuv（2）/memcached（1）/
   redis bio（1）/redis networking（1）的 error 节点来自缺失 `#include` 头的语法恢复，
   与树-sitter C 的错误恢复路径相关。这些 ERROR 节点不覆盖任何 pragma（文件本无 pragma）。
   即便未来某个文件存在「pragma 落在 ERROR/missing 覆盖区」的情形，解码器会把该 marker
   标记 `is_error` → 产出 `parse_status=unknown` + `annotation_parse_partial`（§5 保守
   降级），**绝不静默丢弃、绝不产出假阳性**。该路径已由
   `test_fe8_scenario_annotations.py::U6` 锁定。
2. **FN 面的结构性空缺是契约设计所致，非证据缺口**：§8.1 要求「不得只以合成 fixture 代替
   真实语料」，但真实生产 C 代码不存在 `provenlattice scenario` pragma（该语法正是本 feature
   引入的私有标注），故「真实语料上的 FN」无 ground-truth 可言。真实语料承担 FP 面（0 FP 实测），
   正反例形状面由 21 个 golden tests 承担。这与 #48（S7-F2，真实语料存在 spawn/deref 故能测
   must/may）不同，与 #49（S7-F1，additive 事实生产）同构。
3. **版本 bump 使 `sparse_cfg:cpp` 1→2 是必要的 cache 失效，非 scope creep**：walker byte
   span 改变了 C sparse CFG 的输出载荷，旧 `sparse_cfg:cpp` v1 cache 必须 stale。已由
   `test_fe8_scenario_annotations.py::test_ast_contract_and_sparse_cfg_version_bumped` 锁定，
   独立 Reviewer 亦确认此为必要而非越权。

---

## 6. STOP 声明

- 未 Merge / Close #51 或 PR #54；未改 PR HEAD `4194d529`；未改正式实现、冻结合同、评测
  标准；未 revoke 独立 LGTM；未把 FP/FN 判为 N/A（实测 0 FP + vacuous FN + golden 正反例）；
  未因测试失败放宽验收。
- 未修改任何产品代码；语料/脚本/原始数据仅写入 `D:\tasco-temp\issue-pilot\`。
- 完成后 STOP，等待独立 Reviewer 复核 §8.1/§8.2 与 Owner 最终 Merge 裁决。

---

## 7. 可复现命令

```text
# 环境（PR HEAD worktree）
$env:PYTHONPATH = "D:\tasco-temp\issue-pilot\worktrees\provenlattice-51\src"

# FP/FN 全量原始数据（real-corpus，7 文件）
python D:\tasco-temp\issue-pilot\fe8f1-corpus\fe8f1_fpfn.py ^
       D:\tasco-temp\issue-pilot\fe8f1-corpus D:\tasco-temp\issue-pilot\fe8f1-evidence

# PERF_OVERHEAD（baseline 用 provenlattice-46 worktree，PR 用 provenlattice-51 worktree）
python D:\tasco-temp\issue-pilot\fe8f1-corpus\fe8f1_perf.py ^
       D:\tasco-temp\issue-pilot\fe8f1-corpus D:\tasco-temp\issue-pilot\fe8f1-evidence

# 全量测试（CI 配方）
python -m unittest discover -s tests
```

## 8. 交付物索引

- `D:\tasco-temp\issue-pilot\fe8f1-corpus\` — 7 语料源文件（SHA-1 同 #48）+ `fe8f1_fpfn.py` + `fe8f1_perf.py`
- `D:\tasco-temp\issue-pilot\fe8f1-evidence\` — 每文件原始 JSON + `summary.csv` + `perf_baseline.json` + `perf_pr.json`
- 本文件（控制仓库 `sub51_fe8f1_merge_gate_evidence.md`）