# SUB-03 Owner Approval Readiness

Issue：#39 / SUB-03 / R0

状态：`READY_FOR_OWNER_APPROVAL`；`SUB03_IMPLEMENTATION_AUTHORIZED = false`。

## 1. Dependency audit

| Gate | 结果 | 证据 |
|---|---|---|
| SUB-01 / #37 | SATISFIED | verified + closed；PR #46 merge `7a6d602` |
| SUB-02 / #38 | SATISFIED | verified + closed；PR #45 merge `855b498` |
| SUB-04 / #40 | SATISFIED | verified + closed；PR #48 merge `2abe216` |
| SUB-05 / #41 | SATISFIED | verified + closed；PR #49 merge `4a7ff06` |
| SUB-06 / #42（边界核对） | SATISFIED | verified + closed；PR #47 merge `562c12a`；`mechanism_facts` 与五块独立 |
| R0 五块 Schema | SATISFIED | `cwe1123_v2_query_contract.md` §5 = FROZEN |
| 未解决字段冲突 | NONE | 见 `sub03_r0_schema_freeze_decision.md` §5 |

`SUB03_DEPENDENCIES_SATISFIED = true`。

## 2. Owner approval checklist

人类 Owner 批准前应确认：

- [ ] 接受 `candidate.evidence_v2` 与五块恒在规则。
- [ ] 接受 `analysis_kind` / confidence 分离及保守映射。
- [ ] 接受 #39 只做 adapter + production wiring，不新增分析。
- [ ] 接受 #39 不二次排序/截断 #41 pair，不新增 CLI/MCP top-K 参数。
- [ ] 接受 `mechanism_facts` 独立顶层边界。
- [ ] 接受 owned/forbidden 文件与最小测试集合。
- [ ] 通过 Issue Pilot 治理流程亲自执行 approve。

## 3. Ready marker

```text
R0_SCHEMA_FROZEN=true
SCHEMA_CONFLICTS=0
SUB03_DEPENDENCIES_SATISFIED=true
SUB03_READY_FOR_OWNER_APPROVAL=true
SUB03_IMPLEMENTATION_AUTHORIZED=false
FINAL_VERDICT=READY_FOR_OWNER_APPROVAL
```

## 4. Contract commit

合同 commit 在冻结文件提交后记录到 Issue #39 评论；该评论必须同时声明 Master 未执行 approve。
