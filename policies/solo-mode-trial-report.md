# Solo Mode 受控试运行报告（Step 4，中期）

> 日期：2026-10-20 · phase=PILOT（仅限 #8-#12）· 工单 PL-ISSUE-PILOT-SOLO-MODE-V1

## 1. 已实现（Step 1-3）

| 交付物 | 位置 |
|---|---|
| Solo Mode Policy V1（AUTO/OWNER_GATE/权限矩阵/回滚） | `policies/solo-mode.md` |
| 状态机改造（advance/autopilot + verifying/hold 标签） | `scripts/cli.mjs` |
| 自动合并质量门（HEAD 绑定/LGTM-SHA 匹配/CI 全绿/gate 审计） | `scripts/cli.mjs` |
| 失败阈值（复审 changes≥2、CI 失败≥2 → hold） | `scripts/cli.mjs` |
| 幂等与断点恢复（config/state/*.json，本地） | `scripts/lib.mjs` |
| 文件级 Owner Gate（policy/pyproject/schema/workflow 授权面/QUALIFIED） | `scripts/cli.mjs` |
| phase 门（DRAFT 全拒 / PILOT 限清单 / ACTIVE 待授权） | `scripts/lib.mjs` |

试运行期间发现并修复 2 个引擎 bug：查重误报（关键词搜索 → 词元重叠 ≥60%）、
head SHA 解析（--json 未取裸值）。

## 2. 试运行矩阵（#8-#12）

| Issue | 验证点 | 状态 | 证据 |
|---|---|---|---|
| #8 | 自动批准→实现→PR→复审→merge→close 全链 | **PR #15 等 LGTM** | 自动批准评论（五要素+词元查重）；worktree codegraph-8；PR head 59cabb1 |
| #9 | 无进展停止 + owner 升级 | **hold ✅**（stage0 文件不在 origin/main，37 commit 平行历史） | Issue 评论留痕；worktree 保留可恢复 |
| #10 | 代码类实现 | **hold ✅**（依赖 PR #14 merge；依赖串行化发现） | Issue 评论留痕 |
| #11 | docs-only 修复 | **hold ✅**（同 #10 依赖） | Issue 评论留痕 |
| #12 | **Owner Gate 拦截**（pyproject） | **PR 已建，等 LGTM**；merge 时预期 gate 命中 → hold | diff 仅四文件、版本一致 1.6.0-dev0 |

已验证的自动路径：candidate→approved（自动批准 3 次，#8/#10/#12）→
worktree 创建 → 实现中断点恢复（autopilot 幂等重入）→ submit（PR + state
HEAD 绑定）→ 等待复审停止。hold 升级路径 3/3 正确（#9/#10/#11）。

## 3. 待完成（阻塞于复审/merge，非引擎缺陷）

1. **独立复审**：PR #15（#8）、PR #18（#12）需未参与实现的 reviewer 认领
   （`pilot review <issue> --verdict lgtm|changes --sha <head>`）。
2. **自动合并 + gate 拦截**：LGTM + CI 绿后 `autopilot` 执行 merge——
   #12 预期命中 pyproject → hold（试运行核心验证点）。
3. **verify → close**：merge 后自动证据归档与关闭。

## 4. Owner 待办（试运行暴露）

1. **本地 main 37 commit 对账**（阻塞 #9；试运行任务 B 已有只读审计授权）。
2. **PR #14 merge**（阻塞 #10/#11 与试运行收尾）。
3. **main 分支保护未启用**（API 404）——建议在 ACTIVE 授权前启用。
4. 复审后对最终自治权限配置的一次性批准（phase PILOT → ACTIVE）。

## 5. 回滚

随时可用：`policies/solo-mode.md` 状态行改回 DRAFT 即全链拒绝（已验证：
DRAFT 下 advance/autopilot 均拒绝执行）。已建 PR 走既有 owner 流程。
