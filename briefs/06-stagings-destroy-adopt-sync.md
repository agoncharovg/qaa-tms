# Brief 06 — Stagings job operations: destroy + adopt + sync

You implement the THIRD functional slice: three **job-creating** operations —
`destroy`, `adopt`, and `sync` — that reuse the deploy job plumbing end to end
(agent job → live SSE log → recorded operation → History). This is **full-stack**
(agent + frontend); **no `backend/` change** (the backend already supports these
operation types and the ops list/detail/replay is generic). It also folds in a
**fix to the brief-05 Namespaces list parsing** (Part C) — the flat name list
conflates cluster namespaces with local-only overlay directories, which must be
split and labeled. Read `CONVENTIONS.md`,
`discuss/04 §5·§8·§9·§10`, briefs 04 and 05 (the plumbing you reuse), and the
files named below (source of truth) FIRST.

## Ground truth about the `staging` CLI (see also [[reference_staging_cli]])
These three map to real dispatcher subcommands:
- `staging destroy <ns>` → tears down the namespace (delegates to
  `deploy.py <ns> --destroy`). Input: a namespace.
- `staging adopt <ns>` → pulls a handed-off namespace's creds + overlay from the
  cluster. Input: a namespace (positional; no flags).
- `staging sync [flags]` → drift detection (`sync_check.py`). It is **global**
  (NOT namespace-scoped). Real flags: `--service <name>`, `--verbose`, `--pull`,
  `--apply`.

All three stream human text and are long-running → they are **jobs**, exactly like
deploy: agent runs the subprocess, streams stdout/stderr over SSE, records the
operation in the backend journal, and supports cancel.

## Existing plumbing you reuse (do NOT re-implement)
- Agent: `app/services/jobs.py` (`JobManager`, the generic `_run_deploy_job`
  runner, `stream_job`, `cancel_job`), `app/services/backend.py`
  (`build_operation_payload`, `push_operation`), `app/services/staging.py`
  (`build_deploy_argv`, `resolve_staging_installation`), `app/api/routes.py`,
  `app/schemas.py`, `app/core/constants.py` (`AgentPath.DESTROY/ADOPT/SYNC`,
  `OperationType`).
- Frontend: the Deploy tab's live-job log (stream via `streamJob`, status badge,
  Cancel, terminal → invalidate operations), `src/api/sse.ts`, the History tab,
  `agentClient`, `constants.ts`, the per-section tab model in `uiStore.ts`.

## Part A — Agent (`agent/`)
The job runner is already operation-agnostic; the deploy-specific pieces are
`create_deploy_job`, the `Job.request: DeployRequest` typing, and
`build_operation_payload` (hardcodes `type=DEPLOY` and a deploy recipe).
**Generalize these WITHOUT regressing deploy** (all existing agent tests must stay
green):
- Carry the operation `type`, `ns` (nullable), and a `recipe` dict on the `Job`
  (or an equivalent) so one runner serves all four operations. Refactor
  `build_operation_payload` to take an explicit `type`, `ns`, and `recipe`
  (keep the existing deploy call producing the identical payload it does today).
- Add argv builders in `staging.py` mirroring `build_deploy_argv`:
  `build_destroy_argv(ns)` → `staging destroy <ns>`, `build_adopt_argv(ns)` →
  `staging adopt <ns>`, `build_sync_argv(flags)` → `staging sync` + the mapped
  flags. Each raises the existing `StagingNotInstalledError` when `staging` is
  absent.
- Add `JobManager.create_destroy_job` / `create_adopt_job` / `create_sync_job`
  (or one parametrized creator) that build the argv, set the right
  type/ns/recipe, and schedule the shared runner. Recipes:
  destroy/adopt → `{}` (empty recipe; `ns` set); sync → `{ flags: {service, verbose, pull, apply} }`, `ns = null`.

New endpoints (return the SAME `{ jobId, opId }` shape as deploy; Bearer-guarded
via the existing `AuthDep`; 503 via `StagingNotInstalledError` when absent):
- `POST /destroy` body `{ ns }` → `JobCreateResponse`.
- `POST /adopt` body `{ ns }` → `JobCreateResponse`.
- `POST /sync` body `{ flags: { service?: string, verbose?: bool, pull?: bool, apply?: bool } }`
  → `JobCreateResponse`.

Add Pydantic request schemas (`DestroyRequest`, `AdoptRequest`, `SyncRequest`,
`SyncFlags`) with the existing `ConfigDict` conventions. Reuse `GET /jobs/{id}`,
`GET /jobs/{id}/stream`, and `POST /jobs/{id}/cancel` unchanged — do NOT add new
job endpoints.

Agent tests (pytest, mirroring `tests/test_jobs.py` with the fake-staging-bin +
`httpx.MockTransport` harness; no real cluster): each of destroy/adopt/sync builds
the correct argv (esp. the sync flag mapping), returns `{ jobId, opId }`, streams a
terminal event, and pushes an operation with the correct `type`/`ns`/`recipe` to
the backend; Bearer required; `staging` absent → 503. Keep the deploy tests
passing.

## Part B — Frontend (`frontend/`)
Reuse the Deploy tab's live-job experience. **Extract the live-job log panel**
(log view + status badge + Cancel + "View in history" + terminal→invalidate
operations, currently inside `DeployPanel.tsx`) into a shared component so
destroy/adopt/sync render the identical experience without duplication. Keep
`liveJobState.ts` as the shared reducer.

- `agentClient`: add `destroy`, `adopt`, `sync` (POST → `JobCreateResponse`, exact
  bodies above, Bearer). Reuse `streamJob`/`getJob`/`cancelJob` for the resulting
  job — a job from any of these is indistinguishable from a deploy job.
- Types/constants: add `DestroyRequest`, `AdoptRequest`, `SyncRequest`,
  `SyncFlags`; reuse `AgentPath.DESTROY/ADOPT/SYNC`; add any query-key/tab
  constants. All enumerated strings in `src/constants.ts`.
- **destroy + adopt** are per-namespace → surface them in the **Namespaces detail
  drawer** (a namespace is already selected there, brief 05). Each starts its job
  and shows the shared live-job panel. **destroy is destructive → require an
  explicit confirmation** (e.g. type-the-namespace-to-confirm or a confirm modal)
  before the agent call.
- **sync** is global → add a new **`stagings-sync` tab** (wire into
  `SECTION_TAB_CATALOG`/`TAB_DEFINITIONS`, per-section tab model intact) with a
  small flags form (`service` text, `verbose`/`pull`/`apply` checkboxes) building
  the exact `SyncRequest`, then the shared live-job panel.
- A completed destroy/adopt/sync job must **invalidate the operations list** so
  History refreshes (same as deploy).
- **History Replay:** the replay-to-Deploy-form flow only makes sense for `deploy`
  operations. Restrict Replay in the History detail drawer to `type === deploy`
  (hide/disable for destroy/adopt/sync). Detail + full log still show for all
  types.

Frontend tests (Vitest + RTL, mock fetch + synthetic SSE, no live agent):
`agentClient.destroy/adopt/sync` send the exact bodies + Bearer; the sync form
builds the correct `SyncRequest`; the destroy confirmation gates the agent call
(no call until confirmed); the shared live-job panel renders streamed lines and the
terminal status; History hides Replay for a non-deploy operation.

## Part C — Fix the Namespaces list parsing (REVISES brief 05)
Brief 05's `GET /namespaces` returns a single flat `namespaces: string[]` that its
best-effort parser produces by walking every line of `staging list`. That is
WRONG: `staging list` emits **two labeled sections** and the flat parse conflates
them, so local-only overlay directories and cluster infra namespaces all appear as
if they were live namespaces. Real output shape:

```
[OK]    Prerequisites OK (...)
[INFO]  Provisioned namespaces on frn-stg cluster:
calico-system     Active   2026-02-11T11:49:58Z
qaa-arl-07-08-3   Active   2026-08-07T15:17:19Z
...
[INFO]  Local overlay directories:
  qaa-iam      (local only -- not on cluster)
  qaa-billing  (local only -- not on cluster)
...
```
(Lines are ANSI-colored; the agent captures `raw` verbatim including the escapes.)

Replace the flat parse with a **section-aware, structured** parse:
- Agent: change `GET /namespaces` response to
  `{ raw: string, clusterNamespaces: [{ name, status, createdAt? }], localOverlays: [{ name }], exitCode: number }`.
  Drop the flat `namespaces` field. In `services/namespaces.py`, **strip ANSI
  escapes before parsing** (raw stays verbatim), detect the two section headers
  (`Provisioned namespaces … cluster:` and `Local overlay directories:`,
  case-insensitive), and assign each subsequent data line to the active section:
  cluster lines split into `name` / `status` / `createdAt` (best-effort — a line
  with no timestamp still yields at least `name` + `status`); overlay lines take
  the first token as `name`. Update `NamespaceListResponse` (camelCase aliases:
  `clusterNamespaces`, `localOverlays`, `createdAt`, `exitCode`) accordingly.
- Frontend: update `NamespaceList` type and `NamespacesPanel` to render **two
  clearly labeled groups** — cluster namespaces with an "Active"/status badge, and
  local overlays with a "Local only — not on cluster" badge — instead of one
  undifferentiated list. The raw CLI output block stays (source of truth). Both
  groups can select a namespace to open the detail drawer; keep the empty state per
  group. Selecting a local-only overlay is allowed (destroy applies to it; adopt is
  the cluster-only path) — you need not hard-gate actions by origin this slice, but
  do surface the origin badge so the two are never confused again.
- Well-known infra namespaces (e.g. `calico-system`, `tigera-operator`, `registry`,
  `metrics-server`, `vector`, `victorialogs`, `developers`) may OPTIONALLY be
  visually de-emphasized/grouped via a single centralized `as const` denylist in
  `src/constants.ts` — but this is optional polish, not required, and must never
  hide the raw output. Do NOT invent a fragile "is this a staging namespace"
  classifier beyond that documented list.

Update the brief-05 tests you touch: the agent list test asserts the structured
cluster/overlay split (with an ANSI-colored two-section fixture, and a local-only
entry that must NOT appear among cluster namespaces); the frontend test asserts the
two groups render with the correct badges and that a local-only overlay is labeled
as such (not "active").

## Acceptance criteria (must all hold)
0. `GET /namespaces` returns the structured `clusterNamespaces` / `localOverlays`
   split (no flat `namespaces` list); the Namespaces panel shows the two groups
   with distinct status badges so local-only overlays and cluster infra namespaces
   are never presented as live namespaces; raw output remains the source of truth.
1. Agent exposes `POST /destroy`, `POST /adopt`, `POST /sync`, each Bearer-guarded,
   returning `{ jobId, opId }`, streaming live output over the existing job SSE,
   recording an operation with the correct `type`/`ns`/`recipe`, and cancelable via
   the existing `/jobs/{id}/cancel`; `staging` absent → 503. Deploy is unregressed.
2. Frontend: destroy + adopt run from the Namespaces drawer (destroy behind an
   explicit confirmation) and sync runs from a new Sync tab; all three show the
   shared live-job log with status badge and working Cancel; a failed job (e.g. no
   VPN) renders as `failed` with its log, not a crash.
3. A completed destroy/adopt/sync job refreshes the History list; those operations
   appear in History with detail + full log; Replay is offered only for `deploy`.
4. No `backend/` change. Agent: `ruff`, `mypy`, `pytest` clean (with the tests
   above, deploy tests still green). Frontend: `npm run build`, `tsc --noEmit`,
   `eslint`, `vitest` clean (with the tests above). English-only UI; dark theme;
   enumerated strings in `src/constants.ts`.
5. `frontend/README.md` and `agent/README.md` updated with the new operations;
   note there are no new env vars.

## Out of scope (do NOT do)
- Any `backend/` change.
- `e2e-run`, `grafana-creds`, `setup`, and the interactive `iam`/`billing` wizards
  (later slices).
- Real OIDC, iframe hardening, device tokens; persisting job logs anywhere.
- Changing the existing deploy/namespaces behavior beyond the shared-component
  refactor and the Replay-type restriction.

When done, ensure the agent (`ruff`/`mypy`/`pytest`) and the frontend
(`npm install`, `npm run build`, `tsc --noEmit`, `eslint`, `vitest`) all succeed,
then stop. Do not commit — the reviewer inspects `git diff` and commits.
