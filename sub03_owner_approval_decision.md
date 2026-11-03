# SUB-03 / R0 Owner Approval 决策记录

> 任务：`PL-SUB03-R0-SCHEMA-FREEZE-V1`（续：Owner 批准）
> 角色：Master Agent（记录 Owner 决策并落地状态转换，不承担功能编码）
> 日期：2026-11-03
> 决策主体：人类 Owner（sunSUNQ）

## 1. Owner 决策

**DECISION: APPROVED** —— 批准 SUB-03 开发 Evidence Schema V2 五块 additive adapter。

### 合同依据

- R0 Schema 冻结：`c102def`
- 后续准确性修正：`5d4fc48`
- 产品生产者事实基线：`4a7ff06`
- 权威合同：`cwe1123_v2_query_contract.md` §5

### 授权范围

1. 在每个 candidate 下新增完整的 `evidence_v2` 五块结构。
2. 仅装配 SUB-01/02/04/05 已产生的事实。
3. 允许在 `concurrency_profile.py` 中完成 #41 既有 edges/lock_facts 的最小生产 wiring。
4. 允许在 `evidence.py`、`defect_query.py`、`concurrency_profile.py` 及直接相关测试中进行实现。
5. 保持 `mechanism_facts` 独立，不修改其既有语义。

### 强制约束

- 不新增 CFG/DFG、alias、points-to 或其他分析算法。
- 不修改 #41 的 pair 排序、top-K、confidence。
- 不修改旧 `candidates/evidence_bundles` 的数量、顺序及已有字段。
- unknown 不得升级为 false 或 definite。
- 不扩展 CLI/MCP 参数面。
- 不触碰冻结合同中的 forbidden 文件。
- 无法满足旧 envelope 零回退时，STOP 并报告合同冲突。

### Review Gate

- 必须由未参与实现的独立 Reviewer 审查。
- Worker 自审不得计为有效 LGTM。
- CI 全绿、合同范围检查通过后，才提交 Owner Merge Gate。

### 授权状态

- `SUB03_IMPLEMENTATION_AUTHORIZED = YES`
- `TARGET_STATUS = approved`
- `TARGET_NEED = author`
- 本次授权不包含 #43–#47 的自动解锁。

## 2. 状态转换落地

- #39 → `status:approved / need:author`（CLI `approve`）。
- 该转换由 Owner 决策驱动，非 Master 自批；Master 仅记录并落地状态机转换，不启动 Worker、不创建实现 worktree、不提交功能 PR。

## 3. 边界声明

- #43（SUB-07/R2+R3）、#44（SUB-08/R7）、#45（SUB-09/R6）、#46（SUB-10/R8）、#47（SUB-11/R11）保持 `blocked`，不因本次授权自动解锁。
- 实现由 `need:author` 指向的 Worker 认领；独立 Reviewer 执行 Review Gate；Owner 执行 Merge Gate。
