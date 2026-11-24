# Reviewer Bot 身份与权限设计（R7 · 方案2 落地）

> 状态：设计交付物，供 Master 逐条合同复核。App 创建 / Token / Launcher 改动由 Repo Owner 执行。
> 边界：不创建 App、不生成/修改 Token、不修改现有 Launcher、不开 Strict Mode、不改 CLI。

---

## 0. 三处合同确认（Master 审核结论落定）

| # | 确认点 | 结论 |
|---|---|---|
| Q1 | Reviewer App 写入路径 | 方案 B 双 App：读 App 只读产品仓（无 Issues）、写 App 只写 issue-pilot 评论；**不**提交 GitHub PR Review（不 APPROVE/REQUEST_CHANGES） |
| Q2 | `PL_PRINCIPAL` 可信性 | 稳定治理主体，通用 Launcher 身份校验 + 角色专属校验（见 §4），不信任环境变量自述 |
| Q3 | Merge 门与 R7 分离 | `merge` 仅 `PL_ROLE=owner`；合并所依赖的独立有效 LGTM 必须来自 `reviewer` 角色且 SHA 绑定；Repo Owner 自审不满足 merge 独立性 |
| Q4 | R7 身份校验一致性 | 审查资格 ≠ merge LGTM 有效性：Reviewer Launcher 才产出有效 LGTM，Owner Launcher 兼任复审仅作记录（见 §4 角色×动作矩阵） |

---

## 1. `start-reviewer-agent.ps1` 设计

与 `start-worker-agent.ps1` / `start-owner-agent.ps1` 完全同构，仅角色常量与 App 常量不同。

**硬钉常量（无参数可切换角色）**
```
$Role           = 'reviewer'
# 读侧 App（只读产品仓）
$ReadAppId          = '<read AppId，待创建>'
$ReadInstallationId = '<pinned installation，待创建>'
$ReadExpectedBot    = 'pl-issue-reviewer-read[bot]'
# 写侧 App（只写控制仓评论）
$WriteAppId          = '<write AppId，待创建>'
$WriteInstallationId = '<pinned installation，待创建>'
$WriteExpectedBot    = 'pl-issue-reviewer-write[bot]'
$RepoFull       = 'sunSUNQ/provenlattice'   # 读侧（产品仓）
$ControlRepo    = 'sunSUNQ/issue-pilot'     # 写侧（控制仓，发 review 结果）
$ControlRoot    = 'D:\issue-pilot'
$TokenScript    = 'D:\issue-pilot\scripts\pl-token.mjs'
```

**运行时布局（同构）**
- `runtime\reviewer\{gh,gitconfig,askpass.cmd,keys}`；PEM `runtime\reviewer\keys\pl-issue-reviewer-read.private-key.pem` 与 `pl-issue-reviewer-write.private-key.pem`。
- 步骤：tooling sanity → purge 继承凭据 → per-role 目录 → 定位两 PEM → 分别 `node pl-token.mjs` mint+self-verify → 注入读/写双 token。

**注入 env（差异点标注）**
```
PL_ROLE=reviewer
PL_ENFORCE_APP=1
PL_GITHUB_LOGIN=pl-issue-reviewer[bot]   # 审计：实际认证主体（治理主体）
PL_PRINCIPAL=pl-issue-reviewer[bot]      # 治理主体（GitHub-login 形态，与 assignee 同命名空间）
PL_REPO_EXPECTED=sunSUNQ/provenlattice
# 读侧凭证（只读 provenlattice）
PL_READ_TOKEN_BOT=pl-issue-reviewer-read[bot]
PL_READ_EXPECTED_BOT=pl-issue-reviewer-read[bot]
PL_GIT_TOKEN=<读侧 installation token>
# 写侧凭证（只写 issue-pilot 评论）
PL_WRITE_TOKEN_BOT=pl-issue-reviewer-write[bot]
PL_WRITE_EXPECTED_BOT=pl-issue-reviewer-write[bot]
PL_WRITE_GIT_TOKEN=<写侧 installation token>
PL_APP_ID / PL_APP_INSTALLATION_ID / PL_APP_KEY_PATH / PL_TOKEN_EXPIRES_AT / PL_RUNTIME_DIR（读/写两套）
GH_CONFIG_DIR / GIT_CONFIG_GLOBAL / GIT_CONFIG_NOSYSTEM / GIT_TERMINAL_PROMPT / GIT_ASKPASS
```

**关键差异（相对 owner / worker launcher）**
1. 双 App 双 token：读侧 `PL_GIT_TOKEN`（只读 provenlattice）、写侧 `PL_WRITE_GIT_TOKEN`（只写 issue-pilot 评论）。
2. 新增 `PL_PRINCIPAL`（治理主体）与 `PL_GITHUB_LOGIN`（审计登录）。
3. 自校验须分别确认两个 App 的安装在各自目标仓覆盖到位。
4. 无 merge/push 能力：两 App 均不授予写权限（§2），CLI 层亦按角色拒绝。

---

## 2. Reviewer App 权限方案（方案 B：双 App）

**平台权限模型约束（诚实声明）**
- GitHub App 的权限是 **App 级 / installation 级**，不是逐仓库级别。同一 App 安装到多个仓库时，其权限（如 Issues:Write）对所有被安装仓库生效。
- 因此「读仓无写权限 + 写仓只写评论」**无法用单 App + 逐仓库权限描述实现**。

**裁定：方案 B（拆两个 App，权限边界清晰）**
| App | 安装仓库 | 权限 | 用途 |
|---|---|---|---|
| `pl-issue-reviewer-read[bot]` | `sunSUNQ/provenlattice` | Contents:Read, Pull requests:Read, Checks:Read, Commit statuses:Read（**无 Issues**） | 只读 PR / diff / files / CI |
| `pl-issue-reviewer-write[bot]` | `sunSUNQ/issue-pilot` | Issues:Write | 只写结构化 review 结果评论 |

**数据流（Reviewer Bot 读侧零写权限）**
```
Reviewer Bot ──(read App)只读──► provenlattice（PR / Diff / Files / CI）
      │ R1–R5 独立审查
      ▼
结构化 LGTM / CHANGES / BLOCKED ──(write App)写──► issue-pilot（结果 + 身份 + HEAD SHA + review_id）
      ▼
Governance CLI 校验 R7 → 派生标签
```

**身份交接（两个 App 的成本，不假装单 App 已实现）**
- Reviewer Launcher 管理两套凭证：读侧 token（`PL_GIT_TOKEN`，读 provenlattice）与写侧 token（`PL_WRITE_GIT_TOKEN`，写 issue-pilot）。
- CLI 的 `review` 命令读阶段用读侧凭证、写评论阶段用写侧凭证。
- 两 App 都钉在治理主体 `PL_PRINCIPAL=pl-issue-reviewer[bot]`；审计 `github_login` 记实际所用 App login。

**读 App `pl-issue-reviewer-read[bot]` 权限明细（最小集）**
| Permission | 级别 | 理由 |
|---|---|---|
| Metadata | Read | 默认必需 |
| Contents | Read | 读 PR diff / 文件列表 / ci.yml |
| Pull requests | Read | 读 PR metadata、head sha、files、diff |
| Checks | Read | 读 check-runs（Required Checks 判定） |
| Commit statuses | Read | 读 commit status（兼容 legacy status checks） |

**写 App `pl-issue-reviewer-write[bot]` 权限明细（最小集）**
| Permission | 级别 | 理由 |
|---|---|---|
| Metadata | Read | 默认必需 |
| Issues | Write | 只写结构化 review 结果评论（**不**操作标签，标签由 CLI 派生） |

**权限闭环（权限层 vs 协议层，要求4）**
- 写 App 的 Issues:Write 在平台层面同时涵盖 issue 评论与 labels，**无法细分为「只写评论、不改标签」**。
- 因此「Reviewer Bot 不改治理标签」是**协议层约束**而非平台权限层约束，由三层闭环保证：
  1. Review Contract 硬禁止 3（不得修改标签绕过 CI Gate）。
  2. CLI 派生标签：Bot 只提交结构化结果，标签由 CLI 确定性派生。
  3. 治理审计：所有标签变更留痕，可追溯操作者与来源。
- 读 App 对产品仓**零写权限**（无 Contents:Write / Pulls:Write / Issues），从平台权限层杜绝改代码、merge、PR review。

**两 App 均不授予（fail-closed 边界）**
- ❌ Contents:Write（不能 push / 改代码）
- ❌ Pull requests:Write（不能 merge / 不能 PR review APPROVE / REQUEST_CHANGES）
- ❌ Workflows / Actions:Write（不能改 CI）
- ❌ Administration（不能改保护规则 / ruleset）

**事件订阅**：无需 webhook（CLI 拉取式）；不订阅事件。

---

## 3. `PL_PRINCIPAL` 与 `PL_GITHUB_LOGIN` 字段定义

| 字段 | 含义 | 取值（示例） | 是否硬条件 | 用途 |
|---|---|---|---|---|
| `PL_GITHUB_LOGIN` | 当前**实际认证身份** | `pl-issue-reviewer[bot]` / `pl-owner-reviewer[bot]` / `pl-issue-worker[bot]` / `sunSUNQ` | 否（审计） | 审计轨迹、Review 记录 `github_login` |
| `PL_PRINCIPAL` | 该 Launcher 代表的**治理主体** | owner→`sunSUNQ`；reviewer→`pl-issue-reviewer[bot]`；worker→`pl-issue-worker[bot]` | **是**（冲突判定） | 与 assignee 比对，判定 R7 约束 2/3 及 merge 独立性 |

**分角色取值**
| 角色 | PL_ROLE | PL_GITHUB_LOGIN | PL_PRINCIPAL |
|---|---|---|---|
| Author | worker | `pl-issue-worker[bot]` | `pl-issue-worker[bot]`（作者主体，GitHub-login 形态） |
| Reviewer | reviewer | `pl-issue-reviewer[bot]` | `pl-issue-reviewer[bot]`（独立机器主体，GitHub-login 形态） |
| Repo Owner | owner | `pl-owner-reviewer[bot]` | `sunSUNQ`（人类治理主体） |
| Issue Owner | —（assignee） | assignee login | assignee login |

**原则**
1. `PL_GITHUB_LOGIN` 认证层 vs `PL_PRINCIPAL` 治理层，不混用。
2. Reviewer Bot 的 login 与 principal 都用真实机器标识，不伪装人类。
3. assignee 比对一律用 `PL_PRINCIPAL`（同命名空间）。
4. `PL_PRINCIPAL` 必须稳定、且经 §4 通用+角色专属校验，不能仅凭环境变量自述。

**主体命名空间与无法确认处理（要求1）**
- 命名空间：`PL_PRINCIPAL` 必须是合法 GitHub 主体（人类 login 或 bot login，如 `sunSUNQ` / `pl-issue-reviewer[bot]`），与 GitHub Assignee **同命名空间**才可直接比对；不接受自由字符串。
- 比对：`PL_PRINCIPAL == assignee` 即判定「兼任 issue owner」。
- 无法确认时的处理（一律 fail-closed）：
  1. `PL_PRINCIPAL` 缺失 / 空 / 不符合 GitHub login 形态 → 拒绝 review。
  2. `PL_PRINCIPAL` 无法解析为可比 GitHub 主体 → 拒绝 review。
  3. assignee 缺失或多值 → 拒绝 review（决策④）。
  4. 任一方无法求值时，视为「可能兼任 issue owner」，按 fail-closed 拒绝。

---

## 4. 身份校验与 R7 新身份矩阵

**身份校验（`verifyLauncherIdentity`，review 前置）—— 拆通用校验 + 角色专属校验**
通用校验（所有角色一律通过，否则 fail-closed）：
```
1. PL_ENFORCE_APP == '1'                       # Launcher 会话
2. PL_ROLE ∈ {worker, reviewer, owner}          # 合法角色，缺失/未知 → fail
3. 实际 token 对应预期 bot（自校验）             # reviewer: READ/WRITE 双 token 均须自校验通过
4. 无外部参数可覆盖角色/主体                     # launcher 硬钉，CLI 拒绝任何 --role/--principal 覆盖
```

角色专属校验（按 `PL_ROLE`，各自硬钉，互不复用）：
```
role == 'reviewer' : PL_PRINCIPAL == 'pl-issue-reviewer[bot]'   # 机器主体
role == 'owner'    : PL_PRINCIPAL == 'sunSUNQ'                   # 人类主体
role == 'worker'   : PL_PRINCIPAL == 'pl-issue-worker[bot]'      # 机器主体
```

**信任边界（要求8）**
- 环境变量本身不是不可伪造的身份凭证——`PL_ROLE` / `PL_PRINCIPAL` 只是声明，不是证明。
- 真正安全边界：
  1. Launcher 控制角色配置（硬钉，无参数可切换）。
  2. 每个角色使用独立 App 凭证（Reviewer 为读/写双 App，Owner/Worker 各自单 App）。
  3. CLI 通过真实 Token 身份验证确认 App（`PL_TOKEN_BOT == PL_EXPECTED_BOT` 及安装覆盖）。
  4. 不允许其他角色取得或复用 Reviewer 私钥及 Token（密钥按角色隔离存放）。
  5. 所有角色检查失败均拒绝执行（fail-closed）。
- 仅凭 `PL_ROLE=reviewer` 无法伪造 Reviewer 身份，因通用校验第 3 条会验证真实 Token 的 App 身份。

**review 允许性判定（扩展）**
```
require PL_ENFORCE_APP == '1'                     # 否则 fail（约束6）
role      = PL_ROLE                               # 缺失/未知 → fail
principal = PL_PRINCIPAL                          # 缺失/非法（非 GitHub 主体形态）→ fail（命名空间）
assignee  = issue 唯一 assignee                   # 缺失/多值 → fail（决策④）
# 主体命名空间校验：principal 须为合法 GitHub 主体，与 assignee 同命名空间才可比，否则 fail-closed

if role == 'worker'                              -> fail   # 约束1
if role == 'owner'  and principal == assignee    -> fail   # 约束3
if role == 'reviewer' and principal == assignee  -> fail   # 约束2
if role not in {'reviewer','owner'}              -> fail   # 约束4
# 其余 -> 允许
```

**角色×动作总矩阵**
| 动作 | Worker | Reviewer | Repo Owner(owner) | Issue Owner(assignee) |
|---|---|---|---|---|
| 实现/提交 PR | ✅ | ❌ | ❌ | ❌ |
| 执行 `review` | ❌ | ✅（专用 Reviewer，principal≠assignee，可产有效 LGTM） | ✅（兼任复审，principal≠assignee，仅记录） | ❌ |
| 执行 `merge` | ❌ | ❌ | ✅（唯一） | ❌ |
| approve / verify / close | ❌ | ❌ | ❌（路由到 issue owner） | ✅（路由制，④无硬 ACL） |

**merge 独立性（Q3 铁律）**：merge 所依赖的有效 LGTM 必须来自 `reviewer` 角色且 `reviewed_head_sha == PR head`；Repo Owner 自己的 review（owner 角色）仅作记录，不满足 merge 独立性。

**Assignee 路由 vs 身份授权（要求7，澄清）**
- 角色矩阵中 approve / verify / close 标记「Issue Owner」是**路由语义**，不是执行者身份级强制隔离。
- Assignee 是 Issue 生命周期责任人的唯一标识（决策④），CLI 按 assignee 唯一性做路由校验，但**不宣称**已具备执行者身份级强制隔离（当前不做 GitHub 人类账号登录身份隔离）。
- 若未来需真正限制执行者身份，须另行设计身份授权机制；现阶段「按 assignee 路由」≠「证明操作者就是 assignee」。

---

## 5. Reviewer Bot 的 Review Contract

**输入（全部只读）**
1. 目标 Issue 冻结合同（五要素：观察证据 / 期望行为 / 反例或失败条件 / 允许修改范围 / 验收方式）。
2. PR：head sha、files、diff。
3. CI：当前 head 的 Required Checks 状态（`canEnterReview`）。
4. 文件边界：`gateAudit`（GATE_FILES / GATE_PREFIXES / workflow 白名单 / forbidden 标记）。

**前置判定（消除 SHA 循环依赖 —— 三态第一层）**
- 读取 state `ciHeadSha`（由 `ci` 命令在 CI 全绿时写入）；无该记录 → BLOCKED。
- PR 当前 head != `ciHeadSha` → BLOCKED（HEAD 变化，需重新 `ci`）。
- reviewer 提供的 `--sha` != `ciHeadSha` → BLOCKED（SHA 不一致）。
- 三者一致 → 进入 R1–R5 实质审查，产出 LGTM / CHANGES。

**判定维度 R1–R5（全部覆盖 → LGTM，否则 CHANGES）**
| # | 维度 | 要求 |
|---|---|---|
| R1 | 合同符合性 | 实现与 Issue 冻结合同**逐项对应**（五要素逐条映射到 diff） |
| R2 | 修改范围 | 无超出允许修改目录和文件；`gateAudit` 0 命中 |
| R3 | 语义正确性 | 不只测试通过，须核对实现语义是否真满足合同，不满足语义则 CHANGES |
| R4 | 回归与兼容 | 检查原有功能、版本号、公开接口/schema 兼容性，无回归破坏 |
| R5 | 证据完整性 | 结论必须引用 Diff、代码位置、测试、CI 证据；证据不足 → 显式「无法确认」，**不得推断通过** |

**输出（三态，可追溯）**
- `LGTM`：结构化 `{launcher_role, github_login, reviewer_verdict: lgtm, reviewed_head_sha: ciHeadSha, reviewed_at, review_id}` + 证据摘要（R1–R5 逐项结论），写 issue-pilot。
- `CHANGES`：列出具体不满足项 + 证据（文件/行/检查），写 issue-pilot。
- `BLOCKED`：前置未满足（无 `ciHeadSha` / HEAD 变化 / SHA 不一致 / 身份异常），写阻塞原因，**不构成代码判定**；保持 `need:reviewer` 不变，禁止生成 `review:lgtm`、禁止进入 `need:repo-owner`；修复环境后可重新 review。
- 证据不足项：必须显式输出「无法确认」，不得默认为通过。

**结果与标签的职责边界（要求3）**
- Reviewer Bot 只提交结构化 Review 结果（评论 + state 记录），不直接改标签。
- Governance CLI 依据结果按标签转换表（design.md §5-8）设置与清除：`lgtm`→设置 `review:lgtm`+`need:repo-owner`；`changes`→设置 `need:author`；`blocked`→设置 `need:reviewer`；`changes`/`blocked` 均**主动清除**已失效的 `review:lgtm` 与 `need:repo-owner`。
- 标签流转是 CLI 的确定性派生（可重放、幂等），不依赖 Bot 的自由行为。

**硬禁止（边界）**
1. 不得 merge（无权限 + CLI 角色门）。
2. 不得修改所审代码（无 Contents:Write）。
3. 不得修改标签绕过 CI Gate。
4. 不得执行 approve（issue owner 动作）。
5. 不得为了推进流程而默认 LGTM；证据不足 → CHANGES / 无法确认。
6. 架构 / 安全 / 复杂语义 → 输出「需人类复核」，不得自行 LGTM。

---

## 6. CI Gate × R7 × Merge Gate 联动测试

| # | 场景 | 期望 |
|---|---|---|
| T1 | worker submit → PR → CI 未绿 | `ci` 拒绝转 reviewer，`need:author` |
| T2 | CI 全绿 | `ci` → `need:reviewer` |
| T3 | worker（PL_ROLE=worker）执行 review | R7 fail（约束1） |
| T4 | reviewer bot（principal=pl-issue-reviewer[bot]）LGTM | 允许 → `need:repo-owner` + 结构化记录 |
| T5 | owner launcher（principal=sunSUNQ==assignee）review | R7 fail（约束3） |
| T6 | owner launcher review，assignee≠sunSUNQ | 允许产生 review，但 merge 门不承认其为独立 LGTM（Q3） |
| T7 | LGTM 后 push 新 commit | LGTM 失效；ci 重跑；merge 拒绝（G2/G3） |
| T8 | owner merge：reviewer 角色 LGTM + 四门全过 | `gh pr merge --merge` → `verifying`+`need:issue-owner` |
| T9 | owner merge：任一门不过 | 拒绝，`rework` 记录理由 → `need:author` |
| T10 | PL_ROLE 缺失 / PL_ENFORCE_APP!=1 / PL_TOKEN_BOT≠PL_EXPECTED_BOT | fail-closed（约束6/Q2） |
| T11 | reviewer bot 尝试 merge | 拒绝（无权限 + CLI 要求 PL_ROLE=owner） |
| T12 | reviewer bot 尝试改代码 / 改标签绕过 CI | 拒绝（权限边界 + CLI） |
| T13 | Required Checks 配置被清空 | `ci`/`review`/`merge` 全部 fail-closed（G4） |
| T14 | assignee 为空/多值 时 review | fail-closed（决策④ + R7 前置） |
| T15 | 仅 owner 自审 LGTM（无 reviewer 角色 LGTM） | merge 拒绝（merge 独立性不满足，Q3） |
| T16 | reviewer bot 证据不足 | 输出「无法确认」/ CHANGES，不得 LGTM（R5） |
| T17 | reviewer bot 需输出 CHANGES 的场景被默认为 LGTM | 契约违约，判为 CHANGES 路径缺失（硬禁止5） |
| T18 | 语义正确性未核对（仅测试绿） | CHANGES（R3 不满足） |
| T19 | reviewer 提交结构化结果 → CLI 派生标签 | `review:lgtm` + `need:repo-owner` 由 CLI 派生，Bot 不直接改标签（G7） |
| T20 | 前置未满足（无 `ciHeadSha` / HEAD 变化）review | BLOCKED，不 LGTM 不退回（G8） |
| T21 | review 中断 / 评论成功标签失败 后重放（同 SHA 同 verdict） | 凭 `review_id` 判重，幂等恢复：不重复写评论、仅补标签，无重复/矛盾标签（G9） |
| T22 | 跨 app 同名 context 的 Required Check | 不匹配 integration_id → 不视作通过（G10） |