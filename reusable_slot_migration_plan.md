# Reusable Slot Migration Plan

> Task: `ISSUE-PILOT-REUSABLE-WORKER-SLOT-DESIGN-V1` — Phase 0 (Design only)
> `MODEL_SWITCH_AUTHORIZED = NO` · `PRODUCTION_MIGRATION_AUTHORIZED = NO` ·
> `CURRENT_ACTIVE_ISSUE_MIGRATION = NO`

## 0. Principles

- Legacy Issues **stay legacy**. No in-flight Issue, branch, or worktree is migrated.
- New model applies only to **newly-started** Issues, and only after explicit Owner
  authorization per phase.
- Every phase is gated; a failed gate rolls the phase back, not forward.
- No destructive cleanup without ownership/merge-state/branch-state proof.

## 1. Phase 0 — Design only (this task)

```text
MODEL_SWITCH_AUTHORIZED = NO
```

Deliverables: the 7 documents of this task. Exit state:
`ISSUE_PILOT_EXECUTION_MODEL_V2_DESIGN_READY`, `SMOKE_AUTHORIZATION_REQUIRED = YES`.
No code change, no run-flow change, no cleanup performed.

## 2. Phase 1 — Smoke (explicit Owner authorization required)

Only low-risk targets:

- `maintenance` Issues;
- a test repo;
- non-critical paths;
- or Owner-named low-risk Issues.

Must complete **2–3 full lifecycles** end-to-end:

```text
slot acquire → sync → branch → change → PR → review → merge → verify → cleanup → slot reuse
```

Acceptance criteria:

- the same slot is reused across ≥2 issues and returns to `AVAILABLE` clean each time;
- remote + local merged branches are deleted automatically;
- a deliberately-dirtied slot fails closed (`DIRTY`) and is **not** auto-reset;
- a simulated crash mid-run leaves a recoverable `RESERVED`/`SYNCING`/`ACTIVE` record;
- reviewer independence holds (distinct identity, pinned SHA) on the reused reviewer slot.

Exit gate: Owner reviews the smoke evidence and authorizes Phase 2, or rolls back.

## 3. Phase 2 — New Issues only

```text
new Issues → REUSABLE_SLOT
existing Issues → legacy stays legacy (no mid-flight migration)
```

- `run` gains a `--slot` / auto-slot-allocation path; the legacy `run` path remains
  available behind a config flag (`execution.model = legacy | slot`).
- Both models coexist; the switch is per-*new*-Issue, not per-repo, to avoid
  retroactively touching active work.

## 4. Phase 3 — Default

After Phase 2 proves stable over a continuous run:

```text
REUSABLE_SLOT   = DEFAULT
DEDICATED_WORKTREE = EXCEPTION  (high-risk / long-running / parallel-conflict issues)
```

## 5. Worktree model decision (A / B / C)

| Axis | A. one-issue-per-worktree | B. fixed worker slot (all issues) | C. **Hybrid (recommended)** |
|---|---|---|---|
| Isolation | strongest | weakest | adequate for fast-serial; dedicated for risky |
| Concurrency | parallel by default | limited by slot count (2–4) | 2–4 fast-serial + on-demand dedicated |
| Cleanup cost | highest (grows with issue count) | lowest | low (fast-serial) + bounded (dedicated exceptions) |
| Crash recovery | none today | centralized, deterministic | centralized for slots; manual for dedicated |
| Reviewer independence | by fresh dir | must be enforced by identity+pinning | enforced by identity+pinning (reviewer slot) |
| Windows FS cost | high (many linked worktrees) | minimal | minimal steady-state |
| Git complexity | low per-issue, high aggregate | moderate (slot discipline) | moderate |
| ~30 issues/day | +30 worktrees/day ✗ | ✓ (bounded) | ✓ (bounded) |

**Recommendation: C (Hybrid)** —

```text
FAST-SERIAL (bug/maintenance, small diffs) → reusable worker slot
ISOLATED (high-risk, long-running, likely-conflicting) → dedicated worktree
RESEARCH / DESIGN → no product worktree (zero-branch, zero-worktree)
```

Rationale: B alone is too rigid for genuinely conflicting parallel work and loses the
safety of a private directory for high-risk changes; A alone cannot scale. C keeps the
common case bounded (~4–6 worktrees) while preserving an escape hatch for the rare
case, and matches the task's expected default.

## 6. Safety guardrails (enforced, not advisory)

```text
dirty worktree                 → STOP (DIRTY)
unexpected branch              → STOP (DIRTY / RECOVERY_REQUIRED)
uncommitted changes (prev issue)→ STOP
slot bound to another Issue    → STOP (acquire denied)
PR branch still open           → 不删除 (no branch delete)
remote branch not merged       → 不自动删除
protected branch               → 永不删除
main branch                    → 永不删除
review SHA mismatch            → review invalid (no merge)
failed cleanup                 → slot = RECOVERY_REQUIRED
```

Forbidden in automated cleanup:

```text
git reset --hard
git clean -fd
git branch -D
git push --delete (without merged/ownership proof)
```

## 7. Rollback

At any phase, revert `execution.model` to `legacy`. Because the two models coexist and
legacy `run` is never removed, rollback is a single config flip with **zero data
migration**. Existing slot state files are simply ignored by the legacy path. Slots can
be left idle (or owner-approved removal) — never force-removed.

## 8. STOP conditions (from task)

Stop immediately if any of:

- migrating a current active Issue is required;
- destructive cleanup is required to complete the design;
- state files cannot reliably establish worktree ownership;
- reusable slots would break independent review;
- force push is required;
- existing Merge/Close Owner Gates must change;
- existing branch/worktree state shows high-risk inconsistency.

The inventory (deliverable 2) found **one** inconsistency (research branches for #43
with no `provenlattice-43.json` state file) — it does **not** block the design because
it involves research artifacts (not in-flight implementation), but it is flagged for
Owner and means Phase 1 smoke must start on a clean test repo, not on the current
ProvenLattice checkout.