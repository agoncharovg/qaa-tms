# Brief 05 — Stagings Namespaces: list + status + credentials + live logs

You implement the SECOND functional slice of QAA-TMS: the read-only
**Namespaces** surface. Unlike slice 04 (frontend-only), this is a **full-stack**
slice — you add four **read-only** agent endpoints that wrap the local `staging`
CLI, then replace the frontend Namespaces placeholder with a real list → detail
(status / credentials / live logs) view. Read `CONVENTIONS.md`, `discuss/03`,
`discuss/04 §5·§6·§10`, brief 04 (the patterns you reuse), and the files named
below (source of truth) FIRST.

## Ground truth about the `staging` CLI (READ THIS — it drives the whole design)
The agent shells out to the real dispatcher `~/bin/staging` (already resolved by
`agent/app/services/staging.py::resolve_staging_installation`). Relevant
subcommands:
- `staging list` — provisioned namespaces + local overlay dirs.
- `staging status <ns>` — `kubectl get pods` for the namespace.
- `staging creds <ns>` — **SENSITIVE**: sysadmin login/token, reseller creds.
- `staging logs <ns> <deploy>` — tails a deployment's logs (long-running stream).

**CRITICAL:** every command emits **human-formatted plain text** (log lines,
box-drawing `═`, tabs). There is **NO `--json` mode**. So the agent captures
stdout/stderr text and returns it verbatim; do NOT invent a structured parser that
will silently break. For `list` you MAY additionally do a best-effort parse of
namespace names, but ALWAYS keep the raw text as the source of truth.

## Hard scope rules
- These four endpoints are **read-only GETs**. They are **NOT jobs**: no `jobId`,
  no `opId`, and they **do NOT write to the backend operations journal**. Do not
  touch `backend/` at all this slice.
- `creds` output is sensitive: it is returned only over the localhost Bearer
  channel and shown in the UI. **Never** send it to the backend, never log it to
  the operations journal, never persist it to localStorage.
- Do NOT implement destroy / adopt / sync / e2e-run / grafana-creds / setup — they
  are jobs and belong to later slices. Keep this slice read-only.
- Reuse everything from slice 04: agent discovery, the Bearer `readAgentJson`
  helper, and the **fetch-SSE helper `frontend/src/api/sse.ts`** for the logs
  stream (do not re-implement SSE parsing).

## Part A — Agent (`agent/`)
Contracts to match/extend: `agent/app/api/routes.py`, `agent/app/schemas.py`,
`agent/app/core/constants.py` (`AgentPath` already has `NAMESPACES`; add
`STATUS`/`CREDS`/`LOGS` segments), `agent/app/services/staging.py`,
`agent/app/api/deps.py` (`require_auth`, settings/job-manager deps).

Add a small `agent/app/services/namespaces.py` service (mirroring
`staging.py::build_deploy_argv` style) that resolves the installation and builds
argv for each command, runs it, and captures output. All endpoints require
`Authorization: Bearer <tms-token>` (reuse `AuthDep`); raise
`503` via the existing `StagingNotInstalledError` path when `staging` is absent.

New endpoints (camelCase JSON to match the existing agent wire style):
- `GET /namespaces` → run `staging list`; return
  `{ raw: string, namespaces: string[], exitCode: number }`. `namespaces` is a
  best-effort parse (may be empty); `raw` is always the captured text.
- `GET /namespaces/{ns}/status` → run `staging status <ns>`; return
  `{ ns, raw: string, exitCode: number }`.
- `GET /namespaces/{ns}/creds` → run `staging creds <ns>`; return
  `{ ns, raw: string, exitCode: number }`. (Sensitive — see scope rules.)
- `GET /namespaces/{ns}/logs?deploy=<deployment>` → **SSE**, using the SAME frame
  format as the job stream so the frontend parser is reused unchanged: `event: log`
  / `data: {"type":"line","line":"..."}` per output line, then a final
  `event: terminal` / `data: {"type":"terminal","status":"success|failed|aborted","exitCode":<int|null>}`.
  `deploy` is a required query param; missing/empty → `422`/`400`. Support client
  disconnect / cancellation cleanly (terminate the child process). You may reuse
  the SSE encoding helper the job stream already uses (`_encode_sse` /
  `SseEvent`); factor it out if needed rather than duplicating the format.

Add matching Pydantic response schemas in `agent/app/schemas.py`
(`NamespaceListResponse`, `NamespaceStatusResponse`, `NamespaceCredsResponse`)
with `ConfigDict(populate_by_name=True)` and camelCase aliases (`exitCode`),
consistent with the existing schemas.

Agent tests (pytest + `tests/conftest.py` client fixture, mirroring
`tests/test_jobs.py` / `tests/test_ping.py`): mock the subprocess / command runner
(do NOT invoke a real cluster). Cover: list returns raw+parsed+exitCode and Bearer
is required; status/creds return captured text; logs streams synthetic lines then a
terminal frame in the exact SSE format; agent-absent → 503.

## Part B — Frontend (`frontend/`)
Replace the Namespaces **placeholder** (currently in `StagingsSection.tsx` under
`ViewKey.STAGINGS_NAMESPACES`) with a real panel `features/stagings/NamespacesPanel.tsx`.
Follow the slice-04 structure (TanStack Query v5 for reads; Zustand only for UI
selection state; the agent-absent companion-app state with Retry, reusing the
slice-02 discovery + the shared `preflightQuery` key).

- `src/api/agentClient.ts`: add `listNamespaces`, `getNamespaceStatus`,
  `getNamespaceCreds` (all `readAgentJson`, Bearer), and a `streamNamespaceLogs`
  built exactly like `streamJob` (fetch + `parseSseStream`, Bearer header,
  `AbortController`). Add the path builders in `constants.ts`
  (`buildAgentNamespaceStatusPath`, `…CredsPath`, `…LogsPath` with the `deploy`
  query param) next to `buildAgentJobStreamPath`.
- `src/api/types.ts`: add `NamespaceList`, `NamespaceStatus`, `NamespaceCreds`
  (mirror the agent schemas). The logs stream reuses the existing
  `JobLogEvent`/`JobTerminalEvent` union.
- UI: a list of namespaces (from `raw`/parsed) with an empty state; selecting one
  opens a detail drawer/panel with three sections:
  - **Status**: fetched on open, monospaced captured text.
  - **Credentials**: fetched **on demand** (button), shown masked with a
    reveal/hide toggle and a copy affordance; make the "sensitive — stays local,
    never recorded" nature explicit in the UI copy.
  - **Live logs**: a deployment input + Start/Stop; stream via the fetch-SSE
    helper into a scrollable monospaced autoscrolling log view with a status badge
    (running → terminal), reusing the slice-04 log-view + live-reducer patterns
    (`liveJobState.ts`-style reducer is fine to generalize or mirror — do not
    persist logs).
- Constants: add the Namespaces query-key constants and any path segments; all
  enumerated strings live in `src/constants.ts`. Keep the tab wiring intact — the
  Namespaces tab already exists in `SECTION_TAB_CATALOG` / `TAB_DEFINITIONS`; you
  are only replacing its rendered content.

Frontend tests (Vitest + RTL, mock fetch + synthetic SSE, no live agent): client
list/status/creds parse the wire shapes and send Bearer; list renders rows + empty
state; credentials stay masked until reveal is clicked; the logs view consumes a
synthetic SSE body (log lines → terminal) and transitions its badge; agent-absent
disables the panel and shows the companion-app state.

## Acceptance criteria (must all hold)
1. Agent exposes the four read-only endpoints above, Bearer-guarded, returning
   captured text (+ best-effort `namespaces` for list) and streaming logs in the
   exact job-stream SSE frame format; `staging` absent → 503; no backend writes.
2. Frontend Namespaces tab lists namespaces, opens a detail view with Status,
   on-demand masked Credentials (reveal/copy, never recorded), and Live logs
   streamed over authenticated fetch-SSE with a status badge and Stop; a failed/
   empty command renders gracefully (captured text + status), not as a crash.
3. Agent-absent disables the panel and shows the companion-app state with Retry.
4. Credentials are never sent to the backend, never written to the operations
   journal, and never persisted to localStorage.
5. Agent: `ruff`, `mypy`, and `pytest` all clean, with the tests above.
   Frontend: `npm run build`, `tsc --noEmit`, `eslint`, and `vitest` all clean,
   with the tests above. English-only UI; dark theme; enumerated strings in
   `src/constants.ts`.
6. `frontend/README.md` (and `agent/README.md` if it documents endpoints) updated
   with the new Namespaces flow; note there are no new env vars.

## Out of scope (do NOT do)
- Any `backend/` change; any operations-journal write for these reads.
- destroy / adopt / sync / e2e-run / grafana-creds / setup (later slices).
- Real OIDC, iframe hardening, device tokens; persisting logs or creds anywhere.

When done, ensure the agent (`ruff`/`mypy`/`pytest`) and the frontend
(`npm install`, `npm run build`, `tsc --noEmit`, `eslint`, `vitest`) all succeed,
then stop. Do not commit — the reviewer inspects `git diff` and commits.
