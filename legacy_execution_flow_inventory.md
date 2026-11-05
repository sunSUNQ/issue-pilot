# Legacy Execution Flow Inventory

> Task: `ISSUE-PILOT-REUSABLE-WORKER-SLOT-DESIGN-V1` — Phase 0 (Design only)
> Scope: `CURRENT_EXECUTION_MODEL = LEGACY_PER_ISSUE_WORKTREE`
> Method: read-only source inspection of `D:\issue-pilot\scripts\cli.mjs`,
> `scripts\lib.mjs`, `launchers\*.ps1`, `scripts\pl-token.mjs`, plus `git worktree list`,
> `git branch -a`, `git ls-remote`, and `gh pr list` (no writes, no deletions).

## 0. Summary of the core problem

The current execution model realises "one Issue → one permanent worktree + one
permanent branch". Every stage of the lifecycle writes new state but **no stage ever
deletes a branch or worktree**. The result is unbounded growth:

- worktree count and local/remote branch count grow monotonically with Issue count;
- mixed state (some worktrees detached, some branch-bound, some dirty) accumulates;
- no recovery path exists for an interrupted or failed run;
- no locking prevents two workers from racing on the same repository.

Trying to scale this to ~30 issues/day is the motivation for the V2 reusable-slot
model. This inventory documents exactly where each behaviour lives so the migration
plan can enumerate every touchpoint.

## 1. Command / script / module → behaviour map

Notation: `startRun`/`submit`/… are functions in `scripts/cli.mjs`; `worktreePath`,
`statePath`, `saveState`/`loadState`, `run`/`runShell`, `slugify` are in
`scripts/lib.mjs`.

| # | Stage | Command / module | Current behavior | State written | Cleanup behavior | Migration impact |
|---|-------|------------------|------------------|---------------|------------------|------------------|
| 1 | Run (start) | `pilot run <n>` → `startRun` (cli.mjs:188) | Gate `status:approved`. Resolve `repo:` label → alias. `target = worktreePath()` = `<worktreeRoot>/<alias>-<n>`. Fail if path exists. `branch = issue-pilot/<n>-<slugify(title)>`. `git -C <repo.path> worktree add -b <branch> <target> origin/<base>`. Set `in-progress`/`need:author`. Comment. | GitHub labels (`status:in-progress`, `need:author`); git branch + worktree on disk; issue comment | **none** — worktree and branch are permanent | Replaced by "slot acquire" (reuse a fixed worktree instead of creating one per issue) |
| 2 | Branch creation | inside `startRun` (cli.mjs:197-200) | `issue-pilot/<n>-<slug>` (slug ≤42 chars, from title). Created off `origin/<base>` or `<base>`. | local branch ref | **none** | Branch becomes ephemeral (created at acquire, deleted after merge) |
| 3 | Worktree creation | `git worktree add` inside `startRun` | `git worktree add -b <branch> <target> <start>` | linked worktree + admin dir `.git/worktrees/<name>` | **none** | Fixed slots replace per-issue worktrees |
| 4 | Worktree path naming | `worktreePath` (lib.mjs:205) | `<worktreeRoot>/<alias>-<number>` (absolute, D-drive enforced by `ensurePathOnD`) | filesystem | **none** | Slot naming `<worktreeRoot>/slots/<alias>-w<k>` instead of per-issue |
| 5 | State file | `statePath`/`saveState`/`loadState` (lib.mjs:224-240) | `<root>/config/state/<alias>-<n>.json`. `saveState` shallow-merges patch, writes `updatedAt`. `loadState` returns `{}` if absent. Git-ignored (`config/state/`). | JSON keyed per issue: `prUrl,head,branch,submittedAt,reviewUrl,reviewedSha,mergedSha,mergedAt,gates,reviewChangesCount,ciFailCount,verifiedAt,autoApproveBlock` | **never deleted** (state files accumulate per issue) | State becomes dual: per-issue contract state (unchanged) + per-slot state (`config/state/slots/<slot>.json`) |
| 6 | Worker launcher | `launchers/start-worker-agent.ps1` | Mints App token (App 5394857, inst 173364328, bot `pl-issue-worker[bot]`), fail-closed; injects `GH_TOKEN`, `GIT_ASKPASS`, `GIT_CONFIG_GLOBAL`, `PL_ENFORCE_APP=1`. No credential on disk beyond PEM path. | in-memory env only; trace in runtime dir | **none** | Worker acquires a slot instead of a fresh worktree |
| 7 | Reviewer launcher | **none exists** | Reviewer is realized via `start-owner-agent.ps1` (App 5394867, bot `pl-owner-reviewer[bot]`). Owner and Reviewer **share one App identity**. | in-memory env only | **none** | V2 requires a `start-reviewer-agent.ps1` with a distinct App identity to preserve independence |
| 8 | PR creation | `pilot submit <n>` → `submit` (cli.mjs:208) | Requires worktree exists + clean (`status --porcelain` empty) + ≥1 commit vs base. Runs `repo.checks`. `git push -u origin <branch>`. `gh pr create --base <base> --head <branch>`. Set `in-review`/`need:reviewer`. `saveState(prUrl,head,branch,submittedAt)`. | labels + state file + GitHub PR | **none** | Push only happens at submit (code delivery actually exists), matching ephemeral-branch contract |
| 9 | Review | `pilot review <n> --verdict --sha` → `review` (cli.mjs:250) | Gate `status:in-review`. Comment. `lgtm` → label `review:lgtm`, `need:owner`, `saveState(reviewUrl,reviewedSha)`. `changes` → `in-progress`/`need:author`, `reviewChangesCount++`, hold at ≥2. | labels + state file + comment | **none** | Review SHA must be pinned to PR HEAD (already is); manual review only |
| 10 | Merge | Solo-only `autoMerge` (cli.mjs:444); no standalone `pilot merge` | Requires open PR, `state.head === PR head`, `reviewedSha === PR head` (else "new commit invalidates review"), CI green, gate-audit clean. `gh pr merge --merge`. Set `verifying`/`need:author`. `saveState(mergedSha,…)`. Owner also merges manually via `gh pr merge`. | labels + state file + merge commit | **none** — remote/local branch left behind** | Critical cleanup insertion point (merge is when remote branch should be deleted) |
| 11 | Verify | `pilot verify <n> --evidence-file` → `verify` (cli.mjs:279) | Gate `review:lgtm` (actually `review:lgtm` label). Post evidence comment. Set `verified`/`need:owner`. | labels + comment | **none** | — |
| 12 | Close | `pilot close <n> --summary-file` → `closeIssue` (cli.mjs:292) | Gate `status:verified`. Post summary. Clear `need:` (null). `gh issue close --reason completed`. | labels + comment | **none — branch/worktree still present** | Critical cleanup insertion point (close is when local branch + slot reset happen) |
| 13 | Branch cleanup | **does not exist** (grep: `git branch -d/-D`, `push --delete`, `worktree remove`, `worktree prune` — 0 matches) | — | — | **absent** | Must be added in V2 |
| 14 | Worktree cleanup | **does not exist** | — | — | **absent** | Must be added in V2 |
| 15 | Interrupted/failed run recovery | **does not exist** | No watchdog, no "re-run", no "abort". A crashed worker leaves the worktree + branch + `in-progress` label exactly as-is. | — | **absent** | V2 needs RECOVERY_REQUIRED state + `recover` command |
| 16 | Concurrent Issue handling | implicit only | Two workers could `run` the same issue; second `run` fails only because `worktreePath` already exists (`fs.existsSync(target)`). No cross-repo lock, no slot arbitration. | — | **absent** | V2 slot table is the arbitration point |

## 2. State-file schema (observed)

`config/state/<alias>-<n>.json` (git-ignored, local-only). Fields seen in practice
(example `provenlattice-46.json`): `prUrl`, `head`, `branch`, `submittedAt`,
`updatedAt`, `reviewUrl`, `reviewedSha`, `mergedSha`, `mergedAt`, `gates`.
Additional fields written by `submit`/`review`/solo paths: `reviewChangesCount`,
`ciFailCount`, `verifiedAt`, `autoApproveBlock`, `prUrl`.

Key property for V2: state files are **per-issue** and are the only machine-local
record that connects an Issue to its branch/PR/SHA. There is currently **no per-slot
state file**, so slot ownership cannot today be established from state — this is a
hard STOP condition for naive cleanup and the reason the inventory-only deliverable
must not delete anything.

## 3. Identity / auth model (relevant to Reviewer independence)

- Owner: `pl-owner-reviewer[bot]` (GitHub App 5394867, installation 173364423).
- Worker: `pl-issue-worker[bot]` (GitHub App 5394857, installation 173364328).
- Reviewer: **no distinct App**. Review comments are authored by
  `pl-owner-reviewer[bot]` (Owner+Reviewer shared identity). A reviewer that is the
  same GitHub identity as the owner cannot be auditable as "independent" — the single
  most important gap for V2's `reusable_reviewer_slot_contract`.
- `pl-renew.ps1` re-mints a token for the *current* session's role; it does not switch
  roles. Identity is hard-pinned in each launcher (no role parameter).

## 4. Cleanup-relevant inventory of the codebase

Grep across `scripts\*.mjs` for destructive Git operations returned **zero** matches
for: `worktree remove`, `worktree prune`, `branch -D`, `branch -d`, `branch --delete`,
`push --delete`, `git clean`, `reset --hard`.

Conclusion: there is no accidental cleanup path today. All cleanup must be **new code**
introduced with ownership/merge-state/branch-state proof, as the V2 contracts specify.

## 5. Migration impact summary

1. `run` → replaced by `run` on a reusable slot (acquire → sync → branch → execute).
2. `submit` → unchanged in shape (push + PR), but slot must then release *execution*
   ownership while keeping the branch alive.
3. `merge` (solo `autoMerge` + owner manual path) → gains a **post-merge remote
   branch deletion** step gated on merge-state.
4. `close` → gains **local branch deletion + slot reset + slot release** steps.
5. New `slots` state file + `recover` command + `cleanup` command must be added.
6. New `start-reviewer-agent.ps1` (distinct App) must be added.