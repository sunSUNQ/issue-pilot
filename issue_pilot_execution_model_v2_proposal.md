# Issue-Pilot Execution Model V2 — Proposal

> Task: `ISSUE-PILOT-REUSABLE-WORKER-SLOT-DESIGN-V1` — Phase 0 (Design only)
> Status target: `ISSUE_PILOT_EXECUTION_MODEL_V2_DESIGN_READY` ·
> `MODEL_SWITCH_AUTHORIZED = NO` · `SMOKE_AUTHORIZATION_REQUIRED = YES`

## 0. Abstract

Replace the legacy "one Issue → one permanent worktree + permanent branch" model with a
**reusable worker slot + ephemeral issue branch + independent reviewer slot + automatic
post-merge cleanup** model. The change is a **lifetime** change (branches/worktrees
become reusable/transient), not a correctness change to the Issue contract, the PR
contract, the Review/Merge/Verify/Close Gates, or the Owner/Reviewer/Worker role
isolation.

## 1. RECOMMENDED_MODEL

```text
HYBRID
  FAST-SERIAL (bug/maintenance, small diff) → reusable worker slot (2–4 slots)
  ISOLATED (high-risk / long-running / likely-conflicting) → dedicated worktree
  RESEARCH / DESIGN → no product worktree (zero-branch, zero-worktree)
```

Target throughput shape:

```text
~30 issues/day
2–4 reusable worker slots
1 reusable reviewer slot
1 main / Owner worktree
steady-state worktrees ≈ 4–6
remote branches ≈ active PR count
merged branches → automatically cleaned
```

Explicitly **not** `+30 worktrees/day` / `+30 branches/day`.

## 2. FILES_TO_CHANGE

All under the control repo `D:\issue-pilot\` (no product-repo changes):

| File | Change |
|---|---|
| `scripts/cli.mjs` | add `slot` command family (`slot status/acquire/release/recover`); make `run`/`submit` slot-aware behind `execution.model`; add post-merge remote-branch delete; add post-close local-branch delete + slot reset |
| `scripts/lib.mjs` | add `slotPath`/`slotState`/`saveSlotState`/`loadSlotState`; add `proofMerged()`/`proofBranchOwner()` helpers for §6 proof |
| `scripts/slots.mjs` (new) | slot state machine + transition guards + crash recovery logic |
| `config/repos.local.json` | add `execution.model` (`legacy` default), `slots` count, reviewer-slot designation |
| `config/state/slots/<slot>.json` (new, git-ignored) | per-slot state truth source |
| `launchers/start-reviewer-agent.ps1` (new) | distinct `pl-reviewer[bot]` App (closes the Owner/Reviewer identity-sharing gap) |
| `policies/solo-mode.md` / `policies/codegraph.md` | document slot model + guardrails + owner gates (Owner-only edit) |
| `AGENTS.md` | update execution discipline to reference slot lifecycle (Owner-only edit) |

**Not changed:** Issue state machine, PR contract, Review/Merge/Verify/Close Gates,
branch naming scheme, App-only token policy.

## 3. MIGRATION_STEPS

1. **Phase 0 (now):** design + inventory delivered and independently reviewed.
2. **Phase 1 Smoke (owner-authorized):** 2–3 full lifecycles on maintenance/test-repo/low-risk issues; prove reuse + auto-cleanup + fail-closed + crash recovery + reviewer independence.
3. **Phase 2 New-Issues-only:** `execution.model=slot` for new Issues; legacy stays legacy.
4. **Phase 3 Default:** `REUSABLE_SLOT=DEFAULT`, `DEDICATED_WORKTREE=EXCEPTION`.
5. Owner-provision `pl-reviewer[bot]` App + `start-reviewer-agent.ps1` before any Phase 1 review step.

## 4. SMOKE_PLAN

1. Provision test repo (or use a non-critical repo) + 2 worker slots + 1 reviewer slot.
2. Run a `maintenance` issue through `acquire → sync → branch → change → PR → review → merge → verify → cleanup → reuse`.
3. Assert: slot returns `AVAILABLE` clean; remote + local merged branch deleted; state files consistent.
4. Fault injection: (a) dirty the slot mid-run → expect `DIRTY` and no auto-reset; (b) kill worker mid-`SYNCING` → expect recoverable `RECOVERY_REQUIRED`/`RESERVED`; (c) mutate PR HEAD after review → expect old LGTM voided.
5. Reviewer independence: review authored by `pl-reviewer[bot]` (distinct identity) on pinned SHA.
6. Record evidence to Issue; STOP for Owner decision.

## 5. ROLLBACK_PLAN

Single config flip `execution.model = legacy`. Legacy `run`/`submit`/`review`/`verify`/
`close` remain intact and are never removed. Slot state files are ignored by the legacy
path; no data migration, no force operations. Slots are left idle or removed only by
Owner. Because the two models are additive (not a rewrite), rollback is immediate and
lossless.

## 6. KNOWN_RISKS

1. **Reviewer identity gap (blocking):** today Owner and Reviewer share
   `pl-owner-reviewer[bot]`. Until a distinct `pl-reviewer[bot]` App is provisioned,
   "independent review" is not auditable as independent. (Owner decision + new App.)
2. **Cleanup mis-deletion:** the highest-risk step. Mitigated by §6 proof (ownership +
   merge-state + branch-state + protected check) before any `push --delete`/`branch -d`,
   and `-d` (not `-D`) / no `reset --hard` / no `clean -fd` in automated paths.
3. **State-file ownership ambiguity:** current `provenlattice-43` research branches have
   no state file, so state is not a complete ledger today. Mitigation: V2 slot files are
   authoritative for slots; Phase 1 smoke starts on a clean test repo.
4. **Concurrent-slot races:** two workers could target the same repo. Mitigated by
   1:1 slot↔issue binding and acquire-before-mutate ordering.
5. **Windows worktree reuse:** linked-worktree metadata (`.git/worktrees/<name>`) and
   file locks are the main Windows risk; mitigated by verifying clean + HEAD==base before
   reuse, and by never deleting a slot's admin dir while it is checked out.
6. **Local `main` staleness:** the Owner worktree is currently 28 commits behind
   `origin/main` and dirty (`.venv/`). Slots must fast-forward from `origin/<base>`
   (remote truth), never from the local `main` worktree.
7. **Behavior drift in solo `autoMerge`:** cleanup is inserted into the merge/close path;
   a bug there could block the auto-pipeline. Mitigated by Phase-gated rollout + legacy
   fallback flag.

## 7. OWNER_DECISIONS_REQUIRED

1. Approve the HYBRID model (vs. pure fixed-slot or status quo).
2. Authorize Phase 1 Smoke (and name the test repo / low-risk issues).
3. Provision a **distinct `pl-reviewer[bot]` GitHub App** and `start-reviewer-agent.ps1`
   (credential-infrastructure change — Owner only).
4. Approve the post-merge auto-delete policy (`DELETE_MERGED_REMOTE_BRANCH=YES`,
   `DELETE_MERGED_LOCAL_BRANCH=YES`, `FORCE_PUSH=NO`).
5. Authorize cleanup of the **legacy** merged branches/worktrees inventoried in
   `legacy_branch_worktree_inventory.md` (not part of this task's execution; listed for
   decision).
6. Confirm `main` worktree sync strategy (fast-forward 28 commits; disposition of
   `.venv/`).

## 8. Final state

```text
ISSUE_PILOT_EXECUTION_MODEL_V2_DESIGN_READY
MODEL_SWITCH_AUTHORIZED = NO
SMOKE_AUTHORIZATION_REQUIRED = YES
```

Design and independent review complete → **STOP**, awaiting Owner decision on Phase 1.