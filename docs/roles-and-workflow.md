# Issue Pilot 角色与开发流程（同事版）

> 一句话：**Issue 是任务、讨论和决策的唯一载体；代码只通过 PR 合入 main。**

## 1. 三句话记住

1. **方案先批准**：Agent 提 candidate，Issue Owner 批准后，才能改代码。
2. **提交要复审**：代码实现完成后，必须由**未参与实现的 Reviewer** 审核；Reviewer 给 LGTM 才进入合并门。
3. **合入要 Owner**：merge 只能由 **Repo Owner** 执行；控制仓（issue-pilot）的 PR 还要求 **1 个 GitHub 正式 approval**（`protect-main` ruleset），产品仓（provenlattice）按 `provenlattice-main-protection` ruleset 只要求 CI 全绿（required approvals 0）；Issue 的 `review:lgtm` 标签不能代替 ruleset 要求。

## 2. 角色

| 角色 | 谁来做 | 主要职责 | 不能做什么 |
|---|---|---|---|
| Author（实现者 / Worker） | 实现 Agent | 认领 `need:author`；在独立 worktree 实现、测试、提交 PR | 不能自审、不能 merge、不能 approve 自己的方案 |
| Reviewer（独立复审） | 未参与实现的 Agent 或人 | 认领 `need:reviewer`；给出 LGTM / CHANGES / BLOCKED；核验 CI、Diff、范围 | 不能是实现者、不能 merge |
| Repo Owner（合并门） | 仓库 Owner（通常是你） | 唯一可以执行 merge；决定发布、版本、tag | 不能替 Author 实现、不能替 Reviewer 出独立 LGTM |
| Issue Owner（Issue 责任人） | Issue 的唯一 assignee | 负责 approve、verify、close 和方向决策 | 不能自审自己负责的 Issue；不能是同一 Issue 的实现者/Reviewer |
| Release Publisher（发布传输） | 发布 launcher / App | 只把发布分支推到控制仓 | 不参与 review、merge、标签或决策 |

**一共几个角色？**

- **3 个日常执行角色**：Author、Reviewer、Repo Owner。
- **1 个责任角色**：Issue Owner（每个 Issue 的唯一 assignee）。
- **1 个传输身份**：Release Publisher（只做发布分支 push）。

单人模式下，**Issue Owner 与 Repo Owner 通常是同一个人**；Author 与 Reviewer 必须是不同的人/Agent。

## 3. 一个 Issue 的完整流程

```text
Agent 提 candidate（五要素 + 查重）
  -> Issue Owner approve（need:issue-owner -> need:author）
  -> Author 在 D 盘独立 worktree 实现
  -> 提交 PR + CI 全绿
  -> 独立 Reviewer LGTM（need:reviewer -> need:repo-owner）
  -> Repo Owner 完成 ruleset 要求（控制仓：1 个正式 approval；产品仓：仅 CI 全绿）并执行 merge
  -> Issue Owner verify（记录合并后证据）
  -> close
```

状态与标签：

| 阶段 | 状态标签 | 下一步行动者 |
|---|---|---|
| 候选 / 待立项 | `status:candidate` | `need:issue-owner` |
| 已批准 / 实现中 | `status:approved` / `status:in-progress` | `need:author` |
| 待复审 | `status:in-review` | `need:reviewer` |
| 复审通过、待合并 | `status:in-review` + `review:lgtm` | `need:repo-owner` |
| 合并后验证 | `status:verifying` | `need:issue-owner` |
| 已验证 | `status:verified` | `need:issue-owner` |
| Review BLOCKED | 保持 review 流程（status 不变） | `need:reviewer` |
| Solo hold / 等决策 | `status:hold` | `need:issue-owner` |

每天先看自己的队列：

```bash
npm run pilot -- brief
```

每个 open Issue 恰好有一个 `need:*` 标签；不要手工堆多个。

## 4. 合入代码的两道门

1. **治理复审门**：独立 Reviewer 在 Issue 中留下 LGTM，绑定当前 PR HEAD SHA；实现者不能自审。
2. **GitHub 合并门**：控制仓（issue-pilot）由 `protect-main` ruleset 要求 PR 有 **1 个正式 GitHub PR approval** + CI `contract` success；产品仓（provenlattice）由 `provenlattice-main-protection` ruleset 要求 `test-windows` / `test-linux` / `linux-jdt-verify` 全绿（required approvals 0）；然后 Repo Owner 执行 merge。

注意：

- Issue 的 `review:lgtm` 标签 / Reviewer 的 Issue 评论 **不是** GitHub PR review，不能单独满足 ruleset。
- 如果 PR 作者是你自己的 GitHub 账号，GitHub 不允许你 approve 自己的 PR；需要第二名有写权限的 reviewer，或由 bot 创建 PR。
- 产品仓（如 `sunSUNQ/provenlattice`）有自己的 ruleset；`merge` 仍只限 Repo Owner 角色。

## 5. 必须遵守的边界

- 不直接 push `main`；所有代码走 PR。
- 不在未批准的 Issue 上修改产品代码；一个 Issue 一个 worktree。
- PR 必须关联控制仓 Issue；过程日志不要写进产品仓库。
- 不绕过 Hook / CI / ruleset；不修改 policy 来扩大 Agent 自身权限。
- 直接命令路径下 Agent 不得代替 Owner 执行 approve / merge / close；Solo Mode（ACTIVE 授权）在 AUTO 清单内的 approve/close 为已授权的委托路径，**merge 始终由 Repo Owner 执行**；Owner 的决策权不外包。
- GitHub 凭据一律经 `launchers/start-{worker,reviewer,owner}-agent.ps1` 注入；不要用个人 token 做控制面写操作。
- 所有临时文件和 worktree 放在 `D:\tasco-temp\issue-pilot\`。

## 6. 常见问题

**Q：Reviewer 说 LGTM 了，为什么还不能 merge？**
A：检查四件事：① ruleset 要求是否满足（控制仓：1 个正式 PR approval + `contract` CI；产品仓：`test-windows`/`test-linux`/`linux-jdt-verify` 全绿）；② PR HEAD 的 Required Checks 是否全绿；③ Issue 中的 LGTM 是否绑定当前 HEAD SHA、且无未解决的 CHANGES/BLOCKED；④ `gateAudit` 是否零命中（Owner Gate 文件）。任何一项不满足都不能 merge。

**Q：我是 Author，可以顺手 merge 吗？**
A：不可以。merge 只限 Repo Owner；Author 也不能 review 自己的 PR。

**Q：我是 Reviewer，可以改代码吗？**
A：不可以。Reviewer 必须独立于实现；需要修改时给 CHANGES，退回 Author。

**Q：Solo Mode 会自动 merge 吗？**
A：不会。当前实现到 merge 门即停，置 `need:repo-owner`，由 Repo Owner 决定。

**Q：Issue Owner 和 Repo Owner 有什么区别？**
A：Issue Owner 对单个 Issue 的生命周期负责（approve / verify / close）；Repo Owner 对仓库合并门负责（merge / 发布）。单人模式下可以是同一人，但同一 Issue 的 Reviewer 必须独立。

## 7. 需要 Owner 决策的事

- 合并、默认启用、发布、版本号、tag。
- 修改 ruleset / App 权限 / policy。
- 高风险或超出既定 policy 范围的改动。
- 新增或实质扩大生产能力契约。

详细规则以仓库根目录 `AGENTS.md` 和 `policies/` 下的 policy 为准。
