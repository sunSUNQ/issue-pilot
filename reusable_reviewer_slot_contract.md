# Reusable Reviewer Slot Contract

> Task: `ISSUE-PILOT-REUSABLE-WORKER-SLOT-DESIGN-V1` — Phase 0 (Design only)

## 0. Objective

The Reviewer may reuse **one fixed worktree** for many reviews without ever losing
independence. Independence is a property of *identity, input pinning, and environment
hygiene*, not of having a fresh directory per review.

## 1. Independence requirements (all mandatory)

| # | Requirement | Enforcement |
|---|---|---|
| 1 | Reviewer did **not** participate in implementation | Distinct GitHub App identity (§7) + review authored by that identity only |
| 2 | Reviews the **exact PR HEAD** (pinned SHA) | checkout `refs/pull/<n>/head` → record `reviewedSha`; compare to PR `headRefOid` |
| 3 | Reads code independently | fresh checkout of PR HEAD; no reuse of worker's working tree or index |
| 4 | Tests independently | run repo checks in the reviewer slot against the pinned SHA |
| 5 | Never reuses worker's uncommitted state | reviewer slot is always clean before checkout; worker worktrees are out of scope |
| 6 | Reviewer worktree always clean pre/post | `git status --porcelain` empty before and after each review |
| 7 | Review SHA is fixed | `reviewedSha` recorded at review time; immutable |
| 8 | New PR HEAD invalidates old review | `reviewedSha !== headRefOid` ⇒ prior LGTM void (already enforced by legacy `autoMerge`) |
| 9 | Reviewer never mutates the implementation branch | reviewer operates on a detached `refs/pull/<n>/head` or a temp review ref; no push, no commit to `issue-pilot/*` |

## 2. Review flow on the reused slot

```text
reviewer slot: AVAILABLE
   │  acquire (fetch origin, verify clean)
   ▼
fetch PR HEAD:  git fetch origin pull/<n>/head:<temp-review-ref>   (or checkout detached)
   ▼
git checkout --detach <reviewedSha>
   ▼
record reviewedSha = headRefOid   (compare; mismatch → ABORT, no verdict)
   ▼
independent read + independent test (repo checks on this slot)
   ▼
verdict:  LGTM(reviewedSha)  |  CHANGES(reviewedSha)
   ▼
reset:  git checkout origin/<base>  (or the slot's designated base ref)
        verify clean (status --porcelain empty)
        delete temp-review-ref
   ▼
reviewer slot: AVAILABLE
```

## 3. Why reuse does not compromise independence

- **Identity separation** is the real independence anchor. Today Owner and Reviewer
  share `pl-owner-reviewer[bot]` — the known gap (§7). V2 adds a distinct
  `pl-reviewer[bot]` App so "who reviewed" is auditable and disjoint from "who
  implemented" and "who merged".
- **Input pinning**: the review binds to `reviewedSha`, so a reused directory cannot
  silently review a moving target.
- **Environment hygiene**: the slot is verified clean before and after; the worker's
  uncommitted work never enters the reviewer's tree.

## 4. What the reviewer may NOT do

- push to any `issue-pilot/*` branch;
- commit, amend, or `merge` on the implementation branch;
- delete any branch or worktree;
- transition any worker-slot state;
- issue a verdict without a pinned `reviewedSha`;
- reuse a prior verdict after the PR HEAD moved.

## 5. Reviewer slot state machine (reduced)

```text
AVAILABLE ──acquire──▶ IN_USE ──reset(clean verified)──▶ AVAILABLE
                        │
                        └── reset fails (dirty/detached left) ──▶ DIRTY (human only)
```

`DIRTY` on the reviewer slot is terminal-until-human, exactly as for worker slots.

## 6. Verdict protocol

- `LGTM` / `CHANGES` only (no other verdicts, per the task's Reviewer Gate).
- Verdict comment must embed the pinned SHA (matches legacy `review` command format:
  `` 独立 review：LGTM，审查 commit `<sha>`. ``).
- LGTM sets `review:lgtm` + `need:owner`; CHANGES returns to `in-progress`/`need:author`.

## 7. Identity gap to close (blocking for V2)

- **Current:** no `start-reviewer-agent.ps1`. Reviews are authored by
  `pl-owner-reviewer[bot]` (App 5394867) — the same identity that merges as Owner.
- **Required for V2:** a `launchers/start-reviewer-agent.ps1` minting a dedicated
  `pl-reviewer[bot]` App (distinct App ID + installation), fail-closed, hard-pinned,
  with **no** merge/push privilege on the target repo beyond reading PRs and commenting.
- This is an `OWNER_DECISIONS_REQUIRED` item (provisioning a new GitHub App is a
  credential-infrastructure change only the Owner can perform).