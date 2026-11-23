# Governance V2 — 交付物 SHA256 清单

> 任务：GOVERNANCE-V2-FINAL-CONSISTENCY-REPAIR
> 生成时间：2026-11-20（本地）
> 说明：以下为冻结版本 5 个内容文件的 SHA-256 校验值，供 Master 核验文件完整性。

```
850603fbb89658e02e6b8c6fd1df967abd8f07a279e13daf4520788f6dbade5f  design.md
9fb3db7b81dde8ef4e852c55c28d88e9ff2ffe0fc41cfa57451e16fe9615708e  reviewer-bot-design.md
315d13a611417d55a2d9ae81b21b8198ece2bf70fb322eb170c728d29243d35f  revision-notes.md
bed750483721e939bd2f964e00906e3674c108b5d5499965193906bea5468fea  acceptance-matrix.md
a81340697a4c04137415ebfd00a48368166dc786b12b3f01e193bafd5c91c7ad  consistency-report.md
```

## 文件清单

| # | 文件 | 作用 |
|---|---|---|
| 1 | design.md | CI Gate & Merge Gate 设计包（§0–§9） |
| 2 | reviewer-bot-design.md | Reviewer Bot 身份/权限/Launcher/Review Contract（方案 B 双 App） |
| 3 | revision-notes.md | 五项合同修订 + Final Contract Review 补充 + CONSISTENCY-REPAIR 修复记录 |
| 4 | acceptance-matrix.md | G1–G10 / R1–R5 / R7 + 审查资格矩阵 / E1–E29 / T1–T22 |
| 5 | consistency-report.md | 最终一致性核查报告（8 项修复状态 + 交叉一致性） |

> 校验命令（PowerShell）：`Get-FileHash -Algorithm SHA256 -LiteralPath <path>`
