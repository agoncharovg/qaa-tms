# Brief 23 — Jenkins resume: throttled campaign with shared, cross-machine progress + global lock

Follow `CONVENTIONS.md` (StrEnum/union-literal constants in the dedicated
modules, English UI text, ruff+mypy / eslint+tsc clean, API under `/api/v1`).
Builds directly on brief 22 (freeze/resume). Read `briefs/22-jenkins-freeze-resume.md`
first — this brief **replaces the resume execution path** with a durable campaign.

## Problem

Brief 22's resume fires `enable` + `build` for **every** restorable pipeline at
once. For a folder with hundreds of pipelines that is a thundering-herd on the CI
infrastructure. We need to:

1. **Throttle**: start pipelines one at a time with a pause (~1s) between builds.
2. **Show progress**: how many of N have started, what is starting right now, what
   has already started, and what was **skipped** (pipelines whose pre-freeze
   status was "specific" — i.e. `was_disabled == true`, left alone on purpose).
3. **Global lock**: while a resume campaign is in flight, **all** Jenkins freeze/
   resume operations are blocked until the campaign **completes** or is
   **cancelled**.
4. **Cross-machine, durable**: every user, on any machine, sees the *same* live
   progress and the *same* lock — regardless of which machine launched it,
   regardless of pages being reopened or the user having bounced out to Jenkins.
   Anyone can cancel.

### Why this shape (same split as brief 22)

- **Durable shared state** (progress + lock) lives in **Postgres**, so it survives
  a backend restart and is identical for every client. New `jenkins_resume_runs`
  table.
- **Only the local agent talks to Jenkins.** The throttled loop must **outlive the
  browser tab** (requirement 4), so it runs as a **background task on the
  initiating user's agent** (the agent already runs long background jobs — see
  `agent/app/services/jobs.py` — and already calls the backend with the user's
  token — see `agent/app/services/backend.py::push_operation`). The agent reports
  each step to the backend and polls the backend for cancellation, so a cancel
  from *any* machine stops it.
- **Clients only observe**: every browser polls the backend campaign and renders
  the shared progress modal + lock. No browser drives the loop, so closing the tab
  does not stop it.

Three parts: A (backend store + lock), B (agent throttled executor), C (frontend
progress modal + lock). A is the source of truth and lands first.

---

## Part A — Backend: durable resume-run store + global lock

### Enum + constants — `backend/app/core/constants.py`

- `JenkinsResumeRunStatus(StrEnum) { RUNNING = "running", DONE = "done",
  CANCELLED = "cancelled", FAILED = "failed" }`.
- `JenkinsResumeItemState(StrEnum) { PENDING = "pending", STARTED = "started",
  SKIPPED = "skipped", ERROR = "error" }`.
- `RoutePath.RESUME_RUNS = "/resume-runs"`, `RESUME_RUN_BY_ID = "/resume-runs/{run_id}"`,
  `RESUME_RUN_PROGRESS = "/resume-runs/{run_id}/progress"`,
  `RESUME_RUN_CANCEL = "/resume-runs/{run_id}/cancel"` (mounted under the existing
  `RoutePath.JENKINS` prefix).
- `JENKINS_RESUME_RUN_STALE_SECONDS = 30` (heartbeat lease; a running campaign
  whose `heartbeat_at` is older than this is treated as abandoned and may be
  cancelled/superseded).

### Model — `backend/app/models/jenkins_resume_run.py` (new) + migration `0007`

`JenkinsResumeRun(Base)` — mirror `JenkinsFreeze`'s conventions (UUID pk, `JSON`
with-variant `JSONB`, tz-aware timestamps, FK to `users.id`):

- `id: UUID` pk.
- `freeze_id: FK jenkins_freezes.id` (indexed) — the freeze being resumed.
- `signature: str` (indexed) — Jenkins scope signature (the lock is per scope).
- `status: JenkinsResumeRunStatus` (indexed).
- `total: int` — restorable pipeline count.
- `started_count: int` (default 0), `skipped_count: int` (default 0),
  `error_count: int` (default 0).
- `current_path: str | None`, `current_name: str | None` — the pipeline being
  started right now.
- `items: JSON` — the full plan, one entry per snapshot pipeline:
  `{path, name, fullName, scheduled, state (JenkinsResumeItemState), reason}`.
  Restorable items start `pending`; `was_disabled == true` items start `skipped`
  with `reason` = "Disabled before the freeze".
- `created_by_id: FK users.id`, `created_at: datetime`.
- `heartbeat_at: datetime` (default now) — bumped on every progress write.
- `cancelled_by_id: FK users.id | None`, `finished_at: datetime | None`.

Alembic `0007`: create `jenkins_resume_runs` with indexes on `signature`,
`status`, `freeze_id`.

### Schemas — `backend/app/schemas/jenkins_resume_run.py` (new)

camelCase aliases, `populate_by_name=True`, `extra="forbid"`:

- `JenkinsResumeItem { path; name; fullName; scheduled; state; reason }`.
- `JenkinsResumeRunCreate { freezeId }`.
- `JenkinsResumeProgressPut { path; state (started|error); reason?;
  nextPath?; nextName? }` — one item's terminal state plus what is starting next.
- `JenkinsResumeRunRead { id; freezeId; signature; status; total; startedCount;
  skippedCount; errorCount; currentPath; currentName; items; createdBy; createdAt;
  cancelledBy; finishedAt; stale }` where `stale` = `status==running and now -
  heartbeat_at > JENKINS_RESUME_RUN_STALE_SECONDS`.

### Router — `backend/app/api/v1/jenkins_resume_run.py` (new), mounted alongside the freeze router

All require `CurrentUser`.

- `POST /jenkins/resume-runs` (body `JenkinsResumeRunCreate`) → `JenkinsResumeRunRead`.
  In one transaction: **409** if any `running` campaign exists for the freeze's
  `signature` that is **not stale** (the global lock); **404** if the freeze is
  missing; **409** if the freeze is not `active`. Otherwise build the `items` plan
  from `freeze.snapshot` (skipped for `was_disabled`, pending otherwise), set
  `total` = pending count, `status=running`, `created_by=current user`,
  `heartbeat_at=now`. Returns the run (with `id`).
- `GET /jenkins/resume-runs?signature=<sig>&status=running` → `list[JenkinsResumeRunRead]`
  (default active). Drives the shared modal for every client.
- `GET /jenkins/resume-runs/{id}` → `JenkinsResumeRunRead`.
- `PUT /jenkins/resume-runs/{id}/progress` (body `JenkinsResumeProgressPut`) →
  `JenkinsResumeRunRead`. Marks `items[path].state` = started/error (+`reason`),
  increments the matching counter, sets `current_path/current_name` from
  `nextPath/nextName` (or clears when absent), bumps `heartbeat_at`. If the run is
  already `cancelled`, do NOT resurrect it — return current state (the agent uses
  this response to learn it was cancelled and stop). When `started+skipped+error
  == total` and status is still `running`, set `status=done`, `finished_at=now`,
  clear `current_*`, and **resolve the freeze only when `error_count == 0`**
  (`status=resolved`, resolver = the run's `created_by`). If any pipeline errored,
  leave the freeze `active` so its snapshot survives for a retry campaign — matching
  the partial-resume promise from brief 22.
- `POST /jenkins/resume-runs/{id}/cancel` → `JenkinsResumeRunRead`. **Anyone** may
  cancel a `running` run: set `status=cancelled`, `cancelled_by=current user`,
  `finished_at=now`, clear `current_*`. Idempotent-ish (cancelling a finished run
  → 409). The freeze stays `active` so a fresh campaign can retry.

No Jenkins access on the backend — it only stores what the agent reports.

Tests (`backend/tests`): create builds the plan (skipped vs pending) and sets
`total`; a second create while a fresh campaign runs → 409; a create while the
existing campaign is **stale** succeeds; progress advances counters + current and,
on the last item, flips to `done` and resolves the freeze; progress on a cancelled
run does not resurrect it; cancel by a non-creator works and sets
cancelled_by; `stale` is computed from `heartbeat_at`; unauthenticated → 401.

---

## Part B — Agent: throttled background resume executor

Reuse the existing background-task + backend-push machinery (`jobs.py`,
`backend.py`). Add `AgentPath.JENKINS_RESUME_RUN = "/jenkins/resume-run"` and a
pause constant `DEFAULT_JENKINS_RESUME_PAUSE_SECONDS = 1.0` in
`agent/app/core/constants.py` (config field `jenkins_resume_pause_seconds`,
alias `AGENT_JENKINS_RESUME_PAUSE_SECONDS`, documented in `agent/.env.example`).

- `POST /jenkins/resume-run` body `JenkinsResumeRunRequest { runId; snapshot:
  list[JenkinsFreezeSnapshotItem] }` → `202` `JenkinsResumeRunAccepted { runId }`.
  Captures the caller's bearer token (as `push_operation` already does) and
  launches a **background asyncio task** (stored on `app.state`, keyed by `runId`,
  so a duplicate POST for the same run is a no-op), then returns immediately.

Background task `run_resume_campaign(settings, run_id, token, snapshot)`:
- `restorable = [i for i in snapshot if not i.was_disabled]` (agent stays
  authoritative — see brief 22).
- For each item, in order:
  1. Before starting it, `PUT .../progress` is **not** needed just to set current;
     instead include `nextPath/nextName` on the *previous* item's progress write so
     "currently starting X" is always one hop ahead. For the first item, do an
     initial `PUT` with `path` of item 0 as `nextPath` and no terminal state — OR
     simpler: set `current_*` = the item about to start via a dedicated field on
     the progress body. Pick one and keep the modal's "Starting: X" accurate.
  2. `enable` if disabled, then re-run **with the last build's parameters**
     (reuse `resume_folder`'s Groovy/REST logic and `_fetch_last_build_parameters`
     from brief 22 — do NOT duplicate; factor a single-item
     `_resume_one(settings, item, ...)` used by both the batch `resume_folder` and
     this throttled loop).
  3. `PUT .../progress { path, state: started|error, reason?, nextPath, nextName }`.
     Use the response: if it comes back `status == cancelled` (or `409`), **stop
     the loop immediately**.
  4. `await asyncio.sleep(settings.jenkins_resume_pause_seconds)`.
- On natural completion the final progress write flips the run to `done` on the
  backend (Part A). On a backend `cancelled`, exit quietly. Any per-item Jenkins
  failure is reported as `state=error` and the loop continues (never abort the
  whole campaign on one pipeline).
- Every progress write bumps the backend `heartbeat_at`; a crashed agent stops
  bumping it and the run goes `stale` (Part A), so another user can cancel/retry.

`agent/app/services/jenkins.py` (or a new `jenkins_resume.py`): factor
`_resume_one(...)` out of `resume_folder`; keep `resume_folder` (batch) working for
callers/tests, but the throttled path is now the one the UI uses.

Tests (`agent/tests`): the executor starts pipelines in order with a pause
between them (patch `asyncio.sleep`, assert call count == restorable count and
ordering), replays last-build parameters (regression of brief 22's behavior
through `_resume_one`), reports each item via `PUT /progress`, and **stops early**
when a progress response returns `status=cancelled` (assert no further Jenkins
builds fire). `was_disabled` items are never started.

---

## Part C — Frontend: shared centered progress modal + global lock

Types/constants: `JenkinsResumeRunRead`, `JenkinsResumeItem`,
`JenkinsResumeItemState`, `JenkinsResumeRunStatus` mirrors; `BackendPath.JENKINS_RESUME_RUNS`
(+ id/progress/cancel builders); `AgentPath.JENKINS_RESUME_RUN`;
`QueryKey.JENKINS_RESUME_RUN`; a faster poll constant
`JENKINS_RESUME_RUN_REFETCH_MS = 1500`; UI copy.

Clients:
- `backendClient.ts`: `createJenkinsResumeRun(body)`, `getJenkinsResumeRuns(signature)`,
  `cancelJenkinsResumeRun(id)`.
- `agentClient.ts`: `startJenkinsResumeRun(port, token, { runId, snapshot })`.

Hook — extend `useJenkinsFreezes.ts` (or a sibling `useJenkinsResumeRun.ts`):
- `resumeRunQuery` → `getJenkinsResumeRuns(signature)`; **`refetchInterval =
  JENKINS_RESUME_RUN_REFETCH_MS` whenever a run is active** (poll fast while the
  campaign is live), enabled when signature present. Expose `activeResumeRun`
  (the single `running` run, if any).
- **Rewire resume**: the brief-22 `resumeMutation` (agent resume + resolve) is
  replaced by `startResumeCampaign(freeze)`:
  1. `createJenkinsResumeRun({ freezeId })` (reserve + lock; surfaces 409 as
     "another resume is already running").
  2. `agentClient.startJenkinsResumeRun(port, token, { runId, snapshot: freeze.snapshot })`.
  3. Invalidate `resumeRunQuery`; the modal takes over from the poll.
  (Confirmation from the current Resume modal now leads into this instead of the
  direct resume.)
- `cancelResumeRun()` → `cancelJenkinsResumeRun(activeResumeRun.id)`.

**Global lock**: expose `isLocked = Boolean(activeResumeRun)` from the hook.
`TreePanel`/`BoardPanel` disable **all** freeze and resume actions while
`isLocked` (server also enforces via 409). The lock releases when the run is no
longer `running` (done/cancelled).

**Progress modal — `JenkinsResumeProgressModal.tsx` (new)**, rendered by
`TreePanel` (and reachable from the board):
- `centered`, `withCloseButton={false}`, `closeOnClickOutside={false}`,
  `closeOnEscape={false}` — it genuinely blocks until done/cancelled.
- **Opens for every user** whenever `activeResumeRun` exists (driven by the shared
  poll — cross-machine), not just the initiator.
- Content (all of it, per the requirement):
  - **Who + when**: `Started by {createdBy} · {createdAt}` (reuse
    `relativeTime.ts`).
  - **Now starting**: `currentName` (or "Finishing…" when null).
  - **Progress**: a `Progress`/counter `{startedCount}/{total}` plus
    `skippedCount` and `errorCount`.
  - **Item list**: each `items[]` row with a state chip — started (green),
    skipped (gray, showing `reason` "Disabled before the freeze"), pending, error
    (red, with `reason`). Scrollable.
  - **Cancel** button (anyone) → `cancelResumeRun()`; disabled once not `running`.
  - When `status` becomes `done`/`cancelled`, show the terminal summary and a
    **Close** button (local dismiss only — the lock is already released).

Tests (`TreePanel.test.tsx`, new modal test): starting a resume issues
create-run → agent start-run (not the old direct resume); while a run is active the
modal renders who/when/current/started/skipped and **all freeze/resume actions are
disabled**; the modal appears from a poll result even without having initiated it
(cross-machine); Cancel calls `cancelJenkinsResumeRun`; a `done` run releases the
lock and shows the summary; a `cancelled` run releases the lock.

---

## Non-goals / notes to preserve

- No backend→Jenkins networking (brief 21/22 constraint). The agent is the only
  executor; the backend only stores progress and enforces the lock.
- The freeze snapshot + resume-run plan are the source of truth; the throttled
  loop tolerates drift (a pipeline re-enabled directly in Jenkins still reports a
  sane per-item state) and never aborts the whole campaign on one failure.
- One active campaign per scope (`signature`). A **stale** campaign (dead agent,
  no heartbeat past the lease) can be cancelled by anyone so the lock never wedges
  permanently.
- Real-time is poll-based (~1.5s) — "everyone sees the same" with that latency.
  SSE streaming of progress is a deliberate future step, NOT in this brief.
- Throttling applies to **resume** (it triggers builds). Freeze stays the fast
  atomic Groovy disable; it is merely blocked while a campaign runs.

## Acceptance criteria

- Resuming a folder starts its pipelines **one at a time** with a ~1s pause
  (configurable), not all at once.
- A **centered, non-dismissable** progress modal shows, to **every user on any
  machine**, who started the resume and when, which pipeline is starting now, how
  many have started, and which were **skipped** (pre-freeze disabled) — and it
  keeps showing the same thing after reopening the page or bouncing to Jenkins.
- While a campaign runs, **all** Jenkins freeze/resume actions are blocked for
  everyone (client-disabled + server 409); the block lifts when the campaign
  **finishes** or is **cancelled**.
- **Anyone** can cancel from any machine; cancel stops the throttled loop
  (the agent sees it via the backend within one step) and records who cancelled.
- The loop survives the initiating browser tab closing (it runs on the agent). A
  dead executor makes the run `stale`, and anyone can cancel it to release the
  lock.
- Resumed non-scheduled pipelines still re-run with their **last build's
  parameters** (brief 22 behavior, via the shared `_resume_one`).
- `agent`, `backend`, `frontend` all green: ruff + mypy + pytest (agent, backend);
  eslint + `tsc --noEmit` + vitest (frontend). New code follows `CONVENTIONS.md`.

## Verify (this machine)

Follow the local run recipe, agent on the `.QAA/E2E` scope, a folder already
frozen (brief 22):
- Trigger resume → the progress modal opens, pipelines start ~1s apart, the
  counter climbs, "Starting: X" tracks the current one, and `was_disabled`
  pipelines appear as skipped.
- Open the app in a second browser (different user) mid-run → the same modal with
  the same live progress appears there, and freeze/resume are disabled.
- Reload the page mid-run → the modal reappears from the poll, still live.
- Click Cancel in either browser → the loop stops within ~1 step, both browsers
  show cancelled, and the lock releases.
