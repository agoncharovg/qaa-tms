# Brief 03 — Companion agent (headless local HTTP service over the `staging` CLI)

You implement the THIRD slice of QAA-TMS: the **local companion agent**. Read
`CONVENTIONS.md`, `discuss/03`, and `discuss/04` first — they are the source of
truth for the browser↔agent↔backend contract. Slices 01 (`backend/`) and 02
(`frontend/`) already exist; the frontend `agentClient` (in
`frontend/src/api/agentClient.ts` + `frontend/src/api/types.ts` +
`frontend/src/constants.ts`) is the **wire contract you must satisfy exactly**.
Do NOT modify `backend/` or `frontend/`.

## Form (decided — do not substitute)
Per discuss/04 §1 the agent ultimately lives inside a Tauri/Electron
companion-app, but discuss/04 §1 also says "in dev the same code runs as a
standalone headless CLI." **This slice builds ONLY that headless service.**
The Tauri/Electron shell and the iframe-browser (requirement #5) are a LATER
slice and are explicitly OUT OF SCOPE here (and the Rust toolchain is not
available on this machine).

## Stack (fixed — do not substitute)
- Python 3.12+, FastAPI, `uvicorn` (ASGI), `httpx` (async client to the backend),
  `pydantic-settings` for config. `sse-starlette` (or FastAPI
  `StreamingResponse`) for SSE. `asyncio` subprocess for running `staging`.
- Lint/type: `ruff` + `mypy` (strict), both clean — same bar as `backend/`.
- Tests: `pytest` + `pytest-asyncio` + `httpx.AsyncClient` (ASGI transport).
- Constants: `enum.StrEnum` in `agent/app/core/constants.py` (per CONVENTIONS.md);
  **no stray string literals** for enumerated values.

## Repository layout (create under `agent/`)
```
agent/
  pyproject.toml               # deps + ruff + mypy config (mirror backend/ style)
  README.md
  .env.example                 # AGENT_* env vars (see Config)
  app/
    main.py                    # FastAPI app factory, CORS, router mount, uvicorn entry
    core/
      config.py                # pydantic-settings Settings
      constants.py             # StrEnums: AgentPath, PreflightKey, JobStatus, OperationType/Status, EnvKey, defaults
    api/
      deps.py                  # Bearer extraction + token validation via backend /api/v1/me
      routes.py                # /ping /preflight /deploy /jobs/{id} /jobs/{id}/stream /jobs/{id}/cancel
    schemas.py                 # request/response models (mirror the frontend wire shapes)
    services/
      staging.py               # resolve staging binary + repo root + git sha; build argv
      preflight.py             # the 10 read-only checks
      jobs.py                  # in-memory JobManager: spawn, stream, cancel, status
      backend.py               # push Operation upsert to central backend (best-effort)
  tests/
    conftest.py                # fake `staging` script fixture + mocked backend /me & /operations
    test_ping.py
    test_preflight.py
    test_auth.py
    test_jobs.py               # deploy → stream → completion using the fake staging bin
    test_cors.py
```

## Contract fidelity (MUST byte-match the frontend)
Read `frontend/src/api/types.ts` and `frontend/src/constants.ts` and satisfy
them exactly:
- **`GET /ping`** (NO auth) → JSON with EXACTLY these keys (frontend
  `AgentPingResponse`): `app`, `version`, `stagingsInstalled`, `stagingsSha`,
  `os`. `app` MUST be the literal `"qaa-tms-agent"` (frontend matches on it).
  `stagingsSha` is `git -C <repo> rev-parse --short HEAD` or `null` if not
  installed. camelCase on the wire.
- **`GET /preflight`** (auth) → a JSON ARRAY of items, each EXACTLY
  `{ key, ok, detail, howTo }` (frontend `PreflightItem`). `key` values MUST be
  the frontend `PreflightKey` strings verbatim: `tools`, `clusterReachable`,
  `vpn`, `kubeconfig`, `dockerHarbor`, `dockerStaging`, `harborPull`,
  `submodules`, `venv`, `repoInstalled` (all 10, camelCase).
- **`POST /deploy`** (auth) → body `{ ns, services[], images{svc:tag},
  flags{full,dryRun,noSync,stage} }`; returns `{ jobId, opId }` (discuss/04 §5).
- **`GET /jobs/{id}/stream`** (auth) → SSE stream of stdout/stderr lines plus a
  terminal status event. Path built by frontend `buildAgentJobStreamPath` =
  `/jobs/{id}/stream`.
- Also implement `GET /jobs/{id}` (status/metadata) and
  `POST /jobs/{id}/cancel` (best-effort) from discuss/04 §5.

Endpoints in discuss/04 §5 that are NOT in the list above (namespaces list/
status/creds/logs, `/destroy`, `/adopt`, `/sync`, `/grafana-creds`,
`/e2e/suites`, `/e2e-run`, `/setup`) are OUT OF SCOPE for this slice — do not
implement them. You MAY list their paths in the `AgentPath` StrEnum for
forward reference, but add no routes.

## Networking & security (discuss/04 §3–§4)
- Bind **127.0.0.1 only** (never `0.0.0.0`). Port from `AGENT_PORT`
  (default `47600`); the frontend probes `47600..47605`.
- **CORS allowlist** = TMS origins only, from `AGENT_CORS_ORIGINS`
  (default `http://localhost:3000,http://127.0.0.1:3000`). Allow the
  `Authorization` and `X-QAA-TMS` headers and the methods used. A cross-origin
  browser preflight from any other origin must NOT be allowed.
- **Auth**: every endpoint EXCEPT `/ping` requires `Authorization: Bearer
  <tms-token>`. Validate by calling the backend `GET /api/v1/me`
  (`AGENT_BACKEND_URL`, default `http://localhost:8000`) with that same bearer;
  200 → authorized (cache the identity briefly, e.g. ~30s, keyed by token),
  401/failure → return `401` from the agent. Tolerate an optional
  `X-QAA-TMS: 1` header. Missing/blank token → `401`.

## `staging` resolution (discuss/03 §3)
- Resolve the binary from `AGENT_STAGING_BIN` if set, else `shutil.which("staging")`.
- Repo root: `readlink -f <bin>` → `.../qaa-stagings/bin/staging`; root =
  `dirname(dirname(...))`. `stagingsInstalled` = binary resolves.
  `stagingsSha` = short git HEAD of the repo root (or `null`).
- **Test seam:** `AGENT_STAGING_BIN` lets tests point at a fake script that
  emits known stdout/stderr and a chosen exit code, so the job/SSE lifecycle is
  exercised WITHOUT a real cluster/VPN. Default (unset) resolves the real
  `staging`. The agent runs the REAL binary in production — no faking in app code.

## Preflight checks (read-only, no cluster mutation)
All checks are safe/read-only and degrade to `ok:false` with a helpful `howTo`
when a precondition is missing (VPN down, token expired, etc.) — never raise:
- `tools` — `shutil.which` for `python3`, `kubectl`, `kustomize`, `docker`, `git`.
- `clusterReachable` — `kubectl cluster-info` with a short timeout (best-effort;
  false without VPN/kubeconfig).
- `vpn` — heuristic reachability of a Full-VPN-only host (hint-based; false is fine).
- `kubeconfig` — file exists (`STAGING_KUBECONFIG` env or `~/.kube/ai-staging.yaml`)
  AND freshness heuristic (mtime within the 12h rotation window → hint to re-download).
- `dockerHarbor` / `dockerStaging` — an `auths` entry for `harbor.p.gc.onl` /
  `registry.frn-stg.p.gc.onl:8443` in `~/.docker/config.json`.
- `harborPull` — reminder-style item (discuss/04 §11 open question): report based
  on `dockerHarbor` presence + a `howTo`, don't hard-probe Harbor.
- `submodules` — `git submodule status` in the repo shows `base/*` initialized
  (no leading `-`).
- `venv` — `scripts/.venv` exists under the repo root.
- `repoInstalled` — the `staging` binary resolves.

## Jobs & execution
- In-memory `JobManager` (dict keyed by a generated job id). A job holds:
  status (`queued|running|success|failed|aborted`), the argv, a captured log
  buffer, exit code, timestamps.
- `POST /deploy`: build argv `staging deploy <ns> [--services ...] [--image
  svc=tag ...] [flags]` from the request (inspect `~/Projects/qaa-stagings`
  README/`bin/staging` for exact flag spelling; keep the mapping in one place).
  Generate `opId` (a UUID) and `jobId`, start the async subprocess (merge
  stdout+stderr), and return `{ jobId, opId }` immediately.
- `GET /jobs/{id}/stream`: SSE — emit each captured line as it arrives, then a
  final event carrying terminal status + exitCode. A late subscriber must still
  receive buffered output followed by the terminal event (don't hang).
- `POST /jobs/{id}/cancel`: terminate the process group best-effort → status
  `aborted`.

## Central backend push (discuss/04 §4, §9 — audit/attribution)
On deploy, best-effort POST to backend `POST /api/v1/operations` with the SAME
bearer (this is what attributes the op to the user). Match the backend
`OperationUpsertRequest` schema (snake_case, from `backend/app/schemas/operation.py`):
`{ id, type:"deploy", ns, recipe:{services, images, flags}, status,
started_at, finished_at?, log?, exit_code?, agent_host, agent_version,
stagings_sha }`. Use `id = opId` so the START (status=`running`) and the FINAL
(status=`success|failed|aborted` + `log` + `exit_code`) calls UPSERT the same
record. `type` uses the backend `OperationType` value `deploy` (note: the
backend enum spells e2e as `e2e_run` with an underscore — irrelevant here but
don't invent variants). **Backend push is non-fatal:** if the backend is
unreachable or returns 401, log a warning and continue the job; never fail the
deploy because the audit push failed.

## Config — `agent/app/core/config.py` (12-factor, `AGENT_` prefix)
`AGENT_HOST` (fixed default `127.0.0.1`), `AGENT_PORT` (default `47600`),
`AGENT_CORS_ORIGINS` (CSV, default TMS localhost:3000 origins),
`AGENT_BACKEND_URL` (default `http://localhost:8000`), `AGENT_STAGING_BIN`
(optional), `AGENT_STAGINGS_REPO` (optional repo-root override; else derived).
No secrets committed. Keys live in an `EnvKey` StrEnum.

## Tests (meaningful, no live cluster)
Use `httpx.AsyncClient` against the ASGI app; mock the backend `/api/v1/me` and
`/api/v1/operations` (e.g. `respx` or a stub transport); use the fake-`staging`
fixture via `AGENT_STAGING_BIN`. Cover at least:
1. `/ping` returns the exact `AgentPingResponse` shape with `app ==
   "qaa-tms-agent"`.
2. `/preflight` returns all 10 `PreflightKey`s, each `{key,ok,detail,howTo}`.
3. Auth: a protected route returns `401` with no/invalid token, `200` when
   backend `/me` accepts the token.
4. `/deploy` → `{jobId,opId}`, then `/jobs/{id}/stream` yields the fake
   command's output and a terminal `success` (and a non-zero exit → `failed`).
5. `/jobs/{id}/cancel` moves a running job to `aborted`.
6. CORS: an OPTIONS preflight from a TMS origin is allowed; from a foreign
   origin it is not.

## Acceptance criteria (must all hold)
1. `agent/` installs and runs headless: documented `uvicorn app.main:app`
   (or `python -m app.main`) serves on `127.0.0.1:47600`.
2. `GET /ping` (no auth) matches the frontend `AgentPingResponse` byte-for-byte;
   `app == "qaa-tms-agent"`.
3. `GET /preflight` (auth) returns all 10 checklist items keyed by the frontend
   `PreflightKey` strings; runs real read-only checks and never crashes when
   preconditions are missing.
4. `POST /deploy` returns `{jobId, opId}`, spawns the real `staging` subprocess
   (or the injected test binary), streams live output over `GET
   /jobs/{id}/stream` (SSE), and a best-effort audit record is upserted to the
   backend at start and finish with the same `opId`.
5. Only `/ping` is unauthenticated; all other routes require a valid bearer
   validated against the backend `/api/v1/me`. Agent binds 127.0.0.1 only and
   its CORS allowlist admits only the TMS origins.
6. `ruff`, `mypy` (strict), and `pytest` all pass clean; tests include the six
   cases above and require no live cluster/VPN.
7. All enumerated strings live in `agent/app/core/constants.py`; user/log-facing
   text is English (CONVENTIONS.md).
8. `agent/README.md` documents headless run, all `AGENT_*` env vars, agent
   discovery by the SPA, the real-vs-injected `staging` binary, and notes the
   Tauri shell is a later slice.

## Out of scope (do NOT do)
- The Tauri/Electron shell and the iframe browser (requirement #5) — later slice.
- Any change to `backend/` or `frontend/`.
- The unimplemented §5 endpoints listed above (namespaces/destroy/adopt/sync/
  grafana/e2e/setup).
- Adding the agent to `docker-compose.yml` — the agent is a per-engineer LOCAL
  process that needs the engineer's own VPN/kubeconfig/docker creds; it is not a
  container service. The frontend already degrades gracefully when no agent is
  detected.
- Persisting jobs to disk/DB (in-memory is fine for the skeleton), real OIDC,
  token refresh/device-token (discuss/04 §11).

When done, ensure `ruff check`, `mypy`, and `pytest` all succeed in `agent/`,
then stop. Do not commit — the reviewer inspects `git diff` and commits.
