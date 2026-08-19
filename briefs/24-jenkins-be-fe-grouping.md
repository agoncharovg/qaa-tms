# Brief 24 — Jenkins tree: group each env into BE / FE subtrees from two roots

Follow `CONVENTIONS.md` (StrEnum/union-literal constants in the dedicated
modules, English UI text, ruff+mypy / eslint+tsc clean, API under `/api/v1`).
Builds on the Jenkins plugin (briefs 17/21/22/23).

## Problem

Today the tree is fetched from a single root `job/.QAA/job/E2E` and shows its
env folders `PREPROD` and `PROD` directly. We now need each env to contain two
labelled groups pointing at **two** Jenkins roots:

```
PREPROD                                   (grouping node — synthetic)
  ├─ BE  → job/.QAA/job/E2E/job/PREPROD    (real Jenkins folder)
  └─ FE  → job/.QAA/job/UI_E2E/job/PREPROD (real Jenkins folder)
PROD
  ├─ BE  → job/.QAA/job/E2E/job/PROD
  └─ FE  → job/.QAA/job/UI_E2E/job/PROD
```

So there are now **two source roots** — `.QAA/E2E` (BE) and `.QAA/UI_E2E` (FE) —
sharing the same env folders, presented grouped by env.

### Decisions (locked in)

- **Env nodes (`PREPROD`/`PROD`) are grouping-only, synthetic.** No freeze / pin /
  open on them. Freeze/pin/open stay on the **BE/FE** nodes (which are the real
  Jenkins env folders) and anything below. The single-folder freeze model
  (briefs 22/23) is unchanged — a freeze/resume/campaign still targets one real
  folder path (e.g. `job/.QAA/job/E2E/job/PREPROD`).
- **Configurable group list.** New env var
  `AGENT_JENKINS_ROOT_GROUPS = "BE=job/.QAA/job/E2E,FE=job/.QAA/job/UI_E2E"`
  (comma-separated `label=rootPath`), defaulting to exactly this. `PREPROD`/`PROD`
  stay in `AGENT_JENKINS_ROOT_FOLDERS` and are the **shared env folders** looked
  up under every group root.

Three parts: A (agent — the real work), B (backend cache schema — tiny), C
(frontend — render + guard synthetic nodes).

---

## Part A — Agent: two roots, synthetic env→group composition

### Config + constants

`agent/app/core/constants.py`:
- Replace `DEFAULT_JENKINS_ROOT_PATH` usage with
  `DEFAULT_JENKINS_ROOT_GROUPS = ("BE=job/.QAA/job/E2E", "FE=job/.QAA/job/UI_E2E")`
  (keep the old constant only if something still needs it; otherwise remove).
  Keep `DEFAULT_JENKINS_ROOT_FOLDERS = ("PREPROD", "PROD")`.
- `EnvKey.JENKINS_ROOT_GROUPS = "AGENT_JENKINS_ROOT_GROUPS"`.
- `GROUP_LABEL_SEPARATOR = "="` and `GROUP_LIST_SEPARATOR = ","`.

`agent/app/core/config.py`:
- Add a small value type `JenkinsRootGroup` (pydantic model or dataclass)
  `{ label: str, path: str }`. Add
  `jenkins_root_groups: Annotated[list[JenkinsRootGroup], NoDecode]`
  (alias `AGENT_JENKINS_ROOT_GROUPS`), parsed by a `mode="before"` validator that
  splits on `,` then `=` (mirror `parse_jenkins_root_folders`), normalizing each
  `path` the way `normalize_jenkins_root_path` does today (strip, ensure `job/`
  form). Reject entries without a `label` or `path`.
- Remove the single `jenkins_root_path` field (and its validator), OR keep it as a
  computed convenience = the first group's path only if some caller truly needs
  it. Prefer removing it and updating all call sites to iterate groups.
- Document `AGENT_JENKINS_ROOT_GROUPS` in `agent/.env.example`.

### Service — `agent/app/services/jenkins.py`

- `allowed_root_paths(settings)` → the **real** env folders across all groups:
  `[f"{group.path}/{JENKINS_JOB_PATH_SEGMENT}/{folder}" for group in groups for
  folder in root_folders]` (4 paths for the default config). `validate_job_path`
  is otherwise unchanged — freeze/resume/builds on BE/FE and below validate
  against these.
- `jenkins_scope_signature(settings)` → hash over the **groups** (sorted
  `label:path`), `sorted(root_folders)`, `tree_depth`, `history_limit` (so the
  cache key changes with the new scope).
- `fetch_tree(settings)`:
  - For each group, fetch its root subtree exactly as today (one deep
    `_get_json(group.path, tree=...)` per group), building a `children_by_name`
    map of that group's env folders.
  - For each env `folder` in `root_folders`, build a **synthetic env node**
    (`name=folder`, `kind=FOLDER`, `synthetic=True`, `path=""`, `url=""`,
    `status=None`, `builds=[]`), whose children are, for each group that has this
    env folder, a **group node** = `_map_node(group's env-folder raw)` but with its
    `name` overridden to the group's `label` (`"BE"`/`"FE"`). The group node keeps
    the real folder's `path`, `url`, and real children/pipelines. Omit a group
    from an env when that group root has no such env folder (graceful).
  - Roots = the synthetic env nodes, in `root_folders` order. Env nodes with no
    group children at all are dropped.
- `fetch_scheduled_paths(settings)`: the scan currently filters by a single
  fullName prefix. Generalize to **all group prefixes**: compute one prefix per
  group (`_fullname_prefix_from_job_path(group.path)` → e.g. `.QAA/E2E/`,
  `.QAA/UI_E2E/`) and run the Script Console scan matching a job whose `fullName`
  starts with **any** of them (pass the base64-encoded prefix list into the Groovy
  template; `println` every scheduled job url). Union the results. Best-effort
  degrade to empty as today.
- `_scheduled_fullname_prefix` (single) is replaced by a per-group helper; keep
  `_fullname_prefix_from_job_path` as-is (it already works on any real path).

### Schema — `agent/app/schemas.py`

- Add `synthetic: bool = False` to `JenkinsNode`. Only synthetic env grouping
  nodes set it `True`; real folders/pipelines/group nodes stay `False`.
- `JenkinsScopeResponse`: replace `jenkins_root_path` with
  `jenkins_root_groups: list[JenkinsRootGroup]` (`{label, path}`); keep
  `jenkins_root_folders`, `jenkins_tree_depth`, `history_limit`, `signature`.
  Update the builder in `routes.py`.

Tests (`agent/tests/test_jenkins.py`): with a two-group config and a mock that
serves both `E2E` and `UI_E2E` subtrees, `fetch_tree` returns env roots
(`PREPROD`, `PROD`), each `synthetic=True` with empty `path`, whose children are
`BE` and `FE` group nodes carrying the **real** paths
(`.../E2E/PREPROD`, `.../UI_E2E/PREPROD`) and real pipelines; `allowed_root_paths`
lists the 4 real folders and `validate_job_path` accepts a pipeline under FE but
rejects an out-of-scope path; the scope signature changes vs the old single-root
config; the scheduled scan matches jobs under either root prefix. Update existing
tests that assumed the single-root/flat-PREPROD shape.

---

## Part B — Backend: carry the synthetic flag through the cache

`backend/app/schemas/jenkins.py`: add `synthetic: bool = False` to the cached
`JenkinsNode` (mirror the agent; `extra="forbid"`, camel/populate_by_name). No
other backend change — the cache stores whatever the agent PUTs, and freeze/
resume paths are the real BE/FE folder paths, which validate as before.

Tests: a cached tree round-trips a synthetic env node with `synthetic=true` and
group children with real paths.

---

## Part C — Frontend: render the grouping, guard synthetic nodes

- `frontend/src/api/types.ts`: add `synthetic: boolean` to `JenkinsNode`;
  update `JenkinsScopeResponse` (`rootGroups: { label; path }[]` replacing
  `rootPath`).
- The tree already renders folder nodes recursively, so BE/FE grouping renders
  with no structural change. The work is **guarding synthetic env nodes**:
  - `TreePanel.tsx` `TreeNodeRow`: when `node.synthetic` (empty path/url),
    - do **not** render the freeze/resume action or the pin button;
    - the double-click "open in Jenkins" is a no-op (guard on `node.url`);
    - `activeFreezeForPath` / `coveringActiveFreezes` / pin all key off
      `node.path`, so an empty path naturally yields nothing — but explicitly skip
      the freeze/pin controls for `synthetic` to avoid an empty-path action.
  - `BoardPanel.tsx`: pinning is only reachable from real nodes; a synthetic node
    can't be pinned (no path). Recursive status counts already walk children, so a
    pinned BE/FE tile keeps working.
- Expand/collapse still works on synthetic env nodes (they are folders with
  children) — only the freeze/pin/open affordances are suppressed.

Tests (`TreePanel.test.tsx`, `BoardPanel.test.tsx`): a synthetic env node renders
its BE/FE children, shows **no** freeze icon and **no** pin button and does not
open a URL on double-click; a BE group node shows the freeze/pin affordances and
its double-click opens the real folder URL; pinning a BE folder still works.

---

## Non-goals / notes

- Env-level (PREPROD/PROD) freeze across BE+FE at once is **out of scope** — the
  freeze/resume/campaign model stays single-folder; freeze BE and FE separately.
- The group list is configurable; adding a third group or a different root is a
  config change, not a code change.
- `_fullname_prefix_from_job_path` still can't tell a real folder literally named
  `job` from the URL separator — unchanged pre-existing edge case, not relevant to
  `.QAA`.

## Acceptance criteria

- The Tree shows `PREPROD` and `PROD` at the top; each expands into `BE`
  (`.QAA/E2E/<env>`) and `FE` (`.QAA/UI_E2E/<env>`), and each of those into the
  real pipelines from that Jenkins folder.
- `PREPROD`/`PROD` are grouping-only: no freeze, no pin, no open; expand/collapse
  works. `BE`/`FE` (and below) keep freeze/resume, pin, and open-in-Jenkins
  against their real folder paths.
- Freeze/resume/campaign/builds on a BE or FE folder validate and operate on the
  correct real path under either `E2E` or `UI_E2E`; scheduled detection covers
  both roots.
- The group structure is driven by `AGENT_JENKINS_ROOT_GROUPS` (default
  `BE=job/.QAA/job/E2E,FE=job/.QAA/job/UI_E2E`) + `AGENT_JENKINS_ROOT_FOLDERS`.
- `agent`, `backend`, `frontend` all green: ruff + mypy + pytest (agent, backend);
  eslint + `tsc --noEmit` + vitest (frontend). New code follows `CONVENTIONS.md`.

## Verify (this machine)

Follow the local run recipe with the default two-group config and the Tree tab
open:
- `PREPROD` → `BE`/`FE`; `BE` lists `.QAA/E2E/PREPROD` pipelines, `FE` lists
  `.QAA/UI_E2E/PREPROD` pipelines; likewise `PROD`.
- `PREPROD` has no freeze/pin icons and double-click does nothing; `BE`/`FE` show
  the freeze + pin icons and double-click opens the right Jenkins folder.
- Freezing `FE` disables the `.QAA/UI_E2E/PREPROD` pipelines (correct root).
