# Governance V2 — 最终一致性核查报告

> 任务：GOVERNANCE-V2-FINAL-CONSISTENCY-REPAIR
> 状态：设计交付物，供 Master 最终批准。
> 边界：仅修订 governance-v2 设计文档；不创建 App、不修改 Token/Launcher/CLI、不修改 Rulesets/Branch Protection、不开 Strict Mode。

---

## 一、8 项问题修复状态

| # | 问题 | 级别 | 状态 | 落点 |
|---|---|---|---|---|
| 1 | R7 身份定义逻辑矛盾 | P0 | ✅ 已修复 | design.md §4；reviewer-bot-design §4；acceptance-matrix R7-3/R7-4 |
| 2 | Reviewer App 权限模型不成立 | P0 | ✅ 已修复（方案 B 双 App） | reviewer-bot-design §1/§2 |
| 3 | Required Checks 数据结构未闭环 | P0 | ✅ 已修复（Check Run / Commit Status / BP checks 三分） | design.md §6 |
| 4 | 标签反向清理缺失 | P1 | ✅ 已补充 | design.md §5-8；E29 |
| 5 | Review 幂等恢复定义 | P1 | ✅ 已补充（review_id + 幂等 key + 并发确定性） | design.md §5-19；E26/E27/T21 |
| 6 | strict checks 描述校正 | P1 | ✅ 已校正 | design.md §0 |
| 7 | Assignee 路由 vs 身份授权 | 治理澄清 | ✅ 已澄清 | reviewer-bot-design §4 |
| 8 | Launcher 信任边界 | 治理澄清 | ✅ 已澄清 | reviewer-bot-design §4 |

---

## 二、四份文档交叉一致性

| 检查项 | design.md | reviewer-bot-design.md | acceptance-matrix.md | revision-notes.md | 一致 |
|---|---|---|---|---|---|
| R7-3 兼任复审仅记录 | §4 约束3 | §4 角色矩阵 | R7-3 | ✅ 记录 | ✅ |
| R7-4 专用 Reviewer 必要条件 | §4 约束4 | §4 身份校验 | R7-4 | ✅ 记录 | ✅ |
| 审查资格 × merge 有效性矩阵 | §4 | §4 | R7 节 | ✅ 记录 | ✅ |
| 身份校验通用+角色专属 | — | §4 | R7 节 | ✅ 记录 | ✅ |
| App 方案 B 双 App | — | §1/§2 | 边界第1条 | ✅ 记录 | ✅ |
| Check Run / Commit Status 三分 | §6 | — | G10 | ✅ 记录 | ✅ |
| 标签转换表（设置/清除） | §5-8 | §5 职责边界 | G8/E29 | ✅ 记录 | ✅ |
| review_id 幂等 key | §5-19 | §5 输出 | G9/E26/T21 | ✅ 记录 | ✅ |
| strict checks 描述校正 | §0 | — | — | ✅ 记录 | ✅ |
| Assignee 路由 ≠ 身份授权 | §4 决策④ | §4 澄清 | — | ✅ 记录 | ✅ |
| E29 存在 | §7 | — | E29 | ✅ 记录 | ✅ |

---

## 三、P0 矛盾消除验证

1. **R7 身份矛盾**：R7-3 与 R7-4 现在分别表述「兼任资格」与「有效 LGTM 必要条件」，不再互相冲突；身份校验从「单一五重」拆为「通用 + 角色专属」，Owner Launcher 用 owner 硬钉配置即可通过通用校验 + owner 专属校验，不复用 reviewer 配置。
2. **App 权限矛盾**：§2 不再使用「逐仓库权限」描述，改为方案 B 双 App；读 App 对产品仓零写权限、写 App 只写控制仓评论，边界自洽。
3. **Required Checks 矛盾**：§6 匹配逻辑拆为 Check Run（`name/status/conclusion/app.id`）与 Commit Status（`context/state`）两套，无字段混用；BP 兼容补 `checks` 数组。

---

## 四、遗留风险与待办（冻结后由 Master / Repo Owner 处置）

1. **双 App 落地成本**：方案 B 需创建两个 App、两套安装、双 token 管理，Launcher 与 CLI 实现复杂度高于单 App；本报告只锁设计，不执行创建。
2. **产品仓 Issue 残余写能力**：方案 B 下读 App 已无 Issues 权限，写 App 只装 issue-pilot，产品仓在权限层零写；但写 App 若被误装到产品仓仍需治理审计兜底。
3. **Assignee 身份级强制隔离**：决策④明确「不做硬 ACL」，approve/verify/close 仅路由校验，不证明执行者身份；需更强隔离时另行设计。
4. **strict checks 置 true**：仍由 Repo Owner 执行（纵深防御），非 SHA 绑定实现。

---

## 五、红线遵守声明

本轮仅修订 `design.md`、`reviewer-bot-design.md`、`revision-notes.md`、`acceptance-matrix.md` 四个设计交付物，并新增本报告与 SHA256 清单。**未**创建 App、**未**生成/修改 Token、**未**修改任何 Launcher、**未**修改 `scripts/cli.mjs`、**未**修改 Rulesets/Branch Protection、**未**开启 Strict Mode。

---

## 六、最终冻结建议

8 项问题全部处置完毕，四份文档交叉一致，验收矩阵闭环（G1–G10 / R1–R5 / R7 约束 + 审查资格矩阵 / E1–E29 / T1–T22）。建议 Master 正式冻结 Governance V2，随后转交 Repo Owner 执行基础设施（双 App 创建 + Launcher + 安装核验），再单独授权 CLI 实现，端到端验收后开 Strict Mode。