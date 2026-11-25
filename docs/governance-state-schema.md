# Governance State Schema — 设计冻结（v1）

> 状态：**设计冻结草案（Phase 1）— 等待 Owner 批准，不得进入实现**
> 父 Issue：`sunSUNQ/issue-pilot#113`（Decision D2-B）
> 本 Issue：`sunSUNQ/issue-pilot#122`
> 授权范围：本文件与 `docs/` 下文档；`scripts/**`、`test/**` 的代码实现需 Owner 对本设计**二次确认**后另行授权。
> 适用控制面：单租户（Owner + 角色 launcher），不引入外部服务 / 数据库 / 新 App / 新权限。

---

## 1. 目标与不变量

### 1.1 目标

1. 控制面写操作在 Issue 评论中留下**机器可读、可校验、可重建**的状态事件。
2. 新机器或空 `config/state/` 目录下，`state rebuild <issue>` 能从 Issue 评论恢复
   `binding / ciHeadSha / reviews / mergedSha` 等治理状态，随后 `ci` / `review` / `merge`
   可继续工作，无需手工复制 state 文件。
3. 重建结果**确定**：不依赖 API 返回顺序、评论分页顺序或本地缓存。
4. 保持现有 state 文件格式兼容；本地 state 降级为缓存，Issue 评论为事实来源。

### 1.2 不变量（任何实现都不得破坏）

- 不改变 `review` / `merge` 的四门语义与 `validReviewerLgtm` 的 SHA 绑定规则。
- 不新增 App / Installation / 权限，不修改 ruleset / workflow。
- 不引入服务器、数据库、队列或外部存储。
- 重建不写 GitHub；只读 Issue 评论并写本地 state。
- 未知 schema、伪造作者、审计不一致、篡改、歧义冲突一律 fail-closed。

---

## 2. 术语与事实来源

| 术语 | 定义 |
|---|---|
| 状态事件（event） | 一条控制面写操作在评论中留下的结构化记录 |
| 状态块（state block） | 评论内隐藏的机器可读载荷（见 §4） |
| 事实来源 | Issue 评论（GitHub 持久化、append-only、作者可追溯） |
| 本地 state | `config/state/<alias>-<issue>.json`，缓存，可删除、可重建 |
| 折叠（fold） | 按确定性顺序把事件依次应用到空 state 的过程 |

**边界**：GitHub Issue 评论本身也不是不可篡改存储；本设计把“作者钉扎 + 审计 footer +
正文摘要”作为完整性边界，残余风险见 §7。

---

## 3. 现有 state 字段清单与重建映射

当前 `config/state/<alias>-<issue>.json` 的字段（来自 #101 / #108 / #109 / #110 实际文件）：

| state 字段 | 来源操作 | 是否可重建 | v1 事件类型 |
|---|---|---|---|
| `prNumber/prUrl/prBranch/prBase/prHeadSha/boundAt/boundBy/boundWriter` | `submit` / `bind` | 是 | `binding` |
| `ciHeadSha/ciVerifiedAt` | `ci`（Required Checks 全绿） | 是 | `ci` |
| `reviews[]` | `review` | 是 | `review` |
| `mergedSha/mergedAt/mergeVerdict/mergeLgtm` | `merge --verdict merge` | 是 | `merge` |
| `mergeVerdict/reworkAt/reworkReason` | `merge --verdict rework` | 是 | `merge`（rework 变体） |
| `launcherRole/githubLogin` | `run` / `submit` | 是 | `run` |
| `assignee/ownerTransfers[]` | `approve/verify/close` 的 OwnerTransfer 检测 | 是 | `owner-transfer` |
| `submittedAt` | `submit` | 是 | `binding` |
| `head/branch/prUrl` | `submit` 冗余副本 | 由 `binding` 派生 | — |
| `autoApproveBlock/soloMergeGateReady` | Solo Mode 瞬态 | 否（本地瞬态） | — |
| `verifiedAt` | `verify` | 可选 | `verify`（v1 可选） |
| `rebuiltAt/rebuiltFrom/schemaVersion` | `state rebuild` | 否（本地元数据） | — |

**规则**：重建只写“可重建”字段与重建元数据；本地瞬态字段不写。若某字段既不可重建又是
门禁必需，则视为设计缺口，必须回到 Owner 决策（v1 不存在此情况）。

---

## 4. 状态块格式（v1）

### 4.1 载体

在每条需要留痕的审计评论末尾追加**一行**隐藏 HTML 注释：

```text
<!-- issue-pilot-state:v1 <BASE64> -->
```

- `<BASE64>` = 标准 Base64（字母表 `A–Z a–z 0–9 + / =`），**不使用 base64url**，
  避免 `-` 造成 HTML 注释中的 `--` 序列。
- 单行、无换行；Base64 解码后为单个 UTF-8 JSON 对象。
- 隐藏注释在 GitHub 渲染视图中不可见；`gh api` / `gh issue view --json comments`
  返回的 `body` 中保留原文。
- 每条评论最多一个状态块；出现 0 个按“legacy 评论”处理（§8.1），出现 ≥2 个 fail-closed。

### 4.2 Envelope（解码后的 JSON）

```json
{
  "schema": "issue-pilot/state@1",
  "event_id": "sha256:<64 hex>",
  "issue": 108,
  "repository": "sunSUNQ/issue-pilot",
  "alias": "issue-pilot",
  "type": "binding",
  "operation": "bind",
  "role": "worker",
  "principal": "pl-issue-worker[bot]",
  "writer_login": "pl-worker-control-write[bot]",
  "at": "2026-11-25T03:43:40.802Z",
  "body_sha256": "sha256:<64 hex>",
  "payload": { }
}
```

字段约束：

| 字段 | 约束 |
|---|---|
| `schema` | 精确等于 `issue-pilot/state@1`；其他值 fail-closed |
| `event_id` | `sha256:` + 64 位小写 hex；由 §4.4 规范计算 |
| `issue` | 等于目标 Issue 编号 |
| `repository` | 等于 `config.issueRepository` |
| `alias` | 等于 Issue 的 `repo:<alias>` 标签值 |
| `type` | `binding|ci|review|merge|run|owner-transfer|verify`（v1）；未知值 fail-closed |
| `operation` | 生成该事件的 CLI 操作名（`bind/submit/ci/review/merge/run/...`） |
| `role` | `worker|owner|reviewer`，必须与 `writer_login` 的钉扎映射一致 |
| `principal` | 该 role 的钉扎 principal（`ROLE_PRINCIPALS`） |
| `writer_login` | 实际评论作者，必须等于该 role 的钉扎写侧 bot（`ROLE_WRITE_BOTS`） |
| `at` | CLI 生成事件的 UTC 时间；**不用于排序**（排序用评论元数据） |
| `body_sha256` | 可见正文（去掉状态块后）的规范化摘要，见 §4.5 |
| `payload` | 按 `type` 定义，见 §5 |

### 4.3 评论作者与审计 footer 交叉校验

重建必须同时满足：

1. GitHub API 返回的 `comment.user.login` ∈ 钉扎写侧 bot 集合：
   `pl-worker-control-write[bot]` / `pl-owner-control-write[bot]` / `pl-issue-reviewer-write[bot]`。
2. `comment.user.login === envelope.writer_login`。
3. 同一评论的可见正文中存在**恰好一条**审计 footer，解析后与 envelope 相等：

```text
role=`<role>` principal=`<principal>` writer_login=`<writer_login>` repository=`<repository>` operation=`<operation>`
```

4. `role → writer_login` 映射与 `ROLE_WRITE_BOTS` 完全一致；不信任评论中自报的映射。

任一条不满足 → fail-closed（不跳过、不降级为 legacy）。

### 4.4 规范 JSON 与 event_id

- 规范 JSON：对象键按 Unicode 码点升序递归排序；无无关空白；UTF-8；整数按 JSON 数字；
  数组保序；拒绝 `NaN/Infinity`。
- `event_id = "sha256:" + sha256(canonicalJson({schema, issue, repository, alias, type,
  operation, role, principal, writer_login, at, payload}))`。
- 同一 `event_id` 再次出现：
  - 规范内容完全相同 → 去重（幂等）；
  - 内容不同 → fail-closed（哈希碰撞或重放篡改）。

### 4.5 body_sha256

对评论 `body` 做以下规范化后计算 SHA-256：

1. 删除状态块所在行（匹配 `^<!-- issue-pilot-state:v1 [A-Za-z0-9+/=]+ -->$`，允许行尾 `\r`）。
2. `\r\n` → `\n`。
3. 每行删除行尾空格与制表符。
4. 删除末尾空行，保留单个结尾 `\n`。

用途：检测可见正文（含审计 footer）被编辑。状态块自身被替换会改变 `event_id` /
`writer_login` 校验，仍属 fail-closed。

---

## 5. 事件类型与折叠规则

所有 payload 均为**增量语义**，折叠按 §6.2 顺序执行。

| type | 生成者 | payload | 折叠 |
|---|---|---|---|
| `binding` | `submit` / `bind` | `prNumber, prUrl, prBranch, prBase, prHeadSha, boundAt, boundBy, boundWriter, submittedAt?` | 覆盖绑定字段（最新合法事件生效） |
| `ci` | `ci` | `ready: boolean, ciHeadSha?, ciVerifiedAt?, required?, missing?` | 仅 `ready=true` 时写入 `ciHeadSha/ciVerifiedAt` |
| `review` | `review` | `review: { review_id, launcher_role, principal, github_login, token_bot, writer_login, repository, control_repository, reviewer_verdict, reviewed_head_sha, reviewed_at, review_url? }` | 按 `review_id` 替换或追加到 `reviews[]` |
| `merge` | `merge` | merge：`mergedSha, mergedAt, mergeVerdict:'merge', mergeLgtm`；rework：`mergeVerdict:'rework', reworkAt, reworkReason` | 覆盖对应字段（保留既有 `mergedSha` 语义与现实现一致） |
| `run` | `run` | `launcherRole, githubLogin` | 覆盖 |
| `owner-transfer` | `approve/verify/close` 的 OwnerTransfer 检测 | `assignee, ownerTransfers[]`（完整快照） | 覆盖 |
| `verify` | `verify`（可选） | `verifiedAt` | 覆盖 `verifiedAt`（门禁不依赖） |

**不生成状态块的写操作**：`propose`（仅创建 Issue）、`approve` / `close` / `hold`（标签与
Issue 状态，不是本地 state 门禁输入）。v1 实现可逐步扩展，但新增 type 必须升级 schema
版本（见 §8.2）。

**与现实现的等价性**：折叠结果必须与同一操作序列下现 `saveState` 产生的 JSON 在
“可重建字段”上逐字段相等；实现阶段用 fixture 做等价性测试。

---

## 6. 重建算法（`state rebuild <issue>`）

### 6.1 输入与预处理

1. 解析 Issue：`alias = repoAliasOf(issue)`；校验 `repoDescriptor`（控制仓或已注册产品仓）。
2. 通过 `controlGh` 分页读取该 Issue 的全部评论（REST `GET /repos/{repo}/issues/{n}/comments`,
   `per_page=100`，跟随 `Link: rel="next"`）。分页未完整结束（网络错误 / 缺页）→ fail-closed。
3. 对每条评论提取 `id`、`created_at`、`user.login`、`body`。

### 6.2 排序、解析、校验、折叠

```text
events = []
for comment in comments:
    block = extract_state_block(comment.body)      # 0 或 ≥2 个处理见 §8.1
    if no block: continue                          # legacy 评论
    envelope = decode_base64_json(block)
    validate_envelope(envelope, issue, config)     # §4.2/§4.3/§4.4/§4.5
    events.append({ order: (comment.created_at, comment.id, envelope.event_id),
                    comment_id: comment.id, envelope })

sort events by order ascending
# 同一 (created_at, id) 出现两条不同事件 → fail-closed（防御性）
for each event in order:
    dedupe by event_id (same canonical payload => skip; different => fail)
    state = fold(state, event)                     # §5
```

### 6.3 输出

- 结果 state = 折叠字段 + 元数据：
  ```json
  { "schemaVersion": "issue-pilot/state@1",
    "rebuiltAt": "<ISO>",
    "rebuiltFrom": "issue-comments",
    "rebuiltEvents": <applied event count> }
  ```
- 原子写入 `config/state/<alias>-<issue>.json`：写同目录临时文件 → `fs.renameSync`。
- `--dry-run`：打印摘要，不写文件。
- 标准输出摘要：`#<issue> rebuilt: events=<n> aliases=<alias> binding=<prNumber|none>
  ciHeadSha=<sha8|none> reviews=<n> mergedSha=<sha8|none>`。
- 失败时 exit 1，且不写出半成品 state（先完整折叠，再写）。

### 6.4 空评论 / 无状态块

- 评论为空或全部为 legacy：产出空 state（仅元数据），exit 0。**这不是成功恢复**，调用方
  应结合 `--dry-run` 摘要判断；门禁随后会因缺少绑定/CI/LGTM 而 fail-closed（安全）。

---

## 7. 完整性校验与威胁模型

| 威胁 | 控制 | 残余风险 |
|---|---|---|
| 普通贡献者伪造状态块 | 评论作者必须 ∈ 钉扎写侧 bot；否则 fail-closed | 无 |
| 伪造 audit footer / role 映射 | footer 与 envelope 逐字段相等；role→writer 映射硬钉 | 无 |
| 评论正文被编辑 | `body_sha256` 校验 | 同时重算摘要并替换块需写侧 bot 或仓库管理员权限 |
| 旧事件重放 | 确定性顺序；旧事件不能覆盖新事件 | 写侧 bot 重新发布旧事件会产生新顺序，视为新事件（bot 失陷） |
| 写侧 bot 失陷 | 超出本设计边界；GitHub audit log + Owner 撤销 installation | 残留，需运维响应 |
| 评论被删除 | 重建得到更旧状态；门禁因缺字段 fail-closed | 不可检测“曾经存在” |
| API 分页截断 / 乱序 | 完整分页 + 本地排序 | 网络中断 → fail-closed |
| 未知 schema 注入 | 精确版本匹配，未知 → fail-closed | 升级需新 schema（§8.2） |
| 仓库管理员篡改历史 | body_sha256 + GitHub audit log | 管理员为最高信任级，无法在本层完全防御 |

**明确不做**：v1 不使用 HMAC / 签名（会引入密钥分发与轮换，超出范围）。若 Owner 要求
更强完整性，可在 v2 用 App 私钥对 `event_id` 签名；本阶段不实现。

---

## 8. 并发、去重与兼容

### 8.1 Legacy 评论与“缺失块”

- 无 `issue-pilot-state:v1` 标记的评论：**忽略**（视为 schema v1 之前的历史评论）。
- 出现标记但载荷缺失字段 / Base64 非法 / JSON 非法 / footer 缺失：**fail-closed**。
- 同一评论出现 ≥2 个状态块：fail-closed。
- **理由**：#101/#109/#110 等历史评论没有状态块；若把“无块”也判失败，则任何旧 Issue
  都无法重建。该取舍需 Owner 在批准时确认（§11-4）。

### 8.2 版本与迁移

- `schema` 精确匹配 `issue-pilot/state@1`；未知版本 fail-closed（不尝试猜测）。
- 新增事件类型 / 字段语义变更 → `issue-pilot/state@2`；实现必须同时支持 v1 读取，
  或在迁移文档中明确一次性重建策略。
- 旧 state 文件无需迁移：重建直接覆盖可重建字段；读取方（`findPr/validReviewerLgtm/merge`）
  字段名不变。

### 8.3 并发写入

- 评论 append-only；两个窗口并发写不同事件：按 `(created_at, comment.id, event_id)` 排序，
  结果确定。
- 同 `review_id` 的并发 review：后序事件替换前序（与现 `review` 幂等语义一致）；若两条
  同 `review_id` 事件的 `reviewed_head_sha` 不同 → fail-closed（歧义）。
- 并发 `binding` 指向不同 PR：最新事件生效（与 `bind` 的“最新绑定”语义一致）；这不是
  歧义，而是显式重绑定。
- 同一排序键两条不同事件 / `event_id` 冲突 → fail-closed。

---

## 9. 写入协议（实现阶段契约）

1. 每个需要留痕的写操作，在**同一条**评论中写入可见正文 + 审计 footer + 状态块；
   不额外增加评论，避免评论数量翻倍。
2. 写评论前先计算 `body_sha256` 与 `event_id`；评论成功后再 `saveState`（保持现有
   “评论/state 先行”语义与幂等恢复规则；具体先后在实现阶段与现有异常处理对齐）。
3. 写操作失败（评论未写入）：不写 state；重试沿用现有幂等键（`review_id` / 绑定字段）。
4. `state rebuild` 只读评论，不写 GitHub。
5. 现有 `auditFooter` 格式保持不变；状态块只追加，不改变人类可读内容。

---

## 10. 验收与测试计划（实现阶段）

### 10.1 单元测试（`test/lib.test.mjs`）

1. 状态块提取：单块 / 无块 / 多块（fail）/ 非法 Base64 / 非法 JSON / 未知 schema。
2. 作者校验：非钉扎作者 / 作者与 `writer_login` 不符 / role→writer 映射不符。
3. footer 校验：缺失 / 字段不一致 / 多 footer。
4. `body_sha256`：正文被改 / 仅块变化 / CRLF 归一化 / 尾随空白。
5. `event_id`：稳定、去重、同 id 不同载荷 fail。
6. 排序：打乱 API 顺序、同一 `created_at` 用 `id` 决胜。
7. 折叠：binding 最新胜出；ci 失败不写 `ciHeadSha`；review 同 id 替换、不同 id 追加；
   merge/rework 字段语义；run/owner-transfer 覆盖。
8. legacy 评论忽略；空评论产出空 state。
9. 等价性：同一操作序列的现 state fixture 与折叠结果逐字段相等。
10. `--dry-run` 不写文件；写文件原子性（临时文件 + rename）。

### 10.2 演练 transcript（Phase 2，Owner 批准设计后）

1. 隔离 worktree / 空 `config/state/`。
2. 在 #109 或 #110 上重新执行幂等 `bind` 与 `ci`（会产生带状态块的新评论），并补一次
   reviewer LGTM（绑定当前 HEAD）。
3. 删除/移走本地 state；执行 `state rebuild <issue>`；对比重建前后 JSON（忽略
   `rebuiltAt/rebuiltFrom/rebuiltEvents`）。
4. 用重建后的 state 执行 `ci <issue>` 与 `merge <issue> --verdict rework`（不实际 merge），
   证明四门能读取 `prNumber / ciHeadSha / reviews / mergeLgtm`。
5. 将 transcript 附到 #122。

> 说明：历史评论没有状态块，v1 不回溯解析旧评论；演练通过“重新发出幂等事件”获得
> 带块评论。若 Owner 要求对既有历史做一次性回填，需另行授权（不在本设计内实现）。

### 10.3 不破坏现有测试

实现阶段 `node --test` 全绿；现有 79+ 项测试不得回归。

---

## 11. 待 Owner 批准的设计决策

| # | 决策 | 本文选择 | 备选 |
|---|---|---|---|
| 1 | 状态块载体 | 隐藏 HTML 注释 + 标准 Base64 单行 | 可见 fenced block；base64url |
| 2 | 完整性边界 | 作者钉扎 + footer 交叉校验 + `body_sha256` | 仅作者+footer；或增加 HMAC 签名（v2） |
| 3 | v1 生成块的命令 | `binding/ci/review/merge/run/owner-transfer` | 仅 `binding/ci/review/merge` |
| 4 | Legacy 评论 | 忽略（不解析、不判失败） | 无块即 fail-closed |
| 5 | 并发绑定冲突 | 最新事件生效 | 冲突 fail-closed |
| 6 | 重建输出 | 只写可重建字段 + 元数据 | 保留本地瞬态字段 |
| 7 | 重建命令形态 | `state rebuild <issue> [--dry-run]` | 独立脚本 / `state show` 组合 |

**Phase 1 完成定义**：Owner 对本文件 §11 全部决策明确批准（Issue 评论记录），之后才授权
Phase 2 代码实现；实现仍受 #122 原始验收与 STOP 条件约束。

---

## 12. 非目标（明确不做）

- 不做跨机器 state 同步服务 / 数据库 / 对象存储。
- 不做评论编辑、删除、回填历史（除非 Owner 另行授权）。
- 不做 App / 权限 / ruleset / workflow 变更。
- 不做 P2（gate exception 配置化）或 Future（human reviewer CLI 身份路径）。
- 不改变 `review` / `merge` 四门与 Solo Mode 的现有语义。
