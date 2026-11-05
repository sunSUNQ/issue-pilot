# Reusable Worker Slot — State Machine

> Task: `ISSUE-PILOT-REUSABLE-WORKER-SLOT-DESIGN-V1` — Phase 0 (Design only)

## 0. Purpose

A **slot** is a fixed, reusable checkout directory (worktree) that processes many
Issues sequentially. Its state machine is the single source of truth for "can this slot
be reused, and by whom". State is persisted to
`config/state/slots/<slot>.json` (git-ignored, machine-local), and every transition is
recorded with a timestamp + actor + evidence so a crashed worker can never leave an
ambiguous slot.

The Issue itself keeps its own state file (`config/state/<alias>-<n>.json`) — the slot
file references the issue, never replaces the issue's contract.

## 1. States

| State | Meaning |
|---|---|
| `AVAILABLE` | Slot is clean, on `origin/<base>`, bound to no Issue. Can be acquired. |
| `RESERVED` | Slot is claimed by a Worker for a specific Issue, but not yet synced/active. |
| `SYNCING` | Worker is running `git fetch` + fast-forward-only sync to `origin/<base>` (checkout base + fast-forward; no `reset`) on the slot. |
| `ACTIVE` | Worker is executing an Issue on the slot (branch checked out, may be dirty). |
| `WAITING_FOR_PR` | Worker pushed the branch and opened the PR; slot no longer needed for code, but branch is alive. |
| `WAITING_FOR_REVIEW` | PR under independent review; slot is not the review environment (that's the Reviewer slot). |
| `CLEANUP_PENDING` | Issue merged/closed; slot is queued for reset (branch delete + checkout base + verify clean). |
| `DIRTY` | Slot has uncommitted/untracked/staged/detached state that must be resolved by a human/owner. |
| `RECOVERY_REQUIRED` | A prior transition failed or a crash left the slot inconsistent; requires the `recover` command (not auto-reset). |

`WAITING_FOR_PR` and `WAITING_FOR_REVIEW` are *Issue* states expressed on the slot for
auditability, but the key invariant is: **from the moment a branch is pushed, the slot
may be released for reuse, because the branch (not the worktree) is the delivery
vehicle.**

## 2. Transitions and who may perform them

Legend: `W` = Worker, `R` = Reviewer (no slot mutations), `O` = Owner, `CLI` = automatic
deterministic step, `HC` = human/owner-only (hold).

```text
                 acquire(W, issue bound)
AVAILABLE ───────────────────────────────▶ RESERVED
    ▲                                        │
    │                                        │ sync(W)
    │                                        ▼
    │                                     SYNCING
    │                                        │ success(CLI)
    │                                        ▼
    │                                     ACTIVE ──▶ DIRTY (detected uncommitted/foreign state)
    │                                        │
    │   release-to-PR(W after push+PR)       │
    │                                        ▼
    │        ┌───────────────────── WAITING_FOR_PR ──▶ (review happens on Reviewer slot)
    │        │                               │
    │        │   PR merged/closed (CLI after merge/close)   release(W after push/PR)
    │        │                               ▼              │
    │        │                        CLEANUP_PENDING ◀─────┘
    │        │                               │
    │        │   reset ok (CLI: delete branch, checkout base, clean)   reset fail (CLI)
    │        │                               │                              │
    │        └───────────────────────────────┴──────────────────────────────┤
    │                                                                        ▼
    └────────────────────────── AVAILABLE ◀──────────────────── RECOVERY_REQUIRED (recover cmd only)
```

### Allowed transitions (who may trigger)

| From | To | Who | Guard |
|---|---|---|---|
| `AVAILABLE` | `RESERVED` | W | slot not already reserved; issue approved; slot recorded as bound to issue |
| `RESERVED` | `SYNCING` | W | slot bound to exactly one issue |
| `SYNCING` | `ACTIVE` | CLI | sync succeeded AND worktree is clean AND HEAD == `origin/<base>` |
| `SYNCING` | `RECOVERY_REQUIRED` | CLI | sync failed (network, lock, merge conflict from stray commit) |
| `ACTIVE` | `WAITING_FOR_PR` | W | `status --porcelain` clean AND ≥1 commit vs base AND push + PR open |
| `ACTIVE` | `DIRTY` | CLI | clean check fails OR foreign branch/untracked detected |
| `WAITING_FOR_PR` | `CLEANUP_PENDING` | CLI | PR state == MERGED or CLOSED (verified via `gh pr view`) |
| `WAITING_FOR_PR` | `ACTIVE` | W | reviewer requested changes; worker re-acquires slot to amend (re-checkout branch) |
| `CLEANUP_PENDING` | `AVAILABLE` | CLI | branch deleted (local + remote if merged) AND worktree clean AND HEAD == base |
| `CLEANUP_PENDING` | `RECOVERY_REQUIRED` | CLI | any destructive step lacked proof, or checkout/clean failed |
| `DIRTY` | `AVAILABLE` / `RECOVERY_REQUIRED` | HC | **human/owner only** — never auto-reset |
| `RECOVERY_REQUIRED` | `AVAILABLE` | HC (via `recover`) | recover records explicit ownership proof |

## 3. Acquire conditions (all must hold)

1. Slot state is `AVAILABLE`.
2. Slot worktree is **clean** (`git status --porcelain` empty) and HEAD == `origin/<base>`.
3. Slot is not bound to any *open* Issue (slot file's `issue` field empty or that issue closed).
4. The Issue being acquired is `status:approved` and `need:author`.
5. No other slot in the same repo is already bound to this Issue (slot-to-issue is 1:1).
6. Acquire writes `{slot, issue, branch, acquiredAt, actor}` **before** any git mutation,
   so a crash at any later point leaves a traceable `RESERVED` record.

## 4. When a slot must NOT be reused

- Any of: state `DIRTY` or `RECOVERY_REQUIRED`.
- `git status --porcelain` non-empty (uncommitted or untracked files).
- Staged changes exist (`git diff --cached` non-empty).
- HEAD is detached.
- A previous Issue's branch is still checked out and its PR is still `OPEN`.
- The slot file disagrees with on-disk reality (e.g. file says `AVAILABLE` but `status`
  shows a checked-out branch).

## 5. Crash recovery (Worker died mid-run)

Because acquire is idempotent and every transition persists state *before* mutating git,
recovery is deterministic:

- Crash in `SYNCING` → slot is `SYNCING` with an issue bound; `recover` re-runs the
  sync and re-verifies cleanliness, then continues to `ACTIVE` (or fails to
  `RECOVERY_REQUIRED` if the worktree diverged).
- Crash in `ACTIVE` (uncommitted work present) → slot state reflects the issue it was
  working; `recover` reports "uncommitted work for issue #n" and moves to `DIRTY`
  (human decision: commit or discard). **Never auto-discards.**
- Crash after push+PR but before `release` → PR exists; `recover` re-derives
  `WAITING_FOR_PR` from `gh pr view --head <branch>`.
- Crash after merge before cleanup → `recover` sees PR MERGED and re-runs cleanup.

## 6. Dirty worktree → fail closed

`DIRTY` is a **terminal-until-human** state. No CLI command may reset a `DIRTY` slot.
The only exit is a human/owner run of `recover` with an explicit disposition
(`commit-as-<sha>` / `discard-after-owner-review` / `keep-as-branch`), each of which
writes an audit entry. This directly implements the guardrail:

```text
dirty worktree            → STOP
unexpected branch         → STOP
uncommitted changes       → STOP
slot bound to another Issue → STOP
```

## 7. Untracked / staged / detached handling

| Condition | Detection | Disposition |
|---|---|---|
| untracked files | `git status --porcelain` has `??` | slot not reusable → `DIRTY`; `recover` lists them, never deletes |
| staged changes | `git diff --cached --name-only` non-empty | slot not reusable → `DIRTY` |
| detached HEAD | `git symbolic-ref -q HEAD` fails | slot not reusable → `DIRTY` (or `RECOVERY_REQUIRED` if mid-transition) |

## 8. Slot ↔ Issue binding

- The slot file records `{ slot, repoAlias, issue, branch, prUrl, prNumber, state,
  updatedAt, actor }`.
- Binding is **1:1 and monotonic within a repo**: an Issue maps to at most one slot at
  a time; a slot maps to at most one *open* Issue at a time.
- The slot records current `branch`, `prNumber`, `issue number` so any cleanup step can
  assert "this branch belongs to this issue, and that issue's PR is merged" before
  deleting.

## 9. Reviewer slot (separate, read-only w.r.t. slots)

The Reviewer slot is **not** a worker slot. It has a reduced two-state machine
(`AVAILABLE` / `IN_USE`) and is governed by `reusable_reviewer_slot_contract.md`. The
Reviewer never transitions worker-slot state and never deletes branches/worktrees.

## 10. State file truth source

- Per-issue truth: `config/state/<alias>-<n>.json` (unchanged from legacy).
- Per-slot truth: `config/state/slots/<slot>.json` (new).
- Guard: a mutation may only proceed if **both** files agree (issue file's `slot` field
  matches slot file's `issue` field). Mismatch → `RECOVERY_REQUIRED`, never auto-heal.

This dual-entry design eliminates the "state file is single source of truth vs
double-write race" risk called out in the reviewer gate: writes are sequenced by the CLI
process (one process mutates one slot at a time), and cross-file agreement is verified
before any destructive step.