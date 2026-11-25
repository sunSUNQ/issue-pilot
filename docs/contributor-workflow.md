# Contributor Workflow — 人类 fork / PR 贡献指南

> 状态：**P1 文档（可立即使用）— 完整外部 Fork PR 演练待 P0（#122）完成后执行**
> 父 Issue：`sunSUNQ/issue-pilot#113`（Decision Record，D1-A / D4-A）
> 本 Issue：`sunSUNQ/issue-pilot#123`
> 适用对象：人类贡献者（不同 OS、标准 Git/GitHub），**不需要 Issue Pilot / launcher / bot / App 权限**
> 适用范围：**仅产品仓**（如 `sunSUNQ/provenlattice`、`sunSUNQ/tasco-dev`）；控制仓 `sunSUNQ/issue-pilot` 仍由 Owner / agent 使用

---

## 1. 角色

| 角色 | 做什么 | 运行 Issue Pilot？ |
|---|---|---|
| Contributor（人类） | fork、写代码、跑本地测试、提交上游 PR | 否 |
| Maintainer（Worker agent / Owner） | 在控制仓 Issue 上 `bind` 外部 PR、跑 `ci` | 是（launcher 会话） |
| Independent Reviewer | 对绑定 HEAD 给出独立 LGTM | 是（reviewer launcher） |
| Owner | 最终 merge 门；不得由 Agent 代替 | 是（owner launcher） |

**关键原则**：贡献者只使用标准 Git / GitHub；控制仓的角色、App、launcher 与状态管理
不暴露给贡献者，也不要求贡献者持有。

---

## 2. 流程总览

```text
控制仓 Issue（candidate → approved）
        │
Contributor: fork 产品仓 → 分支实现 → 本地测试 → 向上游 main 提交 PR
        │  PR 正文引用：Refs sunSUNQ/issue-pilot#<issue>
        ▼
Maintainer: bind <issue> --pr <PR> --branch <head> --base main --sha <HEAD>
        │
        ▼
Maintainer: ci <issue>                  # Required Checks @ HEAD 全绿
        │
        ▼
Independent Reviewer: review <issue> --verdict lgtm --sha <HEAD>
        │
        ▼
Owner: merge <issue> --verdict merge    # 四门重检后合并
```

---

## 3. Contributor：fork 与提交 PR

### 3.1 前置条件

- 一个 GitHub 账号；对目标产品仓**不需要** write 权限（外部贡献者通过 fork）。
- 本地安装 Git；能运行目标仓库自己的测试命令。
- 目标产品仓（例如 `sunSUNQ/provenlattice`）公开可读。

### 3.2 步骤

1. **Fork** 目标产品仓到自己的账号（GitHub UI：Fork）。
2. **克隆自己的 fork** 并添加上游：

   ```bash
   git clone https://github.com/<you>/<repo>.git
   cd <repo>
   git remote add upstream https://github.com/sunSUNQ/<repo>.git
   git fetch upstream
   ```

3. **从上游 main 开分支**：

   ```bash
   git checkout -b <type>/<short-description> upstream/main
   ```

4. **实现 + 本地验证**：按目标仓库的 `AGENTS.md` / README 执行测试与静态检查；
   不要降低既有检查换取通过。

5. **提交并推送到自己的 fork**：

   ```bash
   git add <files>
   git commit -m "<type>(<scope>): <summary>"
   git push -u origin <branch>
   ```

6. **向上游 `main` 提交 PR**（GitHub UI 或 `gh pr create`）：

   ```bash
   gh pr create --repo sunSUNQ/<repo> --base main --head <you>:<branch> \
     --title "<type>(<scope>): <summary>" \
     --body-file <pr-body.md>
   ```

   PR 正文必须包含对控制仓 Issue 的引用（不写 `Closes`，避免绕过治理门禁）：

   ```markdown
   Refs sunSUNQ/issue-pilot#<issue>
   ```

### 3.3 PR 内容要求

- 变更范围与 Issue 的「允许修改范围」一致；超出范围需先回 Issue 讨论。
- 不提交凭据、令牌、私钥、本机绝对路径。
- 不修改 `.github/workflows/**`、ruleset、仓库权限（这些属于 Owner Gate）。
- 说明测试层级与证据（命令 + 结果）。

---

## 4. Maintainer：绑定与 CI

外部 fork PR 不经过 `submit`（`submit` 只用于控制仓/产品仓内部 author 分支）。
Maintainer 在**控制仓 Issue** 上显式绑定：

```bash
npm run pilot -- bind <issue> \
  --pr <PR_NUMBER> \
  --branch <HEAD_BRANCH> \
  --base main \
  --sha <HEAD_SHA>
```

字段来源（以 GitHub API 为准，不手工猜）：

```bash
gh pr view <PR_NUMBER> --repo sunSUNQ/<repo> \
  --json number,state,headRefName,headRefOid,baseRefName,url
```

- `--pr`：PR 号
- `--branch`：PR 的 `headRefName`（fork 分支名，不含 `owner:` 前缀）
- `--sha`：PR 的 `headRefOid`（当前 HEAD）
- `--base`：`main`

`bind` 会 fail-closed 校验 repository / number / base / branch / SHA；PR 必须 OPEN。
绑定成功后，Issue 上会留下带审计 footer 的绑定评论与本地 state 绑定记录。

随后执行 CI 门禁：

```bash
npm run pilot -- ci <issue>
```

以 `sunSUNQ/provenlattice` 为例，Required Checks 为：

- `test-windows`
- `test-linux`
- `linux-jdt-verify`

三项必须在绑定 HEAD 上全部 `success`；否则 fail-closed，Issue 回到 `need:author`，
贡献者推送修复后 **HEAD 改变 → 需重新 `bind` + `ci`**。

---

## 5. Independent Review

- Reviewer 必须是**未参与实现**的 Agent 或人；PR 作者不得自审。
- Reviewer 在 reviewer launcher 会话执行：

  ```bash
  npm run pilot -- review <issue> --verdict lgtm --sha <HEAD_SHA>
  ```

- LGTM 绑定 `--sha` 与 PR 当前 head；HEAD 变化后旧 LGTM 自动失效。
- `changes` → Issue 回到 `need:author`，贡献者修复后重新走 `bind`/`ci`/`review`。
- Reviewer 不得修改贡献者的分支、不得直接 approve GitHub PR。

---

## 6. Owner Merge

- 只有 Owner（人类）可在 owner launcher 会话执行 merge；Agent 不得代替。
- 合并前 CLI 重检四门：PR head == 已审 SHA、Required Checks@head 全绿、
  有效 reviewer LGTM、Owner Gate 文件零命中。

  ```bash
  npm run pilot -- merge <issue> --verdict merge
  ```

- `sunSUNQ/provenlattice` 的 ruleset `provenlattice-main-protection` 当前
  `required_approving_review_count=0`；治理层仍要求独立 Reviewer LGTM 与 Owner merge 门，
  二者不可绕过。
- 若 Owner 需要 GitHub 正式 approval，可请第二名有 write 权限的人类在 PR 上 Approve；
  这不替代治理层 LGTM。

---

## 7. 贡献者不应该做的事

- ❌ 不运行 Issue Pilot 命令（`propose / approve / run / bind / ci / review / merge / verify / close`）。
- ❌ 不请求 bot / App / launcher / 控制仓写权限。
- ❌ 不修改控制仓 `sunSUNQ/issue-pilot`（Issue、评论、标签、state）。
- ❌ 不修改 ruleset / workflow / 仓库权限 / Secrets。
- ❌ 不在 PR 中自批或绕过 Owner merge 门。
- ❌ 不把过程日志、临时文件或本机路径提交到产品仓。

---

## 8. 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| `bind` 报 PR 不属于仓库 | PR URL 与目标仓库不一致 | 确认 `--repo`/PR 号指向产品仓 |
| `bind` 报 HEAD 不符 | PR 在绑定后又有新 commit | 用最新 `headRefOid` 重新 `bind` |
| `bind` 报 base 不符 | PR base 不是 `main` | 改基或按实际 base 绑定（治理默认 `main`） |
| `ci` 报 Required Checks 未全绿 | 检查缺失 / 未完成 / 非 success | 修复后推送；HEAD 变化后重新 `bind` |
| `review` 报无 `ciHeadSha` / SHA 不符 | ci 未跑或 HEAD 已变 | 重新 `ci`，再以新 SHA review |
| 多个开放 PR 指向同一 Issue | 绑定/推断歧义 | 只保留一个开放 PR，其余关闭；显式 `bind` |
| PR 来自 fork，CI 访问不到 Secrets | GitHub fork PR 安全限制 | 不要依赖 Secrets；需要时由 Owner 在受控分支验证 |

---

## 9. 收尾

- 合并后删除 fork 上的功能分支，避免残留远端分支。
- 控制仓 Issue 的 `verify` / `close` 由 Owner 按治理流程执行；贡献者无需操作。
- 若演练/贡献过程中发现 CLI 缺陷（如外部 fork PR `bind` 不兼容），**停止并记录**，
  由 Owner 决定另开 bug Issue；不在本流程内扩大实现范围。

---

## 10. P0 依赖与演练记录

- 本文档可立即用于日常贡献流程。
- **完整外部 Fork PR 演练**（`bind` → `ci` → 独立 LGTM → Owner merge / merge 门证据）
  必须在 P0 State Rebuild（#122）完成并通过验收后执行；在此之前不得声明 P1 完成。
- 演练完成后在本节追加：
  - PR 链接、HEAD SHA、Required Checks 结果、Reviewer LGTM、Owner merge/门禁证据；
  - 空 `config/state` + `state rebuild` 后复跑关键步骤的 transcript；
  - 残留分支/PR 清理记录。

### 演练记录（待填）

```text
（P0 完成后填写）
```

---

## 11. 安全边界

- 贡献者不需要、也不会获得控制面凭据；控制面写权限仅存在于角色 launcher。
- 审计链：控制仓评论 footer 记录 role / principal / writer_login / repository / operation；
  P0 完成后还会附带可重建的隐藏状态块。
- 任何要求贡献者提供 token、私钥或安装 App 的流程都应视为异常并拒绝。
