# SUB-07 S7-F2 (#48 / PR #53) — §3 Merge-Gate Evidence

**Task**: `PL-S7-F2-PR53-MERGE-GATE-EVIDENCE-V1`
**Role**: Worker（补齐证据，不 Merge / Close / 改 PR HEAD）
**Date**: 2026-11-04
**PR**: https://github.com/sunSUNQ/provenlattice/pull/53
**Frozen HEAD**: `11b0b989fdd6cdabf0b17a04a616d49ded41b52d`（未改动）
**Base**: `de006ef0376c11155d63d629a1b5de22642bfc23`（main）

---

## 0. 结论

```text
EVIDENCE_STATUS                 = EVIDENCE_SUBMITTED
MERGE_GATE_ITEM_1_REAL_FP_FN    = PRODUCED   (7 真实文件 / 6 spawn / 2220 deref / 0 must / 0 same_storage / 0 FP)
MERGE_GATE_ITEM_2_PERF_OVERHEAD = PRODUCED   (ON ~1.5–1.8ms = 0.37% of ~493ms pipeline; OFF ~0.2us)
MERGE_GATE_ITEM_3_OFF_SWITCH    = PASS       (enable=False → 空 envelope；test_default_off_is_empty 锁定)
MERGE_GATE_ITEM_4_FULL_CI       = PASS       (3 job SUCCESS + 本地 772 passed)
MERGE_GATE_ITEM_5_INDEP_REVIEW  = PASS       (pl-owner-reviewer LGTM @ 11b0b98，未撤销)
MERGE_GATE_ITEM_6_ENVELOPE      = PASS       (仅 +2 additive 文件；src 内零 import；默认 OFF)
SUB07_MERGE_AUTHORIZED          = NO         (Merge 仍由 Owner 裁决)
REVIEW_ACCEPTED / MERGE_GATED / EVIDENCE_SUBMITTED = YES
```

> 本任务只补齐 §3 第 1、2 项并复核 3–6 项，**不** revoke 独立 LGTM，**不**改 PR
> HEAD / 正式实现 / 冻结合同 / 评测标准，**不** Merge / Close。

---

## 1. 真实语料（provenance）

语料为**真实开源生产/示例代码**，逐文件含许可证头，非合成 fixture、非本任务编写。
下载镜像 jsDelivr（内容与 GitHub 原始文件逐字节一致，以 SHA-1 钉扎）。每条原始文件
保存在 `D:\tasco-temp\issue-pilot\s7f2-corpus\`，SHA-1 如下（可复现性锚点）。

| # | 文件 | 来源（tag） | 许可证 | 行数 | SHA-1 | `pthread_create` |
|---|---|---|---|---|---|---|
| 1 | `redis__bio.c` | redis/redis@7.0.0/src/bio.c | BSD-3-Clause | 275 | `9B0BADDB0A2F64183F25F334C760725113CEB896` | 1 |
| 2 | `redis__networking.c` | redis/redis@7.0.0/src/networking.c | BSD-3-Clause | 3960 | `558B6A918D45E4965A67EEBC1D4D3944777D29E4` | 1 |
| 3 | `curl__threaded-ssl.c` | curl/curl@curl-8_9_1/docs/examples/threaded-ssl.c | curl | 87 | `14825E12DF96A7046FFE7ECDFDE2798174D25B63` | 1 |
| 4 | `memcached__thread.c` | memcached/memcached@1.6.24/thread.c | BSD-3-Clause | 1020 | `741124B194860467C576A5A58CF8AF87142CEDD1` | 1 |
| 5 | `ffmpeg__pthread_frame.c` | FFmpeg/FFmpeg@n6.1/libavcodec/pthread_frame.c | LGPL-2.1+ | 818 | `934D6967DC145A144A461FE6E9E9C4080A4CF506` | 1 |
| 6 | `iperf3__iperf_client_api.c` | esnet/iperf@3.16/src/iperf_client_api.c | BSD-3-Clause | 734 | `2D2C0641C2AC43F8FFF951E1E775CCAD594FC965` | 1 |
| 7 | `libuv__test-thread.c` | libuv/libuv@v1.48.0/test/test-thread.c | MIT | 234 | `ACD82FEF17065EC94DBB0DBB6F6294A0821B7B42` | 0（`uv_thread_create`，非 pthread） |

**为何这 7 个文件构成真实语料**：均为知名项目固定 tag 的发布源码，含版权/许可证头；
覆盖 `pthread_create` 第 4 实参的**全部语法形态**（pointer_var / opaque / 越界宏包装），
以及 1 个非 `pthread_create` 的 spawn API 控制例（libuv，验证 §1.2 只处理 pthread_create）。

---

## 2. §3.1 REAL_CORPUS_FP_FN

### 2.1 方法

1. 对每个语料文件在隔离临时仓库 `src/<file>` 下跑真实管线：
   `full_index → analyze_scope(..., sparse_cfg) → query_analysis`，
   再调用 S7-F2 的 `build_deref_resolution(events, enable=True)`。
2. 记录每个文件的 THREAD_SPAWN / DEREFERENCE / WRITE 注解快照，
   以及 `deref_resolves_to` / `same_storage` / `coverage` 全量原始 JSON
   （`D:\tasco-temp\issue-pilot\s7f2-evidence\<file>.json` + `summary.csv`）。
3. 人工标注 ground truth：每个 spawn 第 4 实参的形态与每个线程入口内解引用的真实目标。
4. 按 §5.11.1 三态语义对照：`must` 仅可证明身份链；`may` 弱证据；`unknown` 无证据。
   `same_storage=true` 仅当两 `must` 且 cross-owner 同 identity。

### 2.2 实测结果（PR HEAD，enable=True）

| 文件 | spawns | derefs | must | may | unknown | same_storage pairs |
|---|---|---|---|---|---|---|
| curl__threaded-ssl.c | 1 | 4 | 0 | 0 | 4 | 0 |
| ffmpeg__pthread_frame.c | 1 | 513 | 0 | 47 | 466 | 0 |
| iperf3__iperf_client_api.c | 1 | 227 | 0 | 4 | 223 | 0 |
| libuv__test-thread.c | 0 | 17 | 0 | 0 | 17 | 0 |
| memcached__thread.c | 1 | 169 | 0 | 0 | 169 | 0 |
| redis__bio.c | 1 | 47 | 0 | 15 | 32 | 0 |
| redis__networking.c | 1 | 1243 | 0 | 5 | 1238 | 0 |
| **合计** | **6** | **2220** | **0** | **71** | **2149** | **0** |

spawn 第 4 实参形态分布：**pointer_var ×5**（ffmpeg `p` / iperf `sp` / memcached `arg` /
redis bio `arg` / curl）、**opaque ×1**（redis networking `(void*)(long)i`）、**address_of ×0**。

### 2.3 FP / FN 判定

| 指标 | 数值 | 依据 |
|---|---|---|
| **TP**（must + 正确 identity） | 0 | 真实语料中无 address_of + 可证明链的 must 用例（见 §5 说明） |
| **FP**（must 错配 / 误 same_storage） | **0** | 无任何 must 产生；`same_storage=true` 0 条；pointer_var/opaque 一律降级 |
| **FN**（漏判本可 must 的真实同对象对） | 0 | 真实语料中不存在「同一对象经 address_of 传给两个跨 owner 线程且两者均解引用」的用例 |
| **may（正确保守）** | 71 | pointer_var/opaque 弱证据，§5.11.1 要求不得升 must → 全部正确降级 |
| **unknown（正确无证据）** | 2149 | 解引用所在函数无 spawn（非线程入口）或绑定不可解析 → 正确 unknown |

**核心结论（非 N/A，是实测结果）**：工具在 6 个真实 spawn、2220 个解引用点上产生
**0 个假阳性（0 false must、0 false same_storage）**，全部弱证据正确落入 may/unknown，
无一被升级为 must。must 正路径之所以为 0，是因为 FIX-05 模式（`&scalar` 传给两个
跨线程入口且均 `*p` 解引用）在主流真实生产代码中不出现——这正是验收合同用合成
fixture 表达正例、且 §3.1 强制「不得只以合成样本代替真实语料」的原因。合成正例与
反例已由 `tests/test_deref_resolution.py` 6 例（含入全量 772）锁定。

### 2.4 候选变化（baseline vs PR HEAD）

- **baseline `de006ef`**：`deref_resolution.py` 不存在（`git cat-file` 确认 ABSENT），
  无 `build_deref_resolution`，故 DEREF_RESOLVES_TO / same_storage 派生**不存在**，
  候选恒为 0。
- **PR HEAD `11b0b98`（enable=True）**：新增纯函数派生，在真实语料上产生
  **0 same_storage 候选**（与 baseline 一致）——即启用该特性**在真实代码上不引入任何新
  （假）候选**，正是 additive + 默认 OFF + 保守三态的设计意图。
- 差异原因：真实语料无 address_of spawn → must 路径不触发；pointer_var/opaque →
  may/unknown（保守），不产生候选。

---

## 3. §3.2 PERF_OVERHEAD（实测，非定性推演）

度量对象：S7-F2 增量成本 = `build_deref_resolution` 的声明索引 + 回溯链组装。
压力样本：最大真实文件 `redis__networking.c`（4006 events / 1243 deref / 223 write / 1 spawn）。

| 路径 | min | p50 | p95 | max | mean |
|---|---|---|---|---|---|
| OFF（`enable=False`） | 0.20 us | 0.20 us | 0.40 us | 1.30 us | 0.28 us |
| ON（`enable=True`） | 1312 us | 1489 us | 1877 us | 2277 us | 1532 us |

- **默认 OFF 增量 ≈ 0.2 us**（直接返回空 envelope，O(1)）。
- **ON 增量 ≈ 1.5 ms**（两趟 O(N) 事件扫描 + 字典/集合查表，40 次重复的稳定分布）。
- **端到端占比**：同文件完整管线 `full_index 119ms + analyze_scope 319ms +
  query_analysis 53ms ≈ 493ms`，`build_deref_resolution` 1.8ms = **0.37%**。
- 复杂度 O(N)（N=事件数），与事件数线性；无二次排序、无 per-pair 回溯爆炸。

环境：Python 3.12.10 / tree_sitter 0.26.0 / Windows 11 x64 / PR HEAD worktree
`D:\tasco-temp\issue-pilot\worktrees\provenlattice-48`，`PYTHONPATH=<wt>\src`。
可复现命令：`python perf_benchmark.py <corpus_dir>`（40 次重复）。

---

## 4. §3.3–3.6 复核（仍有效）

- **§3.3 开关回退**：`enable=False` 返回空 envelope（实测 OFF 0.2us + 空 `deref_resolves_to`/
  `same_storage`），由 `test_deref_resolution.py::test_default_off_is_empty` 锁定。
- **§3.4 全量 CI**：PR #53 `statusCheckRollup` 三 job 全 `SUCCESS`
  （`test-windows` / `linux-jdt-verify` / `test-linux`，completedAt 2026-11-04T03:00Z）；
  本地 `python -m unittest discover -s tests` = **772 passed (OK)**。
- **§3.5 独立 Reviewer**：`pl-owner-reviewer[bot]` 独立 LGTM（审 `11b0b98`，非实现 Worker、
  非 Owner、非首次被撤销的自审子代理），记录于 #48 评论，**未撤销**。
- **§3.6 旧 envelope 默认稳定**：PR #53 diff 仅 `+2` additive 文件
  （`deref_resolution.py` + `test_deref_resolution.py`，370 insertions / 0 deletions）；
  `src` 内**零** import `build_deref_resolution`（grep 确认仅模块自身引用）→ 生产路径未接线，
  默认 envelope 字节稳定零回退。

---

## 5. 发现与限制（如实记录，非回归）

1. **inline block comment 使实参索引偏移 +1（curl 实测）**：tree-sitter C 语法将实参表内
   `/* ... */` 注释作为 `argument_list` 的 named child，导致 `pthread_create` 的第 3/4 实参
   索引错位——`thread_function` 落空、`thread_argument` 落到函数名而非第 4 实参对象。
   后果**只降级为 unknown（保守）**，**绝不产生假 must**。该缺陷位于 S7-F1 的
   `sparsecfg.py::_thread_function/_thread_argument_facts`（非本 PR owned，S7-F2 禁止改
   sparsecfg.py），如实记录、不越权修复。
2. **opaque 形态 → may（非 unknown）**：`_resolve_deref` 对 `forms != {"address_of"}` 统一返回
   `may`（含 `opaque`）。语义上 `opaque`（身份不可证）也可读作 unknown，但 may 仍保守、
   永不升 must，不产生假 same_storage。属可接受的三态边界，记录备查。
3. **frame-blind 键池的过保守 may（与独立 Reviewer 观察一致）**：`writes_by_decl[subject_decl]`
   跨同名 local 共享，可能把可 must 的用例过保守降级为 may（**只假阴性、绝无假阳性**）。
   本语料实测未触发 must 正例，故不产生可量化 FN；与 Reviewer 非阻断观察 #2 吻合。
4. **array-element 粒度残留风险（理论，未实测触发）**：`scoped_identity` 对 `&arr[i]`
   不记录下标（S7-F1 存储类粒度），若真实代码出现「address_of 全局数组元素 + 跨 owner 解引用」
   可能把 `arr[0]`/`arr[1]` 折叠为同一 `global:arr`。本语料未出现该形态（spawn 均
   pointer_var/opaque），故 0 FP 成立；留待 Owner 知悉，不伪造合成用例充数。

---

## 6. STOP 声明

- 未 Merge / Close #48 或 PR #53；未改 PR HEAD `11b0b98`；未改正式实现、冻结合同、
  评测标准；未 revoke 独立 LGTM；未把 FP/FN 判为 N/A；未因测试失败放宽验收。
- 未修改任何产品代码；语料/脚本/原始数据仅写入 `D:\tasco-temp\issue-pilot\`。
- 完成后 STOP，等待独立 Reviewer 复核 §3.1/§3.2 与 Owner 最终 Merge 裁决。

## 7. 可复现命令

```text
# 环境
$env:PYTHONPATH = "D:\tasco-temp\issue-pilot\worktrees\provenlattice-48\src"   # PR HEAD

# FP/FN 全量原始数据
python D:\tasco-temp\issue-pilot\s7f2-corpus\run_fpfn.py ^
       D:\tasco-temp\issue-pilot\s7f2-corpus D:\tasco-temp\issue-pilot\s7f2-evidence

# PERF_OVERHEAD
python D:\tasco-temp\issue-pilot\s7f2-corpus\perf_benchmark.py ^
       D:\tasco-temp\issue-pilot\s7f2-corpus

# 全量测试（CI 配方）
python -m unittest discover -s tests
```

## 8. 交付物索引

- `D:\tasco-temp\issue-pilot\s7f2-corpus\` — 7 语料源文件 + `run_fpfn.py` + `perf_benchmark.py`
- `D:\tasco-temp\issue-pilot\s7f2-evidence\` — 每文件原始 JSON + `summary.csv`
- 本文件（控制仓库 `sub48_s7f2_merge_gate_evidence.md`）
