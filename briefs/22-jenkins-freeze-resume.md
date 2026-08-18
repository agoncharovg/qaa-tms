# Brief 22 — Jenkins Tree: recursive folder freeze / resume for Disaster Recovery

Follow `CONVENTIONS.md` (StrEnum/union-literal constants in the dedicated
modules, English UI text, ruff+mypy / eslint+tsc clean, API under `/api/v1`).

## Problem

During Disaster Recovery (and similar coordinated maintenance) an operator needs
to **stop every pipeline in a Jenkins folder, recursively** (all nested folders
included), and later **bring them back to exactly the state they were in** — no
more, no less.

Concretely (from `briefs/22` draft + `discuss/09`):

- "Stop" a pipeline = **`disable`** it. "Resume" = **`enable`**, and additionally
  **trigger a build** — *except* pipelines that run on a schedule (they will
  self-trigger; a manual run would double-fire). Scheduled pipelines usually
  carry `scheduled` in their name; the agent already detects them
  (`fetch_scheduled_paths`, `JenkinsNode.scheduled`).
- The action must record a **reason**, and that reason must be visible to **every
  user**, not just the operator who ran it.
- Before stopping, the **prior state of each pipeline must be snapshotted** so
  that on resume **only the pipelines that were actually running get restarted**.
  A pipeline that was already disabled for some unrelated reason must **stay
  disabled** — resume must not "bring it back to life".
- When freezing, prompt for the **reason** (required) and whether to **kill
  in-flight builds**.
- The reason and the pre-freeze snapshot are visible to everyone; **anyone can
  resume**. Note a pipeline may also be re-enabled directly in Jenkins, so
  resume must be **tolerant of drift** (idempotent, never hard-fail the batch).

### Why this shape

Two hard constraints drive the design (see brief 21 non-goals):

1. **Shared + durable state.** The reason and the pre-freeze snapshot must be
   visible to all users and survive a backend restart (this is DR-critical). So
   they live in **Postgres**, not the in-memory `JenkinsCache` and not the
   per-user agent. New `jenkins_freezes` table.
2. **Only the local agent talks to Jenkins.** The agent holds the personal token
   + VPN; the backend never reaches Jenkins. So the actual `disable`/`enable`/
   `build`/`abort` calls happen on **whichever user's agent** runs the freeze or
   resume. The backend only stores the freeze record; the frontend orchestrates.

### Decisions locked in

- **Mutation mechanism: Groovy Script Console (primary), per-job REST fan-out
  (fallback).** One `scriptText` POST captures the snapshot *and* applies the
  `disable` (+ optional abort) atomically for the whole subtree, mirroring the
  existing `fetch_scheduled_paths` approach — one request instead of 200+, and a
  race-free snapshot. Requires `RunScripts` (already relied on for scheduled
  detection). If the script fails (e.g. no permission), fall back to a per-job
  REST fan-out with bounded concurrency; log which path was taken.
- **Overlapping / nested freezes are allowed, with a merge prompt.** A partial
  freeze can be widened: e.g. freeze `PREPROD/IAM`, then `PREPROD/CDN`, then all
  of `PREPROD`. When a new freeze intersects existing active freezes
  (`a == b or a.startswith(b + "/") or b.startswith(a + "/")`, same scope
  signature), the UI **lists those freezes with their author + timestamp** and
  asks whether to **merge** them into the new one:
  - **Don't merge (default):** the new freeze snapshots current state, so
    pipelines already disabled by the earlier freezes are recorded
    `was_disabled == true` and are therefore left alone on resume — the earlier
    freezes stay active and independent, and their own resume is what brings
    those pipelines back. This "prior locks survive the wider resume" behavior
    falls straight out of the existing snapshot rule; no special case needed.
  - **Merge:** the new (wider) freeze **takes ownership** of the selected
    freezes' pipelines so that resuming it restores everything. See the merge
    mechanics in Part B.
- **Independent of the `operations` audit table / `OperationType` enum.** The
  `jenkins_freezes` row *is* the record (who/why/when/snapshot). Do **not** add
  `OperationType` values — avoids the Enum-CHECK migration churn from
  `0003`–`0005` and keeps the freeze independently queryable for the banner.

Three parts: A (agent mutations) and B (backend store) are independent; C wires
the UI over both.

---

## Part A — Agent: freeze / resume a folder subtree

`agent/app/services/jenkins.py`. Reuse the existing crumb + `scriptText`
machinery (`_fetch_crumb`, `SCRIPT_TEXT_PATH`) and `validate_job_path` (scope
enforcement — a freeze target must be inside the configured `.QAA/E2E` scope).

### Snapshot shape

Add a schema `JenkinsFreezeSnapshotItem` (agent `app/schemas.py`), one per
pipeline in the subtree:

- `path: str` — the node path (URL path, stripped of slashes), same form as
  `JenkinsNode.path` / `_path_from_url`.
- `full_name: str` — the Jenkins `fullName` (e.g. `.QAA/E2E/PROD/foo`), used to
  re-resolve the job on resume.
- `name: str` — leaf display name.
- `was_disabled: bool` — **the restore key**: only `false` entries are resumed.
- `scheduled: bool` — if `true`, resume only `enable`s (no manual build).
- `was_building: bool` — informational (was a build in flight at freeze time).

### `freeze_folder(settings, folder_path, *, kill_builds) -> list[JenkinsFreezeSnapshotItem]`

- `require_configured` + `validate_job_path(settings, folder_path)`.
- Derive the `fullName` prefix from `folder_path` — generalize the existing
  `_scheduled_fullname_prefix` into `_fullname_prefix_from_job_path(job_path)`
  (strip the `job/` segments, join the rest with `/`, add trailing `/`); the root
  helper becomes a thin caller of it.
- **Primary (Groovy):** POST a script (template like `SCHEDULED_SCRIPT_TEMPLATE`)
  that, for every `WorkflowJob` whose `fullName` starts with the prefix:
  records `{path, fullName, name, wasDisabled, scheduled, wasBuilding}`; if
  `kill_builds` and building, stops the in-flight run(s); then `disable()`s it if
  not already disabled. `println groovy.json.JsonOutput.toJson(list)` and parse
  the single JSON line (tolerate the trailing `Result: ` framing the Script
  Console adds — extract the JSON payload, as the scheduled scan already parses
  line-by-line). Scheduled detection: same `TimerTrigger`/`SCMTrigger` + non-empty
  `spec` test as the existing template.
- **Fallback (REST):** if the script POST fails (non-2xx / no `RunScripts` /
  malformed), walk the subtree via `fetch_tree`-style data to enumerate pipeline
  paths, capture `was_disabled`/`scheduled`/`was_building` from the JSON fields,
  and `POST <job>/disable` (+ `POST <job>/lastBuild/stop` when `kill_builds`) per
  job with **bounded concurrency** (`asyncio.Semaphore`, small cap constant).
  Log `jenkins freeze: mechanism=groovy|rest path=<folder>`.
- Return the snapshot list (pipelines only; folders are not snapshotted).

### `resume_folder(settings, snapshot) -> list[JenkinsResumeOutcome]`

- `require_configured`. **Filter to `was_disabled == false` on the agent** (the
  agent is authoritative — never resume a pipeline that was disabled before the
  freeze, even if the caller passes it).
- **Re-run with the last build's parameters.** A resumed non-scheduled pipeline
  must re-run with the **same parameters as its most recent build**, not Jenkins
  defaults (parameterized pipelines would otherwise resume with wrong inputs). If
  the last build had no parameters (or the job has none), fall back to a default
  trigger.
- **Primary (Groovy):** pass the filtered items as JSON into a script that, per
  item: `getItemByFullName(fullName, WorkflowJob)`; if `null` → outcome
  `missing`; else `enable()` if disabled, then if `!scheduled` re-run replaying the
  last build's parameters — read `job.getLastBuild()?.getAction(hudson.model.ParametersAction)`
  and `scheduleBuild2(0, new hudson.model.ParametersAction(params))` when present,
  else `scheduleBuild2(0)` → outcome `restored`; scheduled → outcome `enabled`.
  Idempotent — enabling an already-enabled job and re-resolving a job re-enabled
  directly in Jenkins are both no-ops that still report a sane outcome. Return the
  parsed outcome list.
- **Fallback (REST):** per item, `POST <path>/enable`, then (non-scheduled) fetch
  the last build's parameters (`GET <path>/lastBuild/api/json?tree=actions[parameters[name,value]]`,
  404/none → empty) and `POST <path>/buildWithParameters` with them, or
  `POST <path>/build` when there are none; bounded concurrency; a 404 → `missing`;
  never raise for a single failed item — collect per-item outcomes.
- `JenkinsResumeOutcome { full_name: str; outcome: Literal["restored","enabled","missing","error"]; detail: str | None }`.

### Endpoints — `agent/app/api/routes.py`

Add `AgentPath.JENKINS_FREEZE = "/jenkins/freeze"`,
`AgentPath.JENKINS_RESUME = "/jenkins/resume"`.

- `POST /jenkins/freeze` body `JenkinsFreezeRequest { folderPath: str; killBuilds: bool }`
  → `JenkinsFreezeResponse { snapshot: list[JenkinsFreezeSnapshotItem] }`.
- `POST /jenkins/resume` body `JenkinsResumeRequest { snapshot: list[JenkinsFreezeSnapshotItem] }`
  → `JenkinsResumeResponse { outcomes: list[JenkinsResumeOutcome] }`.

Same error mapping as the existing Jenkins routes: `JenkinsNotConfiguredError`
→ 503, `JenkinsPathOutOfScopeError`/`ValueError` → 400, `JenkinsUnreachableError`
→ 502.

Tests (`agent/tests/test_jenkins.py`): freeze builds the correct `fullName`
prefix and parses the JSON snapshot; `kill_builds` toggles the abort branch;
resume filters out `was_disabled == true`; scheduled items are `enable`-only
(no build); a resumed non-scheduled pipeline re-runs via `buildWithParameters`
replaying the last build's parameters (and via `build` when there are none); a
missing job yields `missing`, not an exception; the REST fallback fires when the
script POST returns non-2xx.

---

## Part B — Backend: durable freeze store

### Enum + constants — `backend/app/core/constants.py`

- `JenkinsFreezeStatus(StrEnum) { ACTIVE = "active", RESOLVED = "resolved", MERGED = "merged" }`
  (`MERGED` = absorbed into a wider freeze; see the merge flow below).
- `RoutePath.FREEZES = "/freezes"` and `RoutePath.FREEZE_BY_ID = "/freezes/{freeze_id}"`,
  `RoutePath.FREEZE_SNAPSHOT = "/freezes/{freeze_id}/snapshot"`,
  `RoutePath.FREEZE_RESOLVE = "/freezes/{freeze_id}/resolve"` (mounted under the
  existing `RoutePath.JENKINS` prefix).

### Model — `backend/app/models/jenkins_freeze.py` (new) + migration

`JenkinsFreeze(Base)` — mirror `Operation`'s conventions (UUID pk, `JSON`
with-variant `JSONB` for the snapshot, timezone-aware timestamps, FK to
`users.id`):

- `id: UUID` pk.
- `folder_path: str` (indexed) — agent-validated node path of the frozen folder.
- `folder_name: str` — display name.
- `signature: str` (indexed) — Jenkins scope signature (ties a freeze to a scope,
  same value the cache uses).
- `reason: Text`.
- `kill_builds: bool`.
- `status: JenkinsFreezeStatus` (indexed; `Enum(..., native_enum=False, values_callable=...)` like `Operation`).
- `applied: bool` (default `false`) — flipped `true` once the agent snapshot is
  attached; distinguishes a reserved-but-not-yet-applied claim.
- `snapshot: JSON` — `list[{path, fullName, name, wasDisabled, scheduled, wasBuilding}]` (empty until applied).
- `created_by_id: FK users.id`, `created_at: datetime`.
- `resolved_by_id: FK users.id | None`, `resolved_at: datetime | None`.
- `merged_into_id: FK jenkins_freezes.id | None` — set on a freeze that was
  absorbed into a wider one (its `status` becomes `MERGED`).
- relationships to `User` (add matching back-populates if the existing pattern
  requires it; otherwise plain `relationship`).

Alembic: new `0006` migration creating `jenkins_freezes` with indexes on
`folder_path`, `signature`, `status`.

### Schemas — `backend/app/schemas/jenkins_freeze.py` (new)

camelCase aliases, `populate_by_name=True`, `extra="forbid"`:

- `JenkinsFreezeSnapshotItem { path; fullName; name; wasDisabled; scheduled; wasBuilding }`.
- `JenkinsFreezeCreate { folderPath; folderName; signature; reason; killBuilds }`
  (`reason` non-empty — `min_length=1` after strip).
- `JenkinsFreezeSnapshotPut { snapshot: list[JenkinsFreezeSnapshotItem];
  mergeFreezeIds: list[UUID] = [] }` — the active freezes the operator chose to
  merge into this one (empty = don't merge).
- `JenkinsFreezeRead { id; folderPath; folderName; signature; reason; killBuilds;
  status; applied; snapshot; createdBy; createdAt; resolvedBy; resolvedAt;
  mergedIntoId }` (`createdBy`/`resolvedBy` = username or a small user DTO —
  follow how other read models expose the actor).

### Router — `backend/app/api/v1/jenkins_freeze.py` (new), mounted alongside the cache router

All require `CurrentUser`.

- `GET /jenkins/freezes?signature=<sig>&status=active` → `list[JenkinsFreezeRead]`.
  Default returns **active** freezes for the scope (banner + tree markers);
  `status=resolved` (or no filter) returns recent history for the "who resumed"
  view. This is how the reason/snapshot become visible to everyone.
- `POST /jenkins/freezes` (body `JenkinsFreezeCreate`) → `JenkinsFreezeRead`.
  **Reserve-first**: insert `status=active, applied=false, snapshot=[]`,
  `created_by=current user`, and return the row (with `id`) so the frontend can
  drive the agent and then attach the snapshot. Reason is required. **Overlaps
  are allowed** — the create does not reject intersecting freezes; the merge
  decision is made client-side (from `GET /jenkins/freezes?status=active`) and
  carried into the snapshot PUT.
- `PUT /jenkins/freezes/{id}/snapshot` (body `JenkinsFreezeSnapshotPut`) →
  `JenkinsFreezeRead`. Stores the agent-produced snapshot and sets `applied=true`.
  409/404 if the freeze is not active/not found. **Merge resolution** (when
  `mergeFreezeIds` is non-empty): in the same transaction, for each referenced
  freeze that is still `active` and actually intersects this one, carry ownership
  of its running pipelines into this snapshot — for every entry in the merged
  freeze's snapshot with `was_disabled == false`, set the matching-`path` entry
  in this snapshot to `was_disabled = false` (so resuming the wider freeze
  restores them); then mark the merged freeze `status=merged`,
  `merged_into_id=this id`, `resolved_by=current user`, `resolved_at=now`. Ignore
  ids that are no longer active or don't intersect. The non-merge case stores the
  snapshot verbatim — pipelines already disabled by other active freezes keep
  `was_disabled=true` and are left alone on resume.
- `DELETE /jenkins/freezes/{id}` → 204. Release a **not-yet-applied** claim
  (rollback path when the agent freeze fails mid-way). Reject (409) if `applied`
  — an applied freeze is resolved via the resolve endpoint, not deleted.
- `POST /jenkins/freezes/{id}/resolve` → `JenkinsFreezeRead`. Set
  `status=resolved`, `resolved_by=current user`, `resolved_at=now`. **Anyone**
  may resolve. Idempotent-ish: resolving an already-resolved freeze → 409 (or
  return as-is; pick one and test it).

No Jenkins access on the backend — it only stores the record and the
agent-supplied snapshot.

Tests (`backend/tests`): create → active+not-applied (overlaps allowed — an
intersecting create still succeeds); snapshot PUT sets `applied` + stores items;
**merge**: a wider freeze whose `mergeFreezeIds` reference two intersecting active
freezes marks them `merged` (`merged_into_id` set) and overrides the wider
snapshot's `was_disabled` to `false` for their previously-running pipelines,
while a **non-merge** wider freeze leaves them `active` and keeps those paths
`was_disabled=true`; a `mergeFreezeIds` entry that is non-active or
non-intersecting is ignored; delete a not-applied claim → 204, delete an applied
one → 409; resolve sets resolver + timestamp and anyone (not just creator) may
call it; unauthenticated → 401; `GET ?status=active` filters correctly (and
excludes `merged`).

---

## Part C — Frontend: freeze/resume from the Tree, shared banner

Types (`frontend/src/api/types.ts`): `JenkinsFreezeSnapshotItem`,
`JenkinsFreezeRead`, `JenkinsResumeOutcome`, and the create/snapshot request
bodies. Constants (`frontend/src/constants.ts`): `AgentPath.JENKINS_FREEZE` /
`JENKINS_RESUME`; `BackendPath.JENKINS_FREEZES` (+ id/snapshot/resolve builders);
`QueryKey.JENKINS_FREEZES`; a `JenkinsFreezeStatus` enum mirror; UI copy strings.

Clients:
- `agentClient.ts`: `freezeJenkinsFolder(port, token, body)`,
  `resumeJenkinsFolder(port, token, body)`.
- `backendClient.ts`: `getJenkinsFreezes(signature, status?)`,
  `createJenkinsFreeze(body)`, `putJenkinsFreezeSnapshot(id, body)`,
  `deleteJenkinsFreeze(id)`, `resolveJenkinsFreeze(id)`.

Hook — `frontend/src/plugins/jenkins/useJenkinsFreezes.ts` (new):
- `freezesQuery` → `getJenkinsFreezes(signature, "active")`, enabled when a
  signature exists; refetched with the tree (reuse the tree refresh cadence).
  Expose a `Map<folderPath, JenkinsFreezeRead>` plus a helper
  `activeFreezeForPath(path)` that also matches an **ancestor** freeze (so a
  nested folder shows it is covered by a parent freeze).
- A helper `intersectingActiveFreezes(folderPath)` returning the active freezes
  that intersect the target (self / ancestor / descendant), used to drive the
  merge prompt.
- `freezeMutation(folderPath, folderName, reason, killBuilds, mergeFreezeIds)`
  orchestration:
  1. `createJenkinsFreeze` (reserve).
  2. `agentClient.freezeJenkinsFolder({ folderPath, killBuilds })` → snapshot.
  3. `putJenkinsFreezeSnapshot(id, { snapshot, mergeFreezeIds })`.
  - On agent failure between 1–3, call `deleteJenkinsFreeze(id)` to release the
    claim, then surface the error. Invalidate `freezesQuery` + the tree on
    success.
- `resumeMutation(freeze)`:
  1. `agentClient.resumeJenkinsFolder({ snapshot: freeze.snapshot })` → outcomes.
  2. `resolveJenkinsFreeze(freeze.id)`.
  - Invalidate `freezesQuery` + tree; toast a summary
    (`restored`/`enabled`/`missing` counts).

`TreePanel.tsx` (folder rows only — the freeze unit is a folder subtree, so
pipeline rows get no freeze control):
- Add the control to the **right-hand action group of the folder `Paper` row**,
  next to the existing Pin `ActionIcon` (~`TreePanel.tsx:327`). It is an
  `ActionIcon` with `event.stopPropagation()` (like Pin) so it does not trigger
  the row's expand/collapse click or the double-click "open in Jenkins".
  Layout: reserve a fixed slot next to `PIN_SLOT_PX` for it.
  - Not frozen → **Freeze** icon (`IconSnowflake`), tooltip "Freeze folder…".
  - Frozen (this exact folder) → the icon becomes **Resume** (`IconPlayerPlay`),
    plus a **`Badge` "Frozen"** (with `IconSnowflake`) in the meta group.
  - Covered by an **ancestor** freeze → show the "Frozen" badge but no
    per-row resume (resume lives on the owning folder).
- **Freeze modal** (Mantine `Modal`): required **reason** textarea + **kill
  running builds** checkbox + confirm.
    - If `intersectingActiveFreezes(folderPath)` is non-empty, the modal also
      shows a **merge section**: one **checkbox per intersecting freeze**, each
      labeled with its folder, author, and timestamp. A box is **checked by
      default when that freeze was created by the current user**, and unchecked
      when it was created by someone else (so widening your own partial freezes
      merges by default, while another operator's lock is left standing unless you
      opt in). The checked ids become `mergeFreezeIds`. (Current user id/username
      comes from `useAuthStore`.)
- **Frozen visibility (who / when):** the "Frozen" badge carries a
  `HoverCard`/`Tooltip` showing `Frozen by {createdBy} · {createdAt}` (relative
  time via the existing `RelativeTimeValue` helper), the **reason**, and
  pre-freeze counts (active vs already-disabled, derived from the snapshot). This
  reads from the Postgres-backed `freezesQuery`, so **every user sees the same
  badge** — that is the "visible to all" requirement. A folder may be covered by
  more than one freeze (nested/partial); surface each covering freeze in the
  hover content.
- Keep it read-friendly: while a freeze/resume mutation is in flight show a
  loader on the row.

`BoardPanel.tsx`: reflect the freeze badge on pinned folder tiles too (read the
same `freezesQuery`); a pinned frozen folder shows the reason on hover.

Tests (`TreePanel.test.tsx`, `BoardPanel.test.tsx`): freezing a folder issues
create → agent freeze → snapshot PUT in order; an agent failure triggers the
`deleteJenkinsFreeze` rollback; widening over intersecting freezes shows the
merge checkbox list with the current user's own freezes pre-checked and others'
un-checked, and the checked ids flow into `putJenkinsFreezeSnapshot` as
`mergeFreezeIds`; a folder covered by an active (ancestor) freeze shows the badge
+ reason; Resume calls agent resume then resolve and shows the outcome summary.

---

## Non-goals / notes to preserve

- No backend→Jenkins networking, no shared service account — the agent stays the
  only thing that mutates Jenkins (brief 21 constraint).
- The freeze snapshot is captured **at freeze time**; resume trusts the snapshot
  for *what* to restore, but Jenkins is the source of truth for *current* state —
  resume reconciles and never hard-fails on drift.
- Overlapping / nested / partial freezes are supported. Widening prompts a
  per-freeze **merge** choice (own freezes pre-checked); merged freezes are
  absorbed (`status=merged`) and their running pipelines restored by the wider
  resume, while un-merged freezes stay independent and their prior locks survive
  the wider resume.
- Real-time push of freeze changes to other open pages is out of scope — the
  banner refreshes on the existing tree poll cadence.
- No RBAC beyond "authenticated user": anyone can freeze and anyone can resume,
  by design (DR is a shared responsibility).

## Acceptance criteria

- An operator can, from a folder node in the Tree, freeze the whole subtree
  recursively with a required reason and a "kill running builds" choice; every
  matching pipeline ends up `disabled` and (if chosen) its in-flight build
  aborted.
- The reason, operator, timestamp, and pre-freeze snapshot are visible to **all**
  users on that folder (banner + badge), and survive a backend restart.
- Resume `enable`s + runs **only** the pipelines that were enabled at freeze time
  (`was_disabled == false`); pipelines disabled beforehand stay disabled;
  scheduled pipelines are `enable`d without a manual run. A resumed non-scheduled
  pipeline re-runs with the **same parameters as its most recent build** (default
  trigger only when the last build had none). Resume is idempotent against
  pipelines already re-enabled directly in Jenkins.
- Any user can resume; resolving records who resumed and when.
- Partial freezes can be widened: the operator is shown the intersecting active
  freezes (folder, author, timestamp) as a checkbox list — own freezes checked by
  default — and can merge any subset. Merged freezes are absorbed and restored by
  the wider resume; un-merged ones keep their pipelines disabled through the wider
  resume and are resumed on their own.
- Groovy Script Console is used when available; a per-job REST fan-out fallback
  covers the no-`RunScripts` case, and the chosen mechanism is logged.
- `agent`, `backend`, `frontend` all green: ruff + mypy + pytest (agent,
  backend); eslint + `tsc --noEmit` + vitest (frontend). New code follows
  `CONVENTIONS.md` (no bare string literals; enums in the constants modules;
  English UI text).

## Verify (this machine)

Follow the local run recipe (host-network PG + native backend/agent/frontend),
agent configured for the `.QAA/E2E` scope, Tree tab open:

- Freeze a small test folder with a reason + kill-builds: its pipelines flip to
  `disabled` in Jenkins; the folder shows the freeze badge/banner with the
  reason; a second browser (different user) sees the same banner.
- Manually disable one pipeline in the folder **before** freezing, freeze, then
  resume: that pipeline stays disabled after resume; the others are re-enabled
  and (non-scheduled ones) rebuilt.
- Freeze `PREPROD/IAM`, then `PREPROD/CDN`, then all of `PREPROD`: the wider
  modal lists the two existing freezes (own ones pre-checked). Merge **none** →
  resuming `PREPROD` re-enables only the pipelines that were running when it froze
  (IAM/CDN stay disabled, still owned by their own freezes); resuming
  `PREPROD/IAM` then brings IAM back. Merge **both** → resuming `PREPROD` restores
  IAM and CDN too, and the two partial freezes show as `merged`.
- Re-enable one pipeline directly in Jenkins, then resume from the app → no error;
  its outcome is reported as already-enabled/restored.
