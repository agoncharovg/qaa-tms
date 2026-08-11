# Brief 16 — Stagings kubeconfig freshness: detect · warn · refresh · activate

Close a real weak spot in the **Stagings** module: staging operations need not
only *a* kubeconfig but a **fresh, valid** one (the staging kubeconfig at
`~/.kube/ai-staging.yaml` expires ~every 48h). Today the agent only *warns* on the
Preflight tab (mtime-only, 12h threshold) and tells the user to `curl` it by hand
— there is no auto-refresh, no token/content awareness, and no "switch to it".

Deliver, end-to-end:
1. **Detect** whether the staging kubeconfig is missing / stale / token-expired /
   content-invalid / not the active one.
2. **Warn** with a persistent banner on **all Stagings tabs**.
3. **Refresh** it (download a fresh kubeconfig from the configured URL) on user
   command.
4. **Activate** it (make it the active kubeconfig, qaa-kuber style) on user
   command — a single "Refresh & activate" action, plus a standalone "Activate"
   when it is already fresh but not active.

The logic is a scoped port of `qaa kuber`
(`~/Projects/qaa-cli/scripts/kuber.py`): its `kubeconfig_looks_valid`,
`kubeconfig_token_expiry` / `jwt_token_expiry` (base64url-decode the JWT `exp`),
the 300s expiry grace, and the download-then-activate flow. All cluster/file work
runs in the **local agent** under the engineer's own environment (Stagings
topology; discuss/06 П1/П2 — the engineer can already do all of this by hand).

Read FIRST:
- `discuss/08` — the four decisions this brief implements.
- `~/Projects/qaa-cli/scripts/kuber.py` — source logic to port:
  `KUBECONFIG_REFRESH_GRACE_SECONDS`, `kubeconfig_looks_valid`,
  `kubeconfig_token_expiry`, `jwt_token_expiry`, `activate_kubeconfig`
  (symlink re-point), `build_kubeconfig_refresh_step` (the curl download).
- Agent: `agent/app/services/preflight.py` (existing `_check_kubeconfig`,
  `_kubeconfig_path`, `DEFAULT_KUBECONFIG_FRESHNESS_SECONDS`,
  `DEFAULT_STAGING_KUBECONFIG`, `StagingEnvKey.KUBECONFIG`),
  `agent/app/services/staging.py`, `agent/app/services/backend.py`
  (`build_operation_payload`/`push_operation` for audit),
  `agent/app/core/{constants.py,config.py}`, `agent/app/api/routes.py`,
  `agent/app/api/deps.py`.
- Frontend: `frontend/src/plugins/stagings/StagingsSection.tsx` (the section
  shell where the banner mounts — visible on every tab), `PreflightPanel.tsx`,
  `NamespacesPanel.tsx` (mutation + toast + query-invalidate patterns),
  `frontend/src/api/agentClient.ts`, `frontend/src/api/types.ts`,
  `frontend/src/store/stagingsStore.ts`, `frontend/src/constants.ts`.
- Backend: `backend/app/core/constants.py` (`OperationType`, operations VARCHAR
  length note from brief 13).
- `CONVENTIONS.md` — enumerate constants; English-only UI.

---

## Decisions (from discuss/08 — implement, do not re-litigate)
1. **"Switch to it" = refresh + make active (qaa-kuber model).** Primary action
   downloads a fresh kubeconfig AND activates it (re-points the active-kubeconfig
   symlink at the staging file). A standalone "Activate" exists for the
   fresh-but-inactive case.
2. **Banner on ALL Stagings tabs** — a persistent banner in the Stagings section
   shell, shown on Preflight/Deploy/Namespaces/Sync/E2E/History; hidden only when
   the kubeconfig is healthy AND active.
3. **Staleness/validity = three local checks (no cluster call):** file age
   (mtime) with a **48h** threshold (configurable; today's hardcoded 12h is a
   bug → fix); JWT `exp` (expired if within a 300s grace); content validity
   (real kubeconfig, not an HTML/403 error page). "не тот" (wrong one) = the
   active kubeconfig does not resolve to the staging file.
4. **Executor = local agent** (download via `httpx`, symlink via `os`), best-effort
   audit to `operations`.

## Hard scope rules
- **In scope:** a new agent `kubeconfig` service (status/refresh/activate) + 3
  routes + schemas + config keys; refactor Preflight's kubeconfig check to reuse
  it (single source of truth, 48h); a Stagings banner + agent-client methods +
  types; constants; backend `OperationType` for audit; tests; docs.
- **OUT of scope:** the kuber plugin (brief 15); curated-TOML multi-profile
  switching; refreshing any kubeconfig other than the staging one; changing how
  the `staging` CLI itself resolves its kubeconfig; the plugin contract; other
  plugins.
- English-only UI, dark theme, Mantine, enumerated constants; `ruff`/`mypy`/
  `eslint`/`tsc` clean.

---

## Part A — Agent constants (`agent/app/core/constants.py`)

- `AgentPath`: add `KUBECONFIG_STATUS = "/staging/kubeconfig/status"`,
  `KUBECONFIG_REFRESH = "/staging/kubeconfig/refresh"`,
  `KUBECONFIG_ACTIVATE = "/staging/kubeconfig/activate"`.
- `EnvKey`: add `STAGING_KUBECONFIG_URL = "AGENT_STAGING_KUBECONFIG_URL"`,
  `KUBECONFIG_ACTIVE_PATH = "AGENT_KUBECONFIG_ACTIVE_PATH"`,
  `STAGING_KUBECONFIG_MAX_AGE_HOURS = "AGENT_STAGING_KUBECONFIG_MAX_AGE_HOURS"`.
  (The staging kubeconfig path is already `StagingEnvKey.KUBECONFIG =
  "STAGING_KUBECONFIG"` — promote it to a real `Settings` field in Part B rather
  than reading `os.environ` ad-hoc.)
- Defaults: `DEFAULT_STAGING_KUBECONFIG_URL =
  "https://kubeconf.frn-stg.p.gc.onl/config"`,
  `DEFAULT_KUBECONFIG_ACTIVE_PATH = "~/.kube/config"`,
  `DEFAULT_STAGING_KUBECONFIG_MAX_AGE_HOURS = 48`,
  `KUBECONFIG_REFRESH_GRACE_SECONDS = 300`. **Change/repurpose
  `DEFAULT_KUBECONFIG_FRESHNESS_SECONDS`** so the staleness threshold is 48h and
  driven by the new setting (derive seconds from the hours setting; keep a
  constant only for the default). Do not leave a stray 12h literal.
- `OperationType`: add `KUBECONFIG_REFRESH = "kubeconfig_refresh"` (single audit
  type covering refresh and/or activate; put the concrete action in `recipe`).
- Add `KubeconfigAction(StrEnum)`: `NONE = "none"`, `REFRESH = "refresh"`,
  `ACTIVATE = "activate"`, `REFRESH_AND_ACTIVATE = "refresh_and_activate"` (the
  status endpoint's `recommendedAction`).
- Add `KubeconfigReason(StrEnum)` for machine-readable status reasons:
  `MISSING`, `STALE`, `TOKEN_EXPIRED`, `CONTENT_INVALID`, `NOT_ACTIVE`,
  `HEALTHY`.
- Add `ErrorMessage` entries: `KUBECONFIG_DOWNLOAD_FAILED`,
  `KUBECONFIG_DOWNLOAD_INVALID` ("Downloaded file is not a valid kubeconfig —
  connect Full VPN and retry."), `KUBECONFIG_ACTIVE_PATH_NOT_SYMLINK` (see the
  safety guard in Part C).

## Part B — Agent config (`agent/app/core/config.py`)

Add to `Settings`:
- `staging_kubeconfig: str` default `DEFAULT_STAGING_KUBECONFIG`, alias
  `StagingEnvKey.KUBECONFIG.value` ("STAGING_KUBECONFIG") — single source for the
  staging kubeconfig path; refactor `preflight._kubeconfig_path()` to read this.
- `staging_kubeconfig_url: str` default `DEFAULT_STAGING_KUBECONFIG_URL`.
- `kubeconfig_active_path: str` default `DEFAULT_KUBECONFIG_ACTIVE_PATH`.
- `staging_kubeconfig_max_age_hours: int` default
  `DEFAULT_STAGING_KUBECONFIG_MAX_AGE_HOURS`.
Add all to `agent/.env.example` with comments — **especially** document that
engineers who already manage a `qaa kuber` active path should set
`AGENT_KUBECONFIG_ACTIVE_PATH` to that same path (e.g. `~/.kube/kubecfg.yaml`)
to avoid clobbering a real `~/.kube/config` (see Part C guard).

## Part C — Agent kubeconfig service (`agent/app/services/kubeconfig.py`)

Port the stdlib logic from `kuber.py` (no new deps beyond `httpx`, already used):

- `kubeconfig_looks_valid(text) -> bool`: reject HTML/error bodies; require
  kubeconfig markers (`clusters`, `contexts`, `users`, `current-context`) in
  YAML or JSON form. (Port `kuber.py::kubeconfig_looks_valid`.)
- `kubeconfig_token_expiry(text) -> datetime | None` + `jwt_token_expiry(token)
  -> datetime | None`: base64url-decode the JWT payload and read `exp`. (Port
  `kuber.py::kubeconfig_token_expiry` / `jwt_token_expiry`.) Treat a token as
  expired if `exp <= now + KUBECONFIG_REFRESH_GRACE_SECONDS`.
- `read_status(settings) -> KubeconfigStatusResult` — pure local inspection, no
  network:
  - resolve `path = expanduser(settings.staging_kubeconfig)` and `activePath =
    expanduser(settings.kubeconfig_active_path)`.
  - `exists`; if missing → reason `MISSING`.
  - `contentValid` via `kubeconfig_looks_valid` (read the file text) → reason
    `CONTENT_INVALID`.
  - `tokenExpiresAt` / `tokenExpired` via the JWT helpers → reason
    `TOKEN_EXPIRED`.
  - `modifiedAt` / `ageSeconds` from mtime; `maxAgeSeconds =
    max_age_hours*3600`; `stale = ageSeconds > maxAgeSeconds` → reason `STALE`.
  - `active`: does `activePath` resolve to `path`? (symlink target ==
    path, or same real file via `os.path.realpath`). `active == False` → reason
    `NOT_ACTIVE`.
  - `healthy = exists and contentValid and not tokenExpired and not stale`.
  - `recommendedAction`: if not healthy → `REFRESH_AND_ACTIVATE`; elif healthy
    but not active → `ACTIVATE`; else `NONE`.
  - `reasons`: the list of applicable `KubeconfigReason`s (`[HEALTHY]` when clean
    and active).
- `refresh(settings) -> KubeconfigStatusResult` — download then re-inspect:
  - `httpx.AsyncClient(follow_redirects=True, timeout=...)` GET
    `settings.staging_kubeconfig_url` (no auth — relies on ambient Full VPN, like
    qaa kuber's plain curl). Non-2xx or network error → raise a clear error
    (`KUBECONFIG_DOWNLOAD_FAILED`, hint to connect Full VPN).
  - Validate the body with `kubeconfig_looks_valid` BEFORE writing; invalid →
    raise `KUBECONFIG_DOWNLOAD_INVALID` (do NOT overwrite a good file with an
    HTML error page).
  - Write atomically: to a temp file in the same dir, then `os.replace` onto
    `path` (create parent dirs, `0o600`).
  - Return `read_status(settings)`.
- `activate(settings) -> KubeconfigStatusResult` — make the staging file active:
  - **Safety guard (decisive):** if `activePath` exists and is a **regular file
    (not a symlink)**, DO NOT overwrite it — raise
    `KUBECONFIG_ACTIVE_PATH_NOT_SYMLINK` explaining that the active path is a
    real file and would be destroyed; instruct the user to set
    `AGENT_KUBECONFIG_ACTIVE_PATH` to a managed symlink location. Only proceed
    when `activePath` is missing or already a symlink.
  - Re-point atomically: create/replace the symlink `activePath -> path`
    (equivalent to `ln -sfn path activePath`; write to a temp symlink then
    `os.replace`). (Port `kuber.py::activate_kubeconfig`.)
  - Return `read_status(settings)`.
- audit helper: after a successful `refresh`/`activate`, best-effort
  `build_operation_payload(type=OperationType.KUBECONFIG_REFRESH, ns=None,
  recipe={"action": <KubeconfigAction>, "url": <url when refreshed>}, status=...)`
  + `push_operation(...)` (swallow push errors).

## Part D — Agent schemas

`KubeconfigStatus` response (camelCase, matching existing schema style):
`{ path, activePath, exists, contentValid, tokenExpiresAt: str | None,
tokenExpired, modifiedAt: str | None, ageSeconds: int | None, maxAgeSeconds,
stale, active, healthy, recommendedAction: KubeconfigAction, reasons:
list[KubeconfigReason], url }`. Request body for refresh:
`KubeconfigRefreshRequest { activate: bool = True }`.

## Part E — Agent routes (`agent/app/api/routes.py`)

All require `AuthDep`. Map service errors to HTTP: download failure → 502,
invalid download → 502 (with the clear detail), active-path-not-symlink → 409,
missing staging binary is irrelevant here (this is kubeconfig, not the CLI).
- `GET  AgentPath.KUBECONFIG_STATUS` → `KubeconfigStatus` (never fails on a
  missing file — returns `exists:false`).
- `POST AgentPath.KUBECONFIG_REFRESH` (body `KubeconfigRefreshRequest`) →
  download; if `activate` and the file is now healthy, also activate; return the
  final `KubeconfigStatus`. Best-effort audit.
- `POST AgentPath.KUBECONFIG_ACTIVATE` → activate only; return `KubeconfigStatus`.
  Best-effort audit.

## Part F — Backend registration

`backend/app/core/constants.py`: add `OperationType.KUBECONFIG_REFRESH =
"kubeconfig_refresh"`. Verify the `operations.type` VARCHAR length accommodates
it (`kubeconfig_refresh` = 18 chars); widen via Alembic only if a fixed length is
too small (see brief 13's `20260811_0003` pattern). No backend route — audit
arrives via the agent's existing `POST /operations`.

## Part G — Frontend constants (`frontend/src/constants.ts`)

- `AgentPath`: mirror `KUBECONFIG_STATUS`, `KUBECONFIG_REFRESH`,
  `KUBECONFIG_ACTIVATE`.
- `QueryKey`: `KUBECONFIG_STATUS`.
- `KubeconfigAction` union (`none|refresh|activate|refresh_and_activate`) +
  `KubeconfigReason` union + a `KubeconfigReasonLabel` `Record` (human strings:
  "Missing", "Stale (older than 48h)", "Token expired", "Invalid content",
  "Not the active config", "Healthy").
- `OperationType` mirror: add `KUBECONFIG_REFRESH` (+ label if a
  `Record<OperationType,...>` exists).
- `DEFAULT_KUBECONFIG_STATUS_POLL_MS = 60000` (banner poll cadence).

## Part H — Frontend agent client + types

`frontend/src/api/types.ts`: `KubeconfigStatus`, `KubeconfigRefreshRequest`
(match wire shapes).
`frontend/src/api/agentClient.ts` (reuse `readAgentJson` + `createJsonBody`):
- `getKubeconfigStatus(port, token, signal)` → GET.
- `refreshKubeconfig(port, token, activate, signal)` → POST refresh.
- `activateKubeconfig(port, token, signal)` → POST activate.

## Part I — Frontend banner (`frontend/src/plugins/stagings/`)

- `KubeconfigBanner.tsx`: a self-contained component.
  - `useQuery({ queryKey: [QueryKey.KUBECONFIG_STATUS], queryFn:
    getKubeconfigStatus, refetchInterval: DEFAULT_KUBECONFIG_STATUS_POLL_MS,
    refetchOnWindowFocus: true, enabled: agent detected })`. Depends on the same
    agent discovery the section already uses; if no agent, render nothing (the
    section already shows its "companion app not running" state).
  - Render **nothing** when `status.healthy && status.active`.
  - Otherwise a Mantine `<Alert>`: color/severity by case — `not healthy`
    (missing/stale/expired/invalid) = warning "staging operations will fail
    until the kubeconfig is refreshed"; healthy-but-`!active` = info "the staging
    kubeconfig is fresh but not the active one". List the `reasons` via
    `KubeconfigReasonLabel`; show `tokenExpiresAt` / age when present.
  - Buttons driven by `recommendedAction`:
    - `REFRESH_AND_ACTIVATE` → primary "Refresh & activate"
      (`refreshKubeconfig(activate:true)`).
    - `ACTIVATE` → "Activate" (`activateKubeconfig`).
    - also offer a secondary "Refresh only" (`refreshKubeconfig(activate:false)`)
      when not healthy.
  - `useMutation` per action; on settle invalidate `QueryKey.KUBECONFIG_STATUS`;
    show a success/error toast (Mantine notifications, as elsewhere). Surface the
    409 active-path-not-symlink error verbatim (it tells the user to set
    `AGENT_KUBECONFIG_ACTIVE_PATH`). Disable buttons while pending.
- Mount `<KubeconfigBanner />` in `StagingsSection.tsx` **above** the per-mode
  panel, so it shows on every Stagings tab (Decision 2).
- `PreflightPanel.tsx`: the existing KUBECONFIG check row should reflect the same
  truth. Simplest: keep the banner as the action surface and leave preflight as
  a read-only checklist, but ensure `_check_kubeconfig` now agrees (Part B
  refactor gives 48h + validity + token awareness). Optionally add a "Refresh"
  button to that row reusing the same mutation (nice-to-have, not required).

## Part J — Preflight consistency (agent)

Refactor `preflight._check_kubeconfig` to call the new `read_status` and report
`ok = status.healthy` with a detail assembled from `status.reasons` (so Preflight
and the banner never disagree). `_kubeconfig_path()` → `settings.staging_kubeconfig`.
Keep the other 9 checks unchanged. The `_check_cluster_reachable` check keeps
using `--kubeconfig <staging path>` (now via settings). Ensure the existing
preflight tests still pass (adjust expectations for the 48h threshold / new
detail text).

## Part K — Tests

Agent (`agent/tests/test_kubeconfig.py`): unit-test `kubeconfig_looks_valid`
(valid YAML/JSON vs HTML/403), `jwt_token_expiry` (a crafted JWT with a known
`exp`; expired-within-grace vs fresh), `read_status` across the matrix
(missing / stale-by-mtime / token-expired / invalid-content / healthy-but-
inactive / healthy+active) using a temp `HOME` + temp files + monkeypatched
settings. `refresh`: stub `httpx` (MockTransport) returning a valid config → file
written + status healthy; returning HTML → raises, original file untouched;
network error → raises. `activate`: symlink created when active path is missing
or a symlink; **refuses** (raises) when active path is a regular file (the safety
guard). Routes: status/refresh/activate happy paths + auth-required (401) + the
409 guard; best-effort audit push asserted via the backend `MockTransport` like
the deploy tests. Update the existing preflight tests for the 48h/validity
refactor.

Frontend: `agentClient.test.ts` (URL/method/body/Bearer for the 3 methods);
`KubeconfigBanner.test.tsx` — hidden when healthy+active; warning + "Refresh &
activate" when stale (assert the mutation fires + query invalidates); info +
"Activate" when healthy-but-inactive; renders the 409 error text. Reuse
`renderWithProviders`.

## Part L — Docs

- `agent/README.md` / `agent/.env.example`: document `STAGING_KUBECONFIG`,
  `AGENT_STAGING_KUBECONFIG_URL`, `AGENT_KUBECONFIG_ACTIVE_PATH` (+ the
  regular-file safety guard and the qaa-kuber-active-path tip),
  `AGENT_STAGING_KUBECONFIG_MAX_AGE_HOURS`, and the 3 `/staging/kubeconfig/*`
  routes.
- `frontend/README.md`: note the Stagings kubeconfig banner (detect/refresh/
  activate) and that it needs Full VPN to download.

---

## Gates (all must pass)
- Agent: `cd agent && ruff check . && ruff format --check . && mypy app && pytest`
- Frontend: `cd frontend && npm run lint && npx tsc --noEmit && npm run test && npm run build`
- Backend: `cd backend && ruff check . && ruff format --check . && mypy app && pytest`

## Acceptance criteria
1. A persistent banner appears on **every** Stagings tab whenever the staging
   kubeconfig is missing / stale (>48h) / token-expired / content-invalid, or is
   fresh but not the active config; it is hidden when healthy AND active.
2. Staleness uses mtime (48h, configurable — the old 12h literal is gone), JWT
   `exp` (300s grace), and content validity; no cluster call is required for the
   status.
3. "Refresh & activate" downloads a fresh kubeconfig from the configured URL,
   validates it before writing (never clobbering a good file with an error page),
   writes atomically, and re-points the active-kubeconfig symlink — and the
   banner clears without a reload.
4. "Activate" (fresh-but-inactive) re-points the symlink only; activation refuses
   to overwrite a **regular** active-path file and surfaces a clear instruction.
5. Refresh/activate are recorded best-effort in `operations`
   (`type=kubeconfig_refresh`, `user_id` = current user).
6. Preflight's kubeconfig check agrees with the banner (shared `read_status`);
   other plugins and the JobManager are unchanged; all three gate suites are
   green; docs updated.

## Open questions (surface, don't silently decide)
- **Active-path default:** default is `~/.kube/config` with a no-clobber guard,
  but many engineers' `~/.kube/config` is a real merged file → activation will
  refuse until they set `AGENT_KUBECONFIG_ACTIVE_PATH` to a managed symlink
  (their qaa-kuber active path). Confirm this is acceptable vs. shipping a
  different default.
- **Download auth:** the URL is fetched with no credentials (ambient Full VPN),
  matching qaa kuber. If the endpoint ever needs SSO/cookies, this needs revisit.
- **Namespace-scoped staleness:** this brief handles only the single staging
  kubeconfig; the kuber plugin (brief 15) handles arbitrary contexts separately.
  A later brief could unify both under one agent kubeconfig service.

When done, ensure all three gate suites pass, then stop. Do not commit — the
reviewer inspects `git diff` and commits.
