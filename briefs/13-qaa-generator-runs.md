# Brief 13 — qaa-generator plugin (MVP: Generate / Live / Runs) via backend proxy

Add a new **builtin** ("общий", first-party) plugin `qaa-generator` that lets any
authenticated user launch and follow **test-generation runs** on the external
`qaa-generator` service (deployed in k8s, REST API on `:8080/api/v1`, bearer +
optional `Actor` delegation). Three tabs: **Generate** (create a run), **Live**
(SSE live progress of one run with pause/resume/stop), **Runs** (filterable list
with cursor pagination + run detail/artifacts read-only inline).

Because `qaa-generator` is a **centrally reachable service** (unlike Stagings'
local CLI), this plugin talks to the **app backend**, which proxies to
qaa-generator over `httpx`. The service token never reaches the browser. This is
the "общий" model: every user sees the same runs. `origin: "builtin"`,
`kind: "optional"`, `requiresAgent: false`.

Admin of qaa-generator (users/service-tokens, superuser-only) is a **separate,
admin-only tab** — see **brief 14**, NOT this brief.

Read FIRST:
- `discuss/06` §1 (trust model П1/П2), §3 (contract), §5 (render adapter).
- `briefs/12-unified-plugin-contract.md` — the plugin contract this rides on.
- `briefs/04-stagings-deploy-history.md`, `briefs/07-stagings-e2e-run.md` — the
  live-job + history patterns being mirrored.
- Frontend template: `frontend/src/plugins/stagings/manifest.tsx`,
  `StagingsSection.tsx`, `E2ePanel.tsx`, `LiveJobPanel.tsx`,
  `useTransientLiveJob.ts`, `liveJobState.ts`, `HistoryPanel.tsx`;
  `frontend/src/api/backendClient.ts`, `sse.ts`, `types.ts`;
  `frontend/src/core/plugins/{definePlugin.ts,types.ts,icons.ts}`;
  `frontend/src/plugins/discovery.ts`; `frontend/src/store/uiStoreCore.ts`;
  `frontend/src/constants.ts`.
- Backend template: `backend/app/api/v1/{__init__.py,operations.py,users.py}`,
  `backend/app/api/deps.py`, `backend/app/core/{config.py,constants.py}`,
  `backend/app/main.py`, `backend/app/models/operation.py`,
  `backend/app/schemas/operation.py`, `backend/tests/conftest.py`,
  `backend/tests/test_operations.py`.
- `CONVENTIONS.md` + brief 09 — no inline string/number literals; enumerate.

---

## Trust & wiring model (read before coding)

```
browser (JWT)  →  app backend  →  qaa-generator :8080/api/v1
                  httpx client     Authorization: Bearer <QAA_GENERATOR_SERVICE_TOKEN>
                                   Actor: <optional delegation>
```

- The **service token** for qaa-generator lives only in backend settings, never
  in the SPA. The SPA authenticates to the backend with its normal JWT; the
  backend re-authenticates outward. This preserves `discuss/06` П1 (no external
  creds in the browser).
- **Attribution** of who launched a run is recorded in **our** `operations`
  audit (`user_id` = current app user). See Part C.
- **Delegation (`Actor` header) — decision:** qaa-bot delegates as
  `Actor: slack:<id>`, and qaa-generator authorizes the delegated actor (403 if
  unknown). Company convention: **`username` IS the email** (users authenticate
  by typing their email into the username field). So derive a per-user actor
  `Actor: email:<username>` — giving real end-to-end attribution inside
  qaa-generator too. **Guard (decisive):** the dev-seed users `test` / `admin`
  are NOT emails. Only send `email:<username>` when `username` looks like an
  email (contains `@`); otherwise fall back to `QAA_GENERATOR_ACTOR`
  (default empty ⇒ omit the `Actor` header). Do NOT rename the `username`
  field or add email-format validation (it would break the dev-login stub);
  keep the convention implicit in the model, explicit only in this actor
  derivation. Attribution is ALSO recorded in our own `operations` audit
  regardless.
- One active run per Jira key: qaa-generator returns **409** with
  `{"error": ..., "run_id": <existing>}`. The backend must pass this through so
  the UI can offer "open the existing run".

---

## Hard scope rules
- **In scope:** one new backend router that proxies runs (create/list/get/
  pause/resume/stop/events-stream/artifacts) + records to `operations`; backend
  settings + httpx client; one new frontend builtin plugin folder with 3 tabs;
  client methods + SSE; constants; tests; docs.
- **OUT of scope (do NOT do):** the Admin tab / qaa-generator user & token
  management (→ brief 14); any change to Stagings/Admin plugins; changing the
  plugin contract; MCP/A2A transports (REST only); renaming `username`→`email`
  or adding email-format validation to our user model (see the delegation
  decision); the local agent (this plugin does NOT use the agent).
- English-only UI, dark theme, Mantine, enumerated constants.

---

## Part A — Backend config & constants

**A1.** `backend/app/core/constants.py`:
- `EnvKey`: add `QAA_GENERATOR_BASE_URL`, `QAA_GENERATOR_SERVICE_TOKEN`,
  `QAA_GENERATOR_ACTOR`.
- `RoutePath`: add `QAA_RUNS = "/qaa/runs"` (router prefix; `/api/v1` is applied
  in `api/v1/__init__.py` via `ApiPrefix.V1`). Add the sub-path suffixes as
  enum members too (no inline literals): `PAUSE = "/pause"`, `RESUME =
  "/resume"`, `STOP = "/stop"`, `EVENTS_STREAM = "/events/stream"`,
  `ARTIFACTS = "/artifacts"`, and a `RUN_BY_ID = "/qaa/runs/{run_id}"` style
  route if you register per-id routes with path params.
- `ApiTag`: add `QAA_GENERATOR = "qaa-generator"`.
- `HttpHeader`: add the header names the proxy sets outward — `AUTHORIZATION`,
  `ACCEPT`, `CONTENT_TYPE`, `ACTOR = "Actor"`, `IDEMPOTENCY_KEY =
  "Idempotency-Key"`, `LAST_EVENT_ID = "Last-Event-ID"`.
- Add a `MediaType(StrEnum)` (new) with `JSON = "application/json"` and
  `TEXT_EVENT_STREAM = "text/event-stream"`.
- `OperationType`: add `QAA_GENERATE = "qaa_generate"`. The column is
  `native_enum=False` (stored as string), so **no Alembic enum migration is
  needed** — verify the existing `Enum(...)` VARCHAR length accommodates the new
  value; if a fixed length exists, widen it in a migration.

**A2.** `backend/app/core/config.py` — add to `Settings` (pattern:
`Field(default=..., alias=EnvKey.X.value)`):
- `qaa_generator_base_url: str` default e.g.
  `"http://qaa-generator.default.svc.cluster.local:8080/api/v1"` (base already
  includes `/api/v1`; client appends `/runs` etc.).
- `qaa_generator_service_token: str` default `""`.
- `qaa_generator_actor: str` default `""` (empty ⇒ omit `Actor`).
- Add all three to `backend/.env.example`.

## Part B — Backend outbound httpx client

There is **no** httpx client today (`httpx` is a declared dep but unused in
`app/`). Add a shared `httpx.AsyncClient`:
- Create it in the `lifespan` in `backend/app/main.py`, store on
  `app.state.qaa_generator_client` (mirroring `engine`/`session_maker`/
  `settings`); `await client.aclose()` on shutdown. Base URL = settings value,
  default timeout set.
- A small helper module `backend/app/services/qaa_generator.py` builds outbound
  headers (`Authorization: Bearer <service token>`; `Actor` only if configured)
  and maps qaa-generator's `{"error": {"code","message"}}` envelope + status
  codes to `HTTPException` (401→502-ish? decide: surface 403 as 403, 409 as 409
  with the existing `run_id`, network errors → 502 with a clear detail). Routes
  read the client via `request.app.state.qaa_generator_client`.

## Part C — Backend proxy routes + audit

New `backend/app/api/v1/qaa_generator.py`, `APIRouter(prefix=RoutePath.QAA_RUNS.value,
tags=[ApiTag.QAA_GENERATOR.value])`, wired in `api/v1/__init__.py` (import +
`router.include_router(qaa_generator_router)`). All routes require
`current_user: CurrentUser`.

Endpoints (thin proxy to qaa-generator, same shapes):
- `POST ""` → create run. Body = `QaaRunCreateRequest` (Part D). Forward
  `Idempotency-Key` if the client sends one. **Audit:** before the outward call
  create an `Operation(user_id=current_user.id, type=OperationType.QAA_GENERATE,
  status=RUNNING, recipe=<request summary + returned run_id>, started_at=now)`;
  after the response set `status`/`finished_at` appropriately (creation only
  starts the run — keep it `RUNNING`; terminal state is reconciled lazily, see
  note). Pass through **409** verbatim (`run_id` in body).
- `GET ""` → list. Query params: `jira_key`, `status` (repeatable),
  `effective_actor`, `created_from`, `created_to`, `limit`, `cursor`. Return
  qaa-generator's `{"items": [...], "next_cursor": ...}` unchanged.
- `GET "/{run_id}"` → full run record.
- `GET "/{run_id}/artifacts"` → artifact dict (report text, pr_url, archive
  meta). Do NOT stream the archive bytes in MVP (link/summary only).
- `POST "/{run_id}/pause"`, `/resume`, `/stop` → forward, return `{"run_id"}`.
  Pass 409 (invalid transition) through.
- `GET "/{run_id}/events/stream"` → **SSE passthrough**. Use
  `httpx.AsyncClient.stream(...)` with `Accept: text/event-stream`, forward
  `Last-Event-ID`, and bridge into a FastAPI `StreamingResponse(media_type=
  MediaType.TEXT_EVENT_STREAM)`. There is no `sse-starlette` dep — either add it
  or hand-roll the passthrough (prefer hand-rolled: iterate
  `response.aiter_bytes()` → yield). Ensure the outbound stream is cancelled when
  the client disconnects.

**Audit reconciliation note:** MVP does not run a background watcher. Record the
`Operation` at creation (RUNNING) with the `run_id` in `recipe`; leave terminal
reconciliation as an explicit follow-up (documented), OR — simpler and
acceptable — update the `Operation` to SUCCESS/FAILED opportunistically whenever
`GET /{run_id}` is fetched and returns a terminal `status`. Pick the latter if
cheap; document whichever you choose.

## Part D — Backend schemas

`backend/app/schemas/qaa_generator.py` (Pydantic, mirror qaa-generator wire
shapes; do NOT re-validate everything — pass-through dicts are acceptable for
list/detail/artifacts, but type the create request):
- `QaaRunCreateRequest`: `jira_key: str`, `dry_run: bool = False`,
  `skip_pr: bool = False`, `skip_exec: bool = False`, `branch: str | None`,
  `profile: str` (enum: `balanced` | `codex-only` | `claude-only` — add a
  `QaaRunProfile(StrEnum)` in constants). Reject a custom `orchestrator_script`
  from the browser (not exposed — MVP always uses the default; do not forward
  it).
- Response models may be `dict[str, Any]` pass-through or typed summaries; keep
  it minimal and consistent with `operations.py` style.

## Part E — Frontend constants (`frontend/src/constants.ts`)

Append to existing groups (const-object + type alias style; exhaustive `Record`
maps must get new entries):
- `PluginId`: `QAA_GENERATOR: "qaa-generator"`.
- `IconName`: add `SPARKLES: "sparkles"` (Generate/AI connotation) — and
  register in `core/plugins/icons.ts` `ICON_REGISTRY` (import a Tabler icon,
  e.g. `IconSparkles`). The `Record<IconName, TablerIcon>` is exhaustive, so TS
  forces this.
- `ViewKey`: `QAA_GENERATE`, `QAA_LIVE`, `QAA_RUNS`.
- `TabId`: `QAA_GENERATE: "tab-qaa-generate"`, `QAA_LIVE: "tab-qaa-live"`,
  `QAA_RUNS: "tab-qaa-runs"`.
- `TabTitle` (`Record<TabId, string>`, exhaustive): `"Generate"`, `"Live"`,
  `"Runs"`.
- `BackendPath`: `QAA_RUNS: "/api/v1/qaa/runs"`, plus suffix members reused for
  builders: `PAUSE`, `RESUME`, `STOP`, `EVENTS_STREAM`, `ARTIFACTS` if not
  already present (some like `REPLAY` exist; add the new ones).
- Path builders near the backend group:
  ```ts
  export function buildBackendQaaRunPath(runId: string): string {
    return `${BackendPath.QAA_RUNS}/${runId}`;
  }
  export function buildBackendQaaRunStreamPath(runId: string): string {
    return `${buildBackendQaaRunPath(runId)}${BackendPath.EVENTS_STREAM}`;
  }
  ```
  (+ pause/resume/stop/artifacts builders).
- `QueryKey`: `QAA_RUNS`, `QAA_RUN_DETAIL`.
- `QaaRunStatus` (new const StrEnum) with `queued|running|paused|completed|
  failed|stopped`, plus `QaaRunStatusLabel` and `QaaRunStatusColor` maps, and a
  `TERMINAL_QAA_RUN_STATUSES` set (`completed|failed|stopped`). Do NOT overload
  `OperationStatus` (it has no `paused`).
- `QaaRunProfile` const StrEnum (`balanced|codex-only|claude-only`) +
  `QaaRunProfileLabel`.

## Part F — Frontend client + types + SSE

`frontend/src/api/types.ts`: add `QaaRunCreateRequest`, `QaaRunSummary`,
`QaaRunRead`, `QaaRunArtifacts`, `QaaRunListResponse` (`items`, `next_cursor`),
`QaaRunEvent` (SSE frame payload: `sequence`, `event_type`, `message`,
`payload`). Reuse the SSE plumbing shape from the agent's `JobStream*` types.

`frontend/src/api/backendClient.ts`: add methods via the existing `request<T>`
helper + `URLSearchParams` list-path builder:
- `createQaaRun(token, payload, signal)` → POST `BackendPath.QAA_RUNS`.
- `listQaaRuns(token, params, signal)` → GET with cursor + filters.
- `getQaaRun(token, runId, signal)` / `getQaaRunArtifacts(...)`.
- `pauseQaaRun` / `resumeQaaRun` / `stopQaaRun(token, runId, signal)` → POST.
- `streamQaaRun(token, runId, onMessage, signal)` → the **fetch-stream SSE**
  pattern (copy `agentClient.streamJob` / `streamAgentCommand`): `fetch` the
  stream path with `Authorization: Bearer <token>` and `Accept:
  text/event-stream`, then `for await (const frame of parseSseStream(response.body,
  signal))` and `JSON.parse` each frame's data. **Do NOT use `EventSource`** (it
  can't send Authorization). Reuse `frontend/src/api/sse.ts` `parseSseStream`.

## Part G — Frontend plugin folder `frontend/src/plugins/qaa-generator/`

Mirror the Stagings structure. Discovery is glob-based
(`import.meta.glob("./*/manifest.tsx")`) — the folder is auto-picked-up if
`manifest.tsx` has a valid `export default definePlugin(...)`.

- `manifest.tsx`: `definePlugin({ id: PluginId.QAA_GENERATOR, icon:
  IconName.SPARKLES, kind: PluginKind.OPTIONAL, origin: PluginOrigin.BUILTIN,
  contractVersion: CONTRACT_VERSION, label: "QAA Generator", order: 20 (after
  Stagings=10), route: "/qaa-generator", requiresAgent: false, tabs: [3 element
  tabs rendering <QaaGeneratorSection mode={ViewKey.X}/>] })`.
- `QaaGeneratorSection.tsx`: mode dispatcher (`mode === ViewKey.QAA_LIVE →
  <LivePanel/>`, `QAA_RUNS → <RunsPanel/>`, default `<GeneratePanel/>`), plus the
  "open/switch to tab" helper reading `useUiStore` `tabsByPlugin[
  PluginId.QAA_GENERATOR]` (copy from `StagingsSection`).
- `GeneratePanel.tsx` (template: `E2ePanel.tsx`): form for `jira_key`, `profile`
  (Select of `QaaRunProfile`), switches `dry_run`/`skip_pr`/`skip_exec`,
  optional `branch`. `useMutation` → `backendClient.createQaaRun`; `onSuccess`
  starts the Live view for the returned `run_id`. Handle **409 duplicate**:
  surface a notice with a button to open the existing `run_id` in the Live tab.
- `LivePanel.tsx` + presentational `LiveRunPanel` (template: `LiveJobPanel.tsx`):
  status `Badge` (from `QaaRunStatusColor/Label`), run id + jira key, scrolling
  monospace event log, streamError `Alert`, and **Pause / Resume / Stop**
  buttons gated on non-terminal status.
- `useQaaRunLive.ts` + `runState.ts` (clone `useTransientLiveJob.ts` +
  `liveJobState.ts`): hold run state, open the SSE stream in a
  `useEffect`+`AbortController`, append events, poll `getQaaRun` as a fallback
  (`refetchInterval` false when terminal), expose `startRun/clearRun` and
  pause/resume/stop mutations. **Extend the action union** with `pause`/`resume`
  transitions (Stagings' live state has only cancel/terminal).
- `RunsPanel.tsx` (template: `HistoryPanel.tsx` but **cursor**, not offset):
  filters `jira_key` (text), `status` (multi-select of `QaaRunStatus`), date
  range; a `useQuery` keyed by filters+cursor; Prev/Next via `next_cursor`
  (keep a small cursor stack for Prev); a `<Table>`; row click opens a
  `<Drawer>` with run detail + artifacts (report text, PR link) via
  `getQaaRun`/`getQaaRunArtifacts`.

## Part H — Store bootstrap + discovery test

- `frontend/src/store/uiStoreCore.ts` `createBootstrapTabsByPlugin()` hardcodes
  only `ADMIN`/`STAGINGS`. Add a `[PluginId.QAA_GENERATOR]` entry
  (`activeTabId`/`tabIds` = `TabId.QAA_GENERATE`) so
  `tabsByPlugin[PluginId.QAA_GENERATOR]` is defined pre-hydration.
- `frontend/src/plugins/discovery.test.ts` asserts the exact ordered
  `PLUGINS.map(p => p.id)` — update the expected array to include
  `PluginId.QAA_GENERATOR` in `order` position (10 stagings, 20 qaa-generator,
  admin last as today).

## Part I — Tests

Backend (`backend/tests/test_qaa_generator.py`): mock outbound httpx (introduce
`respx` or `httpx.MockTransport` injected into `app.state.qaa_generator_client`;
add the dev dep). Cover: create → 202 + Operation row written; 409 duplicate
passthrough incl. `run_id`; list/get/pause/resume/stop forward with the right
outward method/path/headers (Bearer set, `Actor` only when configured); auth
required (401 without JWT). SSE passthrough: assert `text/event-stream` and that
frames are relayed (may need an async client — add `pytest-asyncio` +
`httpx.ASGITransport` if the sync `TestClient` can't drive streaming).

Frontend: `backendClient.test.ts` (stub `fetch`, assert URL/method/body/Bearer
for the new methods + a `streamQaaRun` test feeding a `ReadableStream`);
`GeneratePanel.test.tsx` (mock `@/api/backendClient` + `useQaaRunLive`, seed
`useAuthStore`, assert create called + 409 handling); `RunsPanel.test.tsx`
(cursor paging + filters); update `discovery.test.ts`. Reuse
`renderWithProviders` from `src/test/render.tsx`.

## Part J — Docs

`frontend/README.md`: add the qaa-generator plugin (tabs, that it talks to the
backend proxy — no local agent). `backend/README.md` (or `.env.example`
comments): document `QAA_GENERATOR_BASE_URL` / `QAA_GENERATOR_SERVICE_TOKEN` /
`QAA_GENERATOR_ACTOR` and the proxy + audit behavior.

---

## Gates (all must pass)
- Frontend: `cd frontend && npm run lint && npx tsc --noEmit && npm run test && npm run build`
- Backend: `cd backend && ruff check . && ruff format --check . && mypy app && pytest`
- Agent (unchanged, must stay green): `cd agent && ruff check . && ruff format --check . && mypy app && pytest`

## Acceptance criteria
1. New builtin plugin `qaa-generator` (order 20, optional, `requiresAgent:false`)
   auto-discovered; sidebar shows it with the new icon; three tabs Generate/Live/
   Runs render.
2. Generate creates a run via the backend proxy; the service token is never sent
   to the browser; a `409` duplicate surfaces the existing `run_id` with a way to
   open it.
3. Live streams events via backend SSE passthrough (fetch-stream + Bearer, not
   EventSource) and Pause/Resume/Stop work; terminal status stops the stream.
4. Runs lists with cursor pagination + filters (jira_key/status/date); row opens
   detail + artifacts (report, PR link).
5. Each create is recorded in `operations` (`type=qaa_generate`,
   `user_id=current user`); terminal reconciliation behavior is implemented as
   documented.
6. Stagings/Admin unchanged; contract unchanged; all three gate suites green;
   docs updated.

## Out of scope
- Admin of qaa-generator users/tokens (→ brief 14). MCP/A2A. Archive-bytes
  download. Any agent change.

## Open questions (surface, don't silently decide)
- **Terminal reconciliation:** lazy-on-GET vs a background poller (deferred).
- **Optional user `Description` field** (company idea): our user model has no
  free-text description. Aligns with qaa-generator's own `description`; would
  live in the Administration plugin (brief 08) + a migration, NOT here. Handle
  as a separate small change.

When done, ensure all three gate suites pass, then stop. Do not commit — the
reviewer inspects `git diff` and commits.
