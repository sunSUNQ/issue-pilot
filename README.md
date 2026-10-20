# Issue Pilot

Issue Pilot 是一个面向个人研发的、由 Owner 掌舵的 Agent 协作控制平面。Agent 可以
主动发现问题、提出 Issue、在批准后创建隔离 worktree、实现并提交 PR；Owner 保留
批准、合并、默认启用和发布权。

它不进入 TASCO 或 CodeGraph 的运行时。它只管理研发流程。

## 核心流程

```text
Agent evidence
  -> candidate Issue
  -> owner approval
  -> D: isolated worktree
  -> implementation + required gates
  -> product PR
  -> independent review
  -> owner merge
  -> verified + close
```

## 环境要求

- Node.js >= 22.18
- Git
- GitHub CLI `gh`；支持 `gh auth` 或 Git Credential Manager 中已有的 GitHub 登录
- Windows 上存在 `D:\tasco-temp\`；所有 worktree 和临时产物都写 D 盘

不需要安装 npm 依赖。

当 `gh` 自身 token 过期、但 Git push 仍可用时，CLI 会从 Git Credential Manager
读取当前 GitHub 凭据，仅注入当前 `gh` 子进程；不会打印或写入仓库配置。

## 首次启用

```powershell
Copy-Item config/repos.example.json config/repos.local.json
# 编辑本机路径与 GitHub 仓库名
npm test
npm run pilot -- doctor
npm run pilot -- setup
npm run pilot -- repo list
```

`config/repos.local.json` 不提交，用于保存本机绝对路径。稳定政策位于 `policies/`。

接入第二个仓库时不需要改代码：

```powershell
npm run pilot -- repo add codegraph --path D:\codegraph --github sunSUNQ/codegraph --base main --policy codegraph
npm run pilot -- setup
```

## 明天即可使用的工作流

### 1. Agent 查重并提出候选

```powershell
npm run pilot -- search "telemetry schema"
npm run pilot -- propose --repo tasco --type bug --title "修复 telemetry schema 漂移" --body-file D:\tasco-temp\issue-pilot\proposal.md
```

Issue 初始状态始终为 `status:candidate`。

### 2. Owner 审查并批准

```powershell
npm run pilot -- approve 12
```

`approve` 是人类 Owner 命令。Agent 协议明确禁止自行批准。

### 3. Agent 开始隔离开发

```powershell
npm run pilot -- run 12
```

命令会根据 `repo:tasco` 或 `repo:codegraph` 创建：

```text
D:\tasco-temp\issue-pilot\worktrees\tasco-12
```

### 4. 实现、commit、提交 PR

```powershell
npm run pilot -- submit 12
```

它会拒绝脏 worktree、无 commit 的分支和未通过配置检查的提交，然后 push 分支、
创建产品 PR，并把链接写回控制 Issue。

### 5. 独立 Review

```powershell
npm run pilot -- review 12 --verdict lgtm --sha abc1234
# 或
npm run pilot -- review 12 --verdict changes --sha abc1234
```

新的 commit 会使旧 review 失去事实基础，应重新 review。

### 6. 合并后验证并关闭

```powershell
npm run pilot -- verify 12 --evidence-file D:\tasco-temp\issue-pilot\verification.md
npm run pilot -- close 12 --summary-file D:\tasco-temp\issue-pilot\summary.md
```

## 命令

| 命令 | 作用 |
|---|---|
| `doctor` | 检查 Node、Git、gh、认证、仓库路径和 D 盘约束 |
| `setup` | 在控制仓库创建/更新状态、类型和仓库 labels |
| `brief` | 按状态列出开放 Issue |
| `search` | 创建前查重 |
| `repo list/add` | 查看或注册产品仓库 |
| `propose` | 创建 candidate Issue |
| `approve` | Owner 批准开发 |
| `run` | 创建隔离 worktree 和分支 |
| `submit` | 执行 checks、push 并创建产品 PR |
| `review` | 记录独立 review 结论与 commit |
| `verify` | 记录合并后的验证证据，进入 verified |
| `close` | 写入总结并关闭 Issue |

## TASCO 与 CodeGraph 的隔离

- TASCO 遵循 [`policies/tasco.md`](policies/tasco.md)：研究假设可由 Agent 提出，
  但实验、边界变化、默认启用和发布必须由 Owner 批准。
- CodeGraph 遵循 [`policies/codegraph.md`](policies/codegraph.md)：确定性工程可获得
  更高自治，但 graph 生成和 TASCO 消费必须是不同 Issue/PR。
- 跨仓集成用一个控制 Issue 拆成 producer、consumer、qualification、A/B 四个依赖项。

## 安全设计

- 控制仓库默认设为 private。
- 本机配置被 `.gitignore` 排除。
- worktree 固定在 D 盘，代码中带有 D 盘路径守卫。
- 不提供自动 merge、自动 release 或自动修改默认开关的命令。
- GitHub Action 要求控制仓库 PR 保留 Issue 引用与验证部分。
