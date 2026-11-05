# Legacy Branch / Worktree Inventory

> Task: `ISSUE-PILOT-REUSABLE-WORKER-SLOT-DESIGN-V1` — Phase 0 (Design only)
> Method: **read-only**. `git worktree list --porcelain`, `git branch -a`,
> `git branch --merged origin/main`, `git ls-remote --heads origin`,
> `gh pr list --state all`. **No branch or worktree was deleted.**
> Snapshot date: 2026-11-05.

## 0. One-line verdict

The ProvenLattice main checkout currently holds **17 worktrees** (1 main + 16 linked)
and **~54 remote branches** (32 `issue-pilot/*`), almost all of which correspond to
already-**merged** PRs. None has ever been cleaned up. Steady-state for the V2 model
should be ~4–6 worktrees and remote branches ≈ active PR count (currently 0 open PRs),
so the cleanup delta is roughly **11–13 worktrees and ~32 remote branches** — but this
task only *inventories* and *recommends*; it deletes nothing.

## 1. Worktrees (ProvenLattice main checkout: `D:\tasco-temp\issue-pilot\customer-trial-provenlattice-main`)

| # | Worktree path | HEAD (short) | Branch / state | PR | Issue | Cleanliness |
|---|---|---|---|---|---|---|
| 0 | `customer-trial-provenlattice-main` (main) | `b6e6566` | `main` (behind `origin/main` by **28**) | — | — | **dirty** (`?? .venv/`) |
| 1 | `worktrees/provenlattice-37` | `81a1781` | branch `issue-pilot/37…` | #46 MERGED | closed | clean |
| 2 | `worktrees/provenlattice-38` | `f66cab5` | branch `issue-pilot/38…` | #45 MERGED | closed | clean |
| 3 | `worktrees/provenlattice-39` | `f4feb4f` | **detached** @ merged branch 39 tip | #50 MERGED | closed | clean |
| 4 | `worktrees/provenlattice-40` | `8f4d962` | **detached** @ merged branch 40 tip | #48 MERGED | closed | clean |
| 5 | `worktrees/provenlattice-42` | `dd7b0ea` | branch `issue-pilot/42…` | #47 MERGED | closed | clean |
| 6 | `worktrees/provenlattice-43-a2` | `d7bd38b` | branch `issue-pilot/43…a2-spike` | — (research spike) | #43 | clean |
| 7 | `worktrees/provenlattice-44` | `13b564f` | branch `issue-pilot/44…` | #57 MERGED | closed | clean |
| 8 | `worktrees/provenlattice-45` | `dbeedd0` | branch `issue-pilot/45…` (tip == main, **0 commits**) | — | #45 **in-progress** | **dirty** (`M analysis.py`, `M sparsecfg.py`, `?? scripts/`) |
| 9 | `worktrees/provenlattice-46` | `de006ef` | **detached** @ merge commit | #52 MERGED | closed | clean |
| 10 | `worktrees/provenlattice-46-probe` | `7647ade` | **detached** (probe on top of 39) | — | probe artifact | clean |
| 11 | `worktrees/provenlattice-48` | `11b0b98` | **detached** @ merged branch 48 tip | #53 MERGED | closed | clean |
| 12 | `worktrees/provenlattice-49` | `1d173d9` | **detached** @ merged branch 49 tip | #51 MERGED | closed | clean |
| 13 | `worktrees/provenlattice-51` | `d930c64` | branch `issue-pilot/51…` | #54 MERGED | closed | clean |
| 14 | `worktrees/provenlattice-52` | `f9c595c` | branch `issue-pilot/52…` | #55 MERGED | closed | clean |
| 15 | `worktrees/provenlattice-53` | `52bed93` | branch `issue-pilot/53…` | #56 MERGED | closed | clean |
| 16 | `worktrees/provenlattice-sub07-a1` | `953811d` | branch `issue-pilot/43-a1b-carry` | — (research) | #43 | clean |

**Totals:** 17 worktrees (1 main + 16 linked). Of 16 linked: **12** map to merged
PRs, **2** to research/spike artifacts of closed issue #43, **1** to an in-progress
issue (#45), **1** to a probe artifact. **6 are detached HEAD.**

## 2. Local branches (`git branch`)

| Class | Branches | Count |
|---|---|---|
| Truly merged into `origin/main` (deliverables) | 37, 38, 39, 40, 42, 44, 46, 48, 49, 51, 52, 53 | 12 |
| In-progress, tip == main, **uncommitted work present** | 45 | 1 |
| Local-only research/spike (never pushed) | 43-a1b-carry, 43-a2-spike | 2 |
| `main` | main (28 behind origin) | 1 |
| **Total local branches** | | **16** |

Note: branch `issue-pilot/45…` currently points **exactly at `origin/main`**
(`dbeedd0`) because the worker created the worktree but has not committed yet. It is
therefore *technically* "merged" per `git branch --merged`, but semantically it is an
**in-flight branch with uncommitted work and must never be treated as stale**. This is
exactly the class of mistake the V2 cleanup guardrails must prevent.

## 3. Remote branches (`git ls-remote --heads origin`)

| Class | Count | Detail |
|---|---|---|
| `issue-pilot/*` | **32** | 31 map to MERGED PRs; 1 (`issue-pilot/12-maintenance-release-1-6-0-dev0`) maps to PR #18 **CLOSED (unmerged)** |
| non-`issue-pilot/*` | ~22 | `feat/java-*`, `fix/*`, `docs/*`, `release/*`, `engineering/*`, `reconcile/*`, `v1.4-*`, `archive/pr1-full-merge`, `experiment/context-bundle`, `lkb`, `pl-r16-t4-verify`, `main` |
| **Total remote heads** | **~54** | |

All 32 `issue-pilot/*` remote branches are **stale** (their PRs are merged or closed).
Not a single merged remote branch has been deleted.

## 4. Dangling / inconsistent refs

- `remotes/origin/pr50` appears in local `git branch -a` but has **no corresponding
  `refs/heads/pr50` on origin** — a stale remote-tracking ref (needs `git fetch --prune`
  or explicit `git branch -r -d origin/pr50`).

## 5. State-file vs branch consistency

`config/state/` holds **30 `.json`** files (17 `codegraph-*`, 13 `provenlattice-*`) plus
`-evidence.md` / `-summary.md` companions. The `provenlattice-*.json` set covers issues
37–53 with gaps: there is **no state file for #43** (research concluded without a
tracked `provenlattice-43.json`), even though two local research branches
(`43-a1b-carry`, `43-a2-spike`) and two worktrees exist. This is the one concrete
"branch exists but state file missing" inconsistency observed — a reminder that state
files cannot today be treated as a complete ownership ledger.

## 6. Other checkouts (same logical repo / related)

- `codegraph` alias (`D:\ChatGPT\codegraph`) also maps to `sunSUNQ/provenlattice` and
  holds **~24 additional worktrees** (non-issue-pilot Java branches, mostly under
  `C:\Users\sunqinghw\AppData\Local\Temp\opencode\*`). These predate the issue-pilot
  solo-mode rollout and are a separate concern from per-issue worktree sprawl.
- `tasco` alias (`C:\Users\sunqinghw\Documents\hook迁移agent`) maps to
  `sunSUNQ/tasco-dev`; an earlier probe returned "Repository not found", suggesting the
  remote may have been renamed/deleted. Flag for Owner.

## 7. Cleanup recommendations (no action taken — owner decision required)

Ordered by safety (all require owner sign-off before any deletion):

1. **Merged + branch-bound worktrees** (37, 38, 42, 44, 51, 52, 53): after confirming
   merge state, `git worktree remove <path>` + `git branch -d <branch>`.
2. **Merged + detached worktrees** (39, 40, 46, 48, 49): delete the still-present local
   merged branches (`git branch -d`) and `git worktree remove` the detached worktrees.
3. **Probe artifact** (`46-probe`): `git worktree remove` (holds no unique state).
4. **Research artifacts** (`43-a2`, `sub07-a1`): owner decides whether to keep spike
   work; otherwise `git worktree remove` + `git branch -d` the two local-only branches.
5. **In-progress** (`45`): **do not touch** — uncommitted work for open issue #45.
6. **Remote `issue-pilot/*` branches (32)**: after owner confirms, `git push origin
   --delete` for the 31 merged + 1 closed-unmerged (largest single cleanup win).
7. **Stale `remotes/origin/pr50`**: `git fetch --prune` (or delete the ref).
8. **`main` worktree**: `git fetch` + fast-forward to `origin/main` (28 commits behind),
   and owner decides on the untracked `.venv/`. **No `reset --hard` without owner.**

**Target after cleanup:** ~3 worktrees (main + #45 + owner-chosen research holdover),
0 stale `issue-pilot/*` remote branches, ~2 local branches. This matches the V2
steady-state target (~4–6 worktrees, remote branches ≈ active PR count).