# Brief 07 — Stagings E2E: suite registry + e2e-run job

You implement the FOURTH functional slice: the **E2E** surface — pick a product,
choose named suites from the registry, and trigger an `e2e-run` job that streams
live output into the shared live-job panel and lands in History. This is
**full-stack** (agent + frontend); **no `backend/` change** (the backend already
has `OperationType.e2e_run` and the `Product` enum). Read `CONVENTIONS.md`,
`discuss/04 §5·§7·§8·§9·§10`, briefs 04–06 (the plumbing you reuse — especially
`SyncPanel` as the closest template: a tab with a form that starts a job and shows
`LiveJobPanel`), and the files named below (source of truth) FIRST.

## Ground truth about the `staging e2e-run` CLI (READ THIS — it drives the design)
`staging e2e-run <ns> [flags]` → `scripts/e2e_run.py`. Key facts:
- It does **NOT run pytest locally**. It builds params and **triggers a Jenkins
  pipeline via Leonid**, then (default `--watch`) polls Leonid until the build
  finishes, printing progress to stdout. From the agent's view this is just
  another long-running subprocess whose stdout streams over SSE — it fits the
  existing job model unchanged. Runs can be long (`--watch` default timeout 120
  min). Needs VPN + Leonid reachable; without them it fails fast → the job ends
  `failed` with its captured log (NOT an app error), same as deploy.
- **Suite registry** = the static `PRODUCT_MARKS` dict in `e2e_run.py`, keyed by
  product → `{ suiteName: marksExpression }`. Products:
  `PRODUCTS = ("Billing", "IAM", "CDN", "DNS", "Notifications")` (exactly the
  frontend `Product` values). `staging e2e-run <ns> --product <P> --list-suites`
  prints the registry for a product and exits **before any namespace / cluster /
  Leonid interaction** (the `<ns>` positional is required by argparse but unused in
  this mode). Output shape:
  ```
  Suites for IAM:
    full              backend_test and product_iam and not long_term
    smoke             product_iam and smoke and not long_term
    ...
  ```
- Relevant flags: `--product <P>` (required), `--suite name[,name]`
  (comma-separated, joined with `or`), `--threads N` (xdist, default 5). Ignore
  `--smoke/--marks/--mark/--dry-run/--no-watch/--pipeline-*` for this slice.

## Part A — Agent (`agent/`)
Reuse the job plumbing generalized in brief 06 (`JobManager._create_job/_run_job`,
`build_operation_payload(type,ns,recipe)`, the argv-builder pattern in
`services/staging.py`, the read-command pattern in `services/namespaces.py`).
`AgentPath.E2E_SUITES` (`/e2e/suites`) and `AgentPath.E2E_RUN` (`/e2e-run`) already
exist. The agent has **no `Product` enum** — add a `Product` `StrEnum` in
`app/core/constants.py` whose values exactly equal `PRODUCTS`.

Endpoints (Bearer-guarded via `AuthDep`; 503 via `StagingNotInstalledError` when
`staging` is absent):
- `GET /e2e/suites?product=<Product>` → a **read** (not a job): run
  `staging e2e-run <placeholder-ns> --product <P> --list-suites` (use a fixed
  placeholder ns constant — it is unused in list-suites mode; strip ANSI as in
  `namespaces.py`), parse the `  <name>  <marks>` lines (skip the `Suites for …:`
  header) into `{ product, suites: [{ name, marks }], exitCode }`. Validate
  `product` against the `Product` enum (invalid → `422`). This works with no VPN /
  cluster. Add a small `services/e2e.py` (or extend an existing service) for the
  argv builder + parse, mirroring the namespaces service.
- `POST /e2e-run` body `{ ns, product, suites: string[], threads?: number }` →
  `JobCreateResponse` `{ jobId, opId }`. argv:
  `staging e2e-run <ns> --product <P>` + `--suite <comma-joined>` when `suites` is
  non-empty + `--threads <N>` when `threads` is provided. Create the job via a new
  `JobManager.create_e2e_run_job` (delegating to `_create_job`) with
  `operation_type = e2e_run`, `ns = ns`, and `recipe = { product, suites, flags: { threads } }`
  (map into the backend `OperationRecipe`: set `product`, `suites`, and
  `flags.threads`). Reuse `GET /jobs/{id}`, `/jobs/{id}/stream`, `/jobs/{id}/cancel`
  unchanged — do NOT add job endpoints.
  - **Cancel caveat:** cancelling the job kills the local `e2e_run.py` watch
    process (stops polling) but does NOT abort the already-triggered remote Jenkins
    build. Note this in code and surface it in the UI copy (Part B).

Add Pydantic schemas (`E2eSuite {name, marks}`, the `GET /e2e/suites` response,
`E2eRunRequest {ns, product: Product, suites: list[str], threads: int | None}`)
with the existing `ConfigDict` conventions and camelCase aliases where the wire
uses them.

Agent tests (pytest, mirroring `tests/test_namespaces.py` / `tests/test_jobs.py`
with the fake-staging-bin + `httpx.MockTransport` harness; no real cluster/Leonid):
`GET /e2e/suites` parses a sample `--list-suites` output into `[{name, marks}]` and
rejects an invalid product (`422`); `POST /e2e-run` builds the correct argv (product,
comma-joined suites, threads), returns `{ jobId, opId }`, and pushes an operation
with `type=e2e_run` / `ns` / `recipe={product,suites,flags:{threads}}`; Bearer
required; `staging` absent → `503`.

## Part B — Frontend (`frontend/`)
Add a new **`stagings-e2e` tab** (wire `ViewKey`/`TabId`/`TabTitle` "E2E" into
`SECTION_TAB_CATALOG` / `TAB_DEFINITIONS` / `WorkspaceContent` / `StagingsSection`,
per-section tab model intact). Model it on `SyncPanel` + the shared
`LiveJobPanel`/`useTransientLiveJob`.

`E2ePanel`:
- A **Product** select (from the `Product` const). On product change, TanStack
  Query `GET /e2e/suites?product=<P>` loads the registry.
- A **non-editable suite picker** (checkboxes of the returned suite names — the
  user selects from the registry, cannot type arbitrary suites, per discuss/04 §7);
  show each suite's `marks` expression as secondary text.
- `ns` text input (required) and an optional `threads` number.
- **Run** builds the exact `E2eRunRequest` and calls `agentClient.e2eRun` → reveals
  the shared `LiveJobPanel` for the returned job (live log + status badge + Cancel +
  "View in history"; terminal → invalidate the operations list). Disable Run while
  a job runs or the agent is absent or `ns` is empty.
- Reuse the slice-02 discovery + shared `preflightQuery` for the agent-absent
  companion-app state with Retry.
- Make the Cancel caveat explicit in the UI (cancel stops local watching; the
  remote Jenkins build keeps running).

Client/types/constants: add `agentClient.getE2eSuites(port, token, product)` and
`agentClient.e2eRun(port, token, body)` (Bearer; reuse `readAgentJson`); a
`buildAgentE2eSuitesPath(product)` builder (`/e2e/suites?product=<encoded>`) in
`constants.ts`; types `E2eSuite`, `E2eSuitesResponse`, `E2eRunRequest`; query-key
constants. All enumerated strings in `src/constants.ts`.

History already labels `e2e_run` ("E2E run") and shows detail + full log; Replay
stays deploy-only (brief 06) — do NOT offer replay for e2e runs.

Frontend tests (Vitest + RTL, mock fetch; no live agent): `getE2eSuites` /
`e2eRun` send the correct params + Bearer; suites render for a selected product and
the selection builds the correct `E2eRunRequest`; the agent-absent state disables
Run.

## Acceptance criteria (must all hold)
1. Agent exposes `GET /e2e/suites?product=` (a Bearer-guarded read returning
   `[{name, marks}]` parsed from `--list-suites`, invalid product → 422, works
   with no VPN) and `POST /e2e-run` (Bearer, returns `{jobId, opId}`, streams live
   output over the existing job SSE, records an operation with
   `type=e2e_run`/`ns`/`recipe={product,suites,flags:{threads}}`, cancelable via
   `/jobs/{id}/cancel`); `staging` absent → 503.
2. Frontend E2E tab: select a product → see its suites (non-editable, with marks) →
   pick suites + ns (+ optional threads) → Run streams the live job log with a
   status badge and working Cancel; a failed run (no VPN/Leonid) renders as
   `failed` with its log, not a crash; the Cancel caveat is surfaced.
3. A completed e2e-run refreshes the History list and appears there with detail +
   full log; Replay is not offered for it.
4. No `backend/` change. Agent: `ruff`, `mypy`, `pytest` clean (with the tests
   above, prior tests still green). Frontend: `npm run build`, `tsc --noEmit`,
   `eslint`, `vitest` clean (with the tests above). English-only UI; dark theme;
   enumerated strings in `src/constants.ts`.
5. `frontend/README.md` and `agent/README.md` updated with the E2E flow; note there
   are no new env vars.

## Out of scope (do NOT do)
- Any `backend/` change.
- `grafana-creds`, `setup`, the interactive `iam`/`billing` wizards,
  `billing-deploy-test`, and e2e flags beyond `--product/--suite/--threads`
  (`--smoke/--marks/--mark/--dry-run/--no-watch/--pipeline-*`).
- Aborting the remote Jenkins build on cancel; polling Leonid/Jenkins directly from
  TMS; real OIDC, iframe hardening, device tokens; persisting logs anywhere.

When done, ensure the agent (`ruff`/`mypy`/`pytest`) and the frontend
(`npm install`, `npm run build`, `tsc --noEmit`, `eslint`, `vitest`) all succeed,
then stop. Do not commit — the reviewer inspects `git diff` and commits.
