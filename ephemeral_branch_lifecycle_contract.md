# Ephemeral Branch Lifecycle Contract

> Task: `ISSUE-PILOT-REUSABLE-WORKER-SLOT-DESIGN-V1` — Phase 0 (Design only)
> Defaults (recommended): `FORCE_PUSH = NO`, `DELETE_MERGED_REMOTE_BRANCH = YES`,
> `DELETE_MERGED_LOCAL_BRANCH = YES`.

## 0. Objective

Branches move from "permanent per-issue" to "temporary, tied to an open PR". A branch
may exist only while it is the delivery vehicle for an open PR. Once merged (or the PR
is otherwise resolved), the branch is deletable — automatically on merge, manually on
owner decision otherwise.

## 1. Lifecycle

```text
Issue approved
   │  (research/design-only?  →  NO branch, see §3)
   ▼
create ephemeral branch (on slot, off origin/<base>)
   │
   ▼
implement + commit locally
   │
   ▼
push only when code delivery actually exists (≥1 commit vs base)
   │
   ▼
open PR
   │
   ├──▶ merged ──▶ auto-delete remote branch ──▶ auto-delete local branch ──▶ reset slot
   │
   ├──▶ closed-unmerged ──▶ owner decides (delete or keep) ──▶ delete local branch ──▶ reset slot
   │
   ├──▶ superseded / replaced ──▶ close old PR, owner decides deletion
   │
   └──▶ failed / abandoned ──▶ owner decides; no auto-delete of an open PR's branch
```

## 2. Rules

1. **Push only on real delivery.** A branch is pushed only when `submit` verifies a
   clean worktree and ≥1 commit ahead of `origin/<base>` (this already exists in legacy
   `submit`). No empty-branch push.
2. **PR unmerged ⇒ branch must not be deleted.** Deletion of a branch whose PR is still
   `OPEN` is forbidden (remote and local). This is the primary anti-data-loss guard.
3. **Merged ⇒ auto-delete allowed.** `DELETE_MERGED_REMOTE_BRANCH = YES`: after
   `gh pr merge`, delete `origin/<branch>`. `DELETE_MERGED_LOCAL_BRANCH = YES`: delete
   the local branch after remote deletion succeeds (or after confirming merge state).
4. **Closed-but-unmerged ⇒ no auto-delete.** A `CLOSED` (unmerged) PR's branch requires
   an explicit Owner decision (the branch may still hold the only copy of unreviewed
   work). Only after owner sign-off is it deletable.
5. **Failed / superseded PR ⇒ owner decision.** Superseded PRs are closed and their
   branches are deletable only after the replacement is merged and owner confirms.
6. **Protected / main branches ⇒ never deleted.** `refs/heads/main`, default branch, and
   any branch-protection rule (`gh api repos/<r>/branches/<b>/protection`) block
   deletion unconditionally.
7. **Force push ⇒ NO.** `FORCE_PUSH = NO`. Amends/rewrites are done as new commits; a
   rewritten branch invalidates prior review SHA (already enforced by legacy
   `autoMerge`'s `state.head === PR head` check).

## 3. Research / design-only Issues — no branch

- `type:research` and `type:decision` Issues that produce only markdown/analysis and
  never touch product code **do not create a branch or a worktree**. Their deliverables
  are written to the control repo and referenced from the Issue (this is the pattern
  already used for FE-8 / SUB-07 research).
- `STOP` / `NO_CODE_CHANGE` outcomes are **zero-branch**: allowed and preferred. An
  Issue that concludes "no code change" leaves no branch, no PR, no worktree to clean.

## 4. Naming

`issue-pilot/<number>-<slugify(title)>` (slug ≤42 chars) — keep the existing scheme for
continuity. V2 does **not** change branch naming; it changes branch *lifetime*. Slots
are identified separately (`slots/<alias>-w<k>`), so branch and slot names never
collide.

## 5. Stale branch detection

A branch is "stale" iff **all** of:

- its PR (found via `gh pr list --head <branch> --state all`) is `MERGED` or `CLOSED`, and
- `git merge-base --is-ancestor <branch> origin/<base>` (merged), or
- explicit owner annotation marks it abandoned.

Detection is **read-only**; it only *recommends* deletion. Deletion always goes through
the slot cleanup path (§6), which re-verifies merge/ownership proof at delete time.

## 6. Deletion proof (ownership / merge-state / branch-state)

Every destructive `git push --delete` / `git branch -d` must be preceded by an asserted
proof record:

```text
ownership:  branch == slot.currentBranch == issue.<n>.branch
merge-state: gh pr view <pr> --json state → "MERGED"  (or owner-approved "CLOSED")
branch-state: git merge-base --is-ancestor <branch> origin/<base> (for merged)
protected:   branch ∉ {main, default, protected}
```

If **any** proof fails, the step aborts and the slot enters `RECOVERY_REQUIRED`. There
is no `git branch -D`, `git reset --hard`, or `git clean -fd` in the automated path.

> **Merge-strategy assumption.** The `--is-ancestor` + `git branch -d` proof is written
> for a **merge-commit** (`gh pr merge --merge`) strategy, which this repository's
> `autoMerge` uses today. Under a squash or rebase strategy the branch's commits are not
> ancestors of `origin/<base>`, so `--is-ancestor` fails — and the proof fails closed to
> `RECOVERY_REQUIRED` (safe: no data loss, but the branch is not auto-cleaned). If the
> merge strategy ever changes, this contract must be updated before automatic cleanup
> can resume.

## 7. Interplay with slot reset

Deleting the branch is part of `CLEANUP_PENDING → AVAILABLE`. Order:

1. assert merge-state proof (§6);
2. `git push origin --delete <branch>` (merged only);
3. `git branch -d <branch>` (safe-delete; fails if not merged — by design);
4. `git checkout origin/<base>` (or `git checkout <base>`) on the slot;
5. verify clean + HEAD == base;
6. mark slot `AVAILABLE`.

If step 3's `-d` (not `-D`) fails, the branch is treated as unmerged and the slot goes
to `RECOVERY_REQUIRED` for human inspection.