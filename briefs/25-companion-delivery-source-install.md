# Brief 25 — Companion delivery: source tarball + install.sh + autostart service

Binding: follow `CONVENTIONS.md` exactly (no inline string literals — model as
`StrEnum` / TS literal unions; global constants in `backend/app/core/constants.py`,
`agent/app/core/constants.py`, `frontend/src/constants.ts`; UI text in English;
ruff+mypy clean for Python, eslint+`tsc --noEmit` clean for TS; API under `/api/v1`;
12-factor config, no secrets committed).

Design rationale and accepted decisions live in `discuss/12` (this brief is its
implementation). Read `discuss/12` first; below is the concrete spec.

## Goal

Replace the "later slice" Tauri desktop shell with a source-based delivery:
the portal offers to download the agent sources, the engineer runs `install.sh`,
which sets the agent up as an autostart service that self-updates by pulling a
fresh source tarball from the deployed backend. No native builds, no signing,
no CI matrix.

Three deliverables (A backend, B agent+scripts, C frontend). Keep each change
minimal, typed, and consistent with existing patterns in the repo.

---

## Part A — Backend: manifest + source tarball (single image)

### A1. Deterministic agent source tarball baked into the image
- Edit `build/Dockerfile` so the final image contains a deterministic gzip
  tarball of the `agent/` sources, at a path served by the backend
  (default e.g. `/app/agent-dist/agent-src.tar.gz`; make the directory
  configurable via a new `AGENT_DIST_DIR` env, mirroring how `STATIC_DIR` is
  handled — new `EnvKey.AGENT_DIST_DIR` in `backend/app/core/constants.py`
  plus `DEFAULT_AGENT_DIST_DIR`, and a `Settings.agent_dist_dir` field in
  `backend/app/core/config.py`).
- The tarball MUST be reproducible so its sha256 is stable across identical
  sources: sorted entries, fixed mtime (e.g. 0 or a build-arg epoch), fixed
  uid/gid/owner. Exclude `.venv`, `__pycache__`, `*.pyc`, `.pytest_cache`,
  `.mypy_cache`, `.ruff_cache`, `.env` (never ship the user's env), and the
  `.env` file specifically — ship `.env.example` only.
- The tarball must include everything needed to install and run: `agent/app/`,
  `agent/pyproject.toml`, `agent/README.md`, `agent/.env.example`, and the new
  `agent/install.sh`, `agent/update.sh`, and the service unit templates (see
  Part B). Prefer building the tarball in a small build stage with GNU tar
  flags for determinism (`--sort=name --mtime=@0 --owner=0 --group=0
  --numeric-owner`), then COPY it into the final stage. Also emit the sha256
  next to it (e.g. `agent-src.tar.gz.sha256`) so the backend can serve it
  without recomputing, OR compute sha256 lazily in the backend and cache it.

### A2. New backend router `backend/app/api/v1/agent.py`
Register it in `backend/app/api/v1/__init__.py`. Add route paths to the
backend path enums (follow the existing `RoutePath`/`ApiPrefix` conventions).

Endpoints (unauthenticated — they expose only public source + version, no
secrets; they are same-origin to the SPA):

- `GET /api/v1/agent/manifest` → JSON:
  ```
  {
    "version": "<agent version>",       # read from bundled agent pyproject.toml
    "minSupported": "<x.y.z>",          # backend constant, see A3
    "downloadUrl": "/api/v1/agent/download",
    "sha256": "<hex of the served tarball>",
    "os": null                          # reserved; source tarball is OS-agnostic
  }
  ```
  Use a pydantic response model (e.g. `AgentManifestResponse` in
  `backend/app/schemas/…` following existing schema module layout). Version is
  read once from the bundled agent `pyproject.toml` (parse `[project].version`)
  — do not hardcode. If the tarball/pyproject is absent (dev without the image
  build), degrade gracefully: return 503 with a clear English detail, or read
  from the repo-local `agent/pyproject.toml` when running from a source
  checkout. Pick the simplest correct behavior and note it in a docstring.

- `GET /api/v1/agent/download` → `FileResponse` of the tarball,
  `media_type="application/gzip"`, with a sensible download filename
  (`Content-Disposition: attachment; filename="qaa-tms-agent-src.tar.gz"`).
  404 if not present.

### A3. Constants
- `minSupported` is a backend constant (e.g. `AGENT_MIN_SUPPORTED_VERSION` in
  `backend/app/core/constants.py`). Set it to `"0.1.0"` for now.
- No secrets, no auth on these two routes. Confirm the SPA-serving catch-all in
  `backend/app/main.py` still excludes `api/*` (it does) so these resolve.

### A4. Tests
- Add backend tests mirroring existing style: manifest shape + version parsing,
  download returns bytes with correct content-type, sha256 in manifest matches
  the served tarball bytes, 503/404 degradation paths.

---

## Part B — Agent: `POST /update`, PNA preflight, install.sh, update.sh, units

### B1. PNA (Private Network Access) preflight
- In `agent/app/main.py`, ensure OPTIONS preflight carrying
  `Access-Control-Request-Private-Network: true` receives
  `Access-Control-Allow-Private-Network: true` in the response, for the
  configured CORS origins. Implement as a small middleware (add the header
  names to `agent/app/core/constants.py` `HeaderName`, plus a header value
  enum entry). Do not break existing CORS behavior; unit-test the preflight
  (there is already `agent/tests/test_preflight.py` for a different feature and
  `test_cors.py` — add a focused test, e.g. `test_pna.py`).

### B2. `POST /update` endpoint
- New path in `agent/app/core/constants.py` `AgentPath.UPDATE = "/update"`.
- Route in `agent/app/api/routes.py`. Require auth consistent with other
  mutating endpoints (`AuthDep`), returning `202 Accepted`.
- Behavior: spawn a detached helper (`update.sh`) that performs the update out
  of process, then return immediately. The running agent must NOT try to
  update itself in-process (it will be restarted). Model the response with a
  small schema (e.g. `AgentUpdateAccepted`). The helper is located relative to
  the install dir; resolve its path robustly. If the helper is missing (e.g.
  dev run from a raw checkout), return 503 with a clear English detail rather
  than crashing.
- Add an agent test (`test_update.py`) that the endpoint requires auth and, on
  success, invokes the helper (mock the subprocess spawn).

### B3. `agent/update.sh`
POSIX/bash script, idempotent, does the actual update. Two modes:
- `update.sh --if-newer` (used by the launcher on every service start):
  1. `GET $AGENT_BACKEND_URL/api/v1/agent/manifest`; read `version` + `sha256`.
  2. Compare `version` with the locally installed agent version. If not newer,
     exit 0 (no-op).
  3. Else download `downloadUrl`, verify sha256 against the manifest, extract
     into a temp dir, sync into the install dir PRESERVING the user's `.env`
     (never overwrite `.env`; `.env.example` may be refreshed), reinstall
     dependencies into the venv (editable install / `pip install -e .`) so the
     package metadata version updates.
- `update.sh` (no flag) or `update.sh --force`: same as above but always
  applies, then restarts the service (systemd `--user restart` on Linux /
  `launchctl kickstart -k` on macOS). This is what `POST /update` invokes.
- Fail safe: on any download/verify error, leave the current install untouched
  and exit non-zero with a clear message. Do not leave a half-extracted state.

### B4. `agent/install.sh`
Interactive installer. Steps in order:
1. **Consent (blocking, interactive).** Print, in English, exactly what the
   agent does under the engineer's PERSONAL credentials: uses their VPN,
   their kubeconfig, their personal Jenkins token, and runs `staging`/`kubectl`
   on their behalf. Require an explicit typed confirmation. Record acceptance
   in a marker file (`${XDG_CONFIG_HOME:-$HOME/.config}/qaa-tms-agent/consent`).
   Skip the prompt on re-install/update if the marker exists.
2. **Bootstrap.** Require `python3` >= 3.12 (fail with guidance otherwise).
   Create a venv (use `uv venv` if `uv` is available, else `python3 -m venv`),
   then editable-install the agent (`pip install -e .` / `uv pip install -e .`).
3. **Preconfigure `.env`.** Write/patch `agent/.env` (reuse the agent's own
   env-file upsert logic conceptually; a shell upsert is fine here) setting:
   - `AGENT_CORS_ORIGINS` = the deployed portal origin,
   - `AGENT_BACKEND_URL` = the deployed backend origin.
   The origin comes from either a baked-in default (if the backend served a
   templated install.sh — see A/optional below) or a `--backend-url` argument /
   `QAA_TMS_BACKEND_URL` env. Never clobber an existing user `.env` beyond
   these bootstrap keys.
4. **Autostart service.** Branch on `uname`:
   - Linux → install a systemd **user** unit at
     `${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/qaa-tms-agent.service`,
     `systemctl --user daemon-reload && systemctl --user enable --now
     qaa-tms-agent.service`. Print a note about `loginctl enable-linger $USER`
     so the service runs without an active login session.
   - macOS → install a launchd LaunchAgent plist at
     `$HOME/Library/LaunchAgents/onl.gc.qaa-tms-agent.plist` and
     `launchctl load`/`bootstrap` it.
   `ExecStart`/`ProgramArguments` must point at a launcher that runs
   `update.sh --if-newer` first, then execs uvicorn (the agent). Provide the
   launcher (can be a tiny `run.sh` or fold the update-check into ExecStartPre
   for systemd / a wrapper for launchd).
5. **First run.** Start the service and print how to verify (`curl 127.0.0.1:47600/ping`)
   and how to view logs (`journalctl --user -u ...` / `log show`/console).

Ship unit templates in the repo (e.g. `agent/deploy/qaa-tms-agent.service.tmpl`
and `agent/deploy/onl.gc.qaa-tms-agent.plist.tmpl`) that install.sh fills in
(paths, venv python, user). Keep them in the tarball (Part A1).

### B5. Optional (recommended) templated installer endpoint
If low-cost: `GET /api/v1/agent/install.sh` returns `install.sh` with the
backend's own public origin injected, so the portal can show a single
copy-paste `download & run` flow without the user passing `--backend-url`.
Do NOT pipe `curl | sh` in the portal instructions (consent must be
interactive and the user should run the script locally). If this endpoint is
too involved, skip it and rely on `--backend-url`; note the choice.

### B6. Update `agent/README.md`
Replace the "Tauri/Electron shell … later slice" note with the source-delivery
+ install.sh + autostart + self-update model.

---

## Part C — Frontend: manifest-driven companion status (install / update)

### C1. Backend manifest client
- Add a same-origin backend call for `GET /api/v1/agent/manifest` (the app
  already has a backend API client alongside `agentClient.ts`; put it with the
  backend client, not the agent client). Add the path + types to
  `frontend/src/constants.ts` / `frontend/src/api/types.ts`.

### C2. Semver comparison util
- Add a small, tested `compareVersions(a, b)` util (frontend). No new deps
  unless one is already present. Handle `x.y.z` and pre-1.0 correctly.

### C3. Unified companion status
- Introduce `useCompanionStatus()` (combines `discoverAgent()` + backend
  manifest) and a shared `<CompanionGate>` component that renders one of:
  - **not installed** (`discoverAgent()` == null): title "Companion is not
    installed", body with brief steps, a **Download** button/link to
    `/api/v1/agent/download`, and the install command hint.
  - **update required** (`agent.version < minSupported`): blocking banner
    "Update required" + **Update** button; the wrapped plugin content is
    blocked.
  - **update available** (`minSupported <= agent.version < manifest.version`):
    non-blocking banner "Update available" + **Update** button, plugin content
    still usable.
  - **ok**: render children.
- Route the 6 existing "Companion app is not running" surfaces through this
  gate/hook, removing duplication:
  `frontend/src/plugins/jenkins/JenkinsSection.tsx`,
  `frontend/src/plugins/kuber/KuberSection.tsx`,
  `frontend/src/plugins/qaa-generator/QaaGeneratorSection.tsx`,
  `frontend/src/plugins/statistics/StatisticsSmokeSection.tsx`,
  `frontend/src/plugins/profile/SettingsPanel.tsx`,
  `frontend/src/plugins/stagings/PreflightPanel.tsx`.
  Preserve each panel's existing behavior when the agent IS present and current.
- **Update** action → `POST` to the agent `/update` (add to `agentClient.ts`,
  with auth token), then poll `/ping.version` until it changes or a timeout,
  showing a pending state; on success re-render as ok.

### C4. Tests
- Update/extend the affected `*.test.tsx` and add tests for `useCompanionStatus`
  / `<CompanionGate>` covering the four states and the semver util. Keep the
  existing test conventions (vitest).

---

## Acceptance / verification (run before finishing)

- Backend: `cd backend && ruff check app && mypy app && pytest`
- Agent:   `cd agent && ruff check app && mypy app && pytest`
- Frontend: `cd frontend && npm run lint && npx tsc --noEmit && npm test`
- `shellcheck` clean on `agent/install.sh` and `agent/update.sh` if available.
- Manual smoke (describe in the final summary; do not require a real cluster):
  manifest shape, download bytes+sha match, `POST /update` returns 202 and
  spawns the helper (mocked), PNA preflight header present, and the four
  frontend states render.

Keep the diff focused on this feature. Do not touch unrelated plugins or
refactor beyond what C3 requires. Follow existing module layout and naming.
