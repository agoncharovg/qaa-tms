# Brief 04 — Stagings deploy flow: deploy form + live job log (SSE) + operations history & replay

You implement the FIRST FUNCTIONAL slice of QAA-TMS on top of the scaffold from
slices 01–03. This is **`frontend/`-ONLY**: it wires the already-existing agent
and backend endpoints into a working end-to-end Stagings workflow —
**deploy → live streaming log → recorded operation → history → replay**. Read
`CONVENTIONS.md`, `discuss/02`, `discuss/03 §5·§7`, and `discuss/04 §5·§8·§9·§10`
first (source of truth).

## Hard scope rule
- Change **only `frontend/`**. Do NOT modify `backend/` or `agent/` — both
  already expose every endpoint this slice needs (verified). If you believe a
  backend/agent change is truly required, STOP and leave a note at the top of
  your final message instead of editing them.

## Existing wire contracts you build on (do NOT re-implement; match exactly)
Read these files as the contracts: `agent/app/schemas.py`,
`agent/app/api/routes.py`, `backend/app/schemas/operation.py`,
`backend/app/api/v1/operations.py`, plus the existing
`frontend/src/api/{agentClient,backendClient,types}.ts` and
`frontend/src/constants.ts`.

Agent (base = discovered `http://127.0.0.1:<port>`, all except /ping need
`Authorization: Bearer <tms-token>`):
- `POST /deploy` body `{ ns, services: string[], images: Record<svc,tag>,
  flags: { full, dryRun, noSync, stage } }` → `{ jobId, opId }`.
- `GET /jobs/{id}` → `{ jobId, opId, status, argv, exitCode, createdAt,
  startedAt, finishedAt }` (camelCase).
- `GET /jobs/{id}/stream` → **SSE**. Events: `event: log` /
  `data: {"type":"line","line":"..."}` per output line, then a final
  `event: terminal` / `data: {"type":"terminal","status":"success|failed|aborted","exitCode":<int|null>}`.
- `POST /jobs/{id}/cancel` → same shape as `GET /jobs/{id}`.

Backend (`http://localhost:8000`, Bearer):
- `GET /api/v1/operations?limit&offset&status&type&ns&user_id` →
  `{ items: OperationSummary[], total, limit, offset }`. Non-admin users are
  auto-scoped to their own operations; admins see all. `limit` 1–100 (default
  20), `offset` ≥ 0.
- `GET /api/v1/operations/{id}` → `OperationRead` (includes full `log`).
- `GET /api/v1/operations/{id}/replay` → `{ id, type, ns, recipe:{ product,
  services, images, suites, flags } }`.
- `OperationSummary` fields (snake_case on the wire): `id, user_id, type, ns,
  recipe, status, started_at, finished_at, exit_code, agent_host,
  agent_version, stagings_sha, created_at`. `OperationRead` adds `log`.

## ⚠️ SSE gotcha (must handle correctly)
The browser's native `EventSource` **cannot send an `Authorization` header**,
but `GET /jobs/{id}/stream` requires the Bearer token. So consume the SSE
stream with `fetch()` + a `ReadableStream` reader that parses `event:`/`data:`
frames yourself — NOT `EventSource`. Put the parser in a small, unit-tested
helper. Support cancellation via `AbortController` (used by the Cancel button
and on unmount).

## Features
1. **Deploy tab** (new, in the Stagings section):
   - Form: `ns` (text, required), `services` (editable list / comma input →
     `string[]`), image overrides (rows of `service` + `tag` → `Record`),
     flags `full` / `dryRun` / `noSync` (checkboxes) and `stage`
     (optional number 0–7). Build the exact `POST /deploy` body; flags serialize
     camelCase (`dryRun`, `noSync`).
   - Submit → agent `POST /deploy` → receive `{ jobId, opId }` → reveal the live
     log panel for that job. Disable submit while a job is running.
   - If NO agent is detected (reuse the slice-02 discovery), disable deploy and
     show the "Companion app is not running" state with Retry.
2. **Live job log** (within the Deploy tab once a job starts):
   - Stream `GET /jobs/{id}/stream` via the fetch-SSE helper; append each `line`
     to a scrollable, monospaced log view (autoscroll to bottom).
   - Show a status badge that transitions `running → success | failed | aborted`
     and the final `exitCode`. A **Cancel** button calls `POST /jobs/{id}/cancel`
     while running.
   - On terminal, offer a "View in history" affordance that opens the History
     tab focused on `opId`.
   - Note: a real deploy needs VPN + a reachable cluster; without them the
     `staging` process fails fast and the job ends `failed` — the UI must render
     that gracefully (failed status + captured log), it is NOT an app error.
3. **History tab** (new, in the Stagings section):
   - TanStack Query over backend `GET /api/v1/operations` (paginated). Table
     columns: type, ns, status, started/created time, agent host, stagings SHA.
     Empty state when there are none.
   - Row → detail panel/drawer via `GET /api/v1/operations/{id}` showing the
     recipe and the full `log` (monospaced).
   - **Replay**: `GET /api/v1/operations/{id}/replay` → prefill the Deploy form
     with the returned recipe (`ns`, `services`, `images`, `flags`) and switch to
     the Deploy tab so the user can review and re-submit (execution is always a
     fresh agent `POST /deploy`, per discuss/04 §10C).

## State discipline (CONVENTIONS + slice-02 pattern)
- **Server state via TanStack Query v5**: deploy mutation, `GET /jobs/{id}`
  polling/fallback, operations list, operation detail, replay fetch. The live
  SSE stream is managed with an effect + the fetch-reader (not a query), but its
  terminal result should invalidate the operations list query so History
  refreshes.
- **Zustand only for UI/session state**: the new tabs live in the existing
  per-section tab model. Any "currently streaming job id" that must survive tab
  switches within the session may live in a small client store, but prefer
  component state where it suffices. Persisted-to-localStorage pieces stay
  minimal (do not persist job logs).

## Constants (`src/constants.ts` — no stray literals)
Extend, don't scatter:
- `TabId` / `ViewKey` / `TabTitle`: add `stagings-deploy` and `stagings-history`
  (plus wire them into `SECTION_TAB_CATALOG` and `TAB_DEFINITIONS` in
  `uiStore.ts`, keeping per-section tab behavior intact).
- `BackendPath`: add an operations-replay path builder or a `REPLAY` segment;
  keep a single helper for `/operations/{id}` and `/operations/{id}/replay`.
- Reuse existing `AgentPath.DEPLOY/JOBS/CANCEL` and `buildAgentJobStreamPath`.
- Add query-key constants for the new TanStack queries; string-literal unions /
  `as const` objects only.

## Types (`src/api/types.ts`)
Add `DeployRequest`, `DeployFlags`, `JobRead`, the SSE event union
(`JobLogEvent` / `JobTerminalEvent`), and the operation types (`OperationSummary`,
`OperationRead`, `OperationReplay`, `OperationRecipe`) mirroring the agent and
backend schemas above. Wire status/type as string-literal unions matching the
backend enums (`deploy|destroy|e2e_run|adopt|sync|setup`,
`queued|running|success|failed|aborted`).

## Tests (Vitest + RTL — meaningful, no live cluster/agent)
Mock `fetch` (backend + agent) and feed a synthetic SSE body. Cover at least:
1. The **SSE parser** helper: given a chunked `event:/data:` byte stream, yields
   the correct ordered `log` lines then the `terminal` event (including a split
   frame across two chunks).
2. `agentClient.deploy` sends the exact JSON body (services/images/flags with
   camelCase `dryRun`/`noSync`) and Bearer header; returns `{ jobId, opId }`.
3. `backendClient` operations list/detail/replay parse the wire shapes; list
   passes `limit`/`offset`.
4. Deploy form → correct `DeployRequest` for representative input.
5. Live-log reducer/state: appends lines and transitions to the terminal status
   + exit code.
6. History: renders rows from a mocked list; clicking **Replay** prefills the
   Deploy form from a mocked replay recipe.
7. Graceful: agent-absent disables the Deploy submit and shows the companion-app
   state.

## Acceptance criteria (must all hold)
1. Stagings section has working **Deploy**, **History** (and the existing
   **Preflight**, plus the Namespaces placeholder) tabs; per-section tab
   open/close/switch still works and survives reload.
2. Submitting the Deploy form calls the agent `POST /deploy`, then streams the
   job's live output (via fetch-SSE with the Bearer header) into a log view with
   a status badge and a working Cancel; a failed deploy (e.g. no VPN) renders as
   `failed` with its log, not as a crash.
3. History lists operations from the backend (self-scoped for non-admin),
   opens a detail view with the full log, and **Replay** prefills the Deploy
   form from the backend recipe for a fresh re-submit.
4. A completed job invalidates/refreshes the History list.
5. `npm run build`, `tsc --noEmit`, `eslint`, and `vitest` are all clean;
   tests include the cases above. English-only UI; dark theme; all enumerated
   strings in `src/constants.ts`.
6. `frontend/README.md` updated with the new Stagings deploy/history flow and
   any new env notes (there should be none new).

## Out of scope (do NOT do)
- Any `backend/` or `agent/` change.
- Real Namespaces list/status/creds, grafana-creds, destroy/adopt/sync, and
  e2e-run (later slices) — keep the Namespaces placeholder as-is.
- Real OIDC, iframe hardening, device tokens.
- Persisting job logs or history to localStorage.

When done, ensure `npm install`, `npm run build`, `tsc --noEmit`, `eslint`, and
`vitest` all succeed in `frontend/`, then stop. Do not commit — the reviewer
inspects `git diff` and commits.
