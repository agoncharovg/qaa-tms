# Brief 17 — Jenkins plugin (`.QAA/E2E` explorer over the local agent)

Add a new **builtin** ("общий", first-party) plugin `jenkins` that lets an
engineer see the whole `.QAA/E2E` pipeline forest **as a live status tree**
instead of clicking folder-by-folder through the native Jenkins UI. It renders a
collapsible tree of folders/pipelines with a current status per pipeline, lets
the engineer drill into a pipeline's recent builds, jump to the pipeline page or
its Allure report in a real browser tab, and **pin** folders onto a separate
"Pinned" board that shows compact status-count widgets.

This is the product of `discuss/09`. The native UI pain it solves: Jenkins shows
one folder at a time, so checking everything means walking the tree by hand.

**Scope is deliberately narrowed to two roots for the MVP** (confirmed with the
owner): only
- `job/.QAA/job/E2E/job/PREPROD`
- `job/.QAA/job/E2E/job/PROD`

i.e. the plugin fetches the subtree of **`job/.QAA/job/E2E`** and its two child
folders `PREPROD` and `PROD` become the tree roots. Do NOT fetch the rest of
`.QAA` (UI_E2E, Performance, Utils, …) in this slice.

## Transport = the local agent ONLY (the whole point)

Jenkins (`https://jenkins.p.gc.onl`) sits behind corp VPN and each engineer has
their **own** Jenkins user + API token. Per the owner's decision — *"каждый видит
только то, к чему имеет доступ"* — cluster/Jenkins access must never be a shared
server credential. So this plugin talks to the **local agent** on `127.0.0.1`
(the Stagings/Kuber model): the agent makes authenticated HTTP calls to Jenkins
using the **engineer's own** token from the agent's environment. It does NOT use
the app backend for Jenkins access. `origin: "builtin"`, `kind: "optional"`,
`requiresAgent: true`.

This upholds the `discuss/06` trust model: П1 — the plugin gets only
local-machine capability, never the app token/backend for Jenkins I/O; П2 — it
cannot exceed the engineer's own Jenkins access (their token, their VPN).

Unlike Kuber (which shells out to a CLI), the agent here is an **HTTP client** to
a remote REST API — reuse the `httpx.AsyncClient` pattern already in
`agent/app/services/backend.py`, not the subprocess helpers.

Read FIRST:
- `discuss/09` — the product spec this brief implements.
- `discuss/06` §1 (trust П1/П2), §2 (two channels), §3 (contract).
- `briefs/12-unified-plugin-contract.md` — the plugin contract this rides on.
- `briefs/15-kuber-plugin.md` — the closest analogue (builtin, optional,
  `requiresAgent`, agent-only, no backend proxy). This brief mirrors its shape;
  where 15 shells out to `kubectl`, 17 does HTTP to Jenkins.
- Reference Jenkins client (semantics + URL shapes, DO NOT import — it lives in a
  sibling repo): `~/Projects/qaa-e2e/ai/scripts/clients/jenkins_client.py`
  (`_get`, `normalize_build_url`, the `allure/` sub-path convention).
- Jenkins field semantics (memory `reference_jenkins_data_access`): `color`
  (`blue`/`red`/`yellow`/`disabled`/`notbuilt`/`aborted`, suffix `_anime` =
  running), `_class` folder-vs-job discrimination, the recursive `tree=` filter.
- Agent template: `agent/app/services/backend.py` (`httpx.AsyncClient`, headers),
  `agent/app/core/config.py` (`Settings` + `Field(alias=EnvKey.X.value)`),
  `agent/app/core/constants.py` (`AgentPath`, `EnvKey`, `ErrorMessage`,
  `StrEnum`s), `agent/app/api/routes.py` (read GETs, `AuthDep`,
  `StagingNotInstalledError`→503 / `ValueError`→400 mapping),
  `agent/app/api/deps.py` (`AuthContext`, `require_auth`), `agent/app/schemas`
  (camelCase alias-generator response models like `KubePodsResponse`).
- Frontend template: `frontend/src/plugins/kuber/{manifest.tsx,KuberSection.tsx,
  kuberStore.ts,ClustersPanel.tsx,PodsPanel.tsx}`; `frontend/src/api/agentClient.ts`
  (`readAgentJson`, path builders, `discoverAgent`); `frontend/src/api/types.ts`;
  `frontend/src/core/plugins/{definePlugin.ts,types.ts,icons.ts}`;
  `frontend/src/plugins/discovery.ts` + `discovery.test.ts`;
  `frontend/src/store/uiStoreCore.ts` (`createBootstrapTabsByPlugin`);
  `frontend/src/constants.ts`.
- Backend template: `backend/app/core/constants.py` (`PluginId`,
  `OPTIONAL_PLUGIN_IDS`) and `backend/app/api/v1/users.py` (`/me/plugins`
  validation).
- `CONVENTIONS.md` — no inline string/number literals; enumerate everything;
  English-only UI, dark theme, Mantine.

---

## Decisions (from discuss/09 — implement, do not re-litigate)
1. **Source = live Jenkins REST**, agent-side, over the engineer's token. One
   recursive `tree=` call per session-fetch gets the whole `E2E` subtree
   (PREPROD + PROD); NO per-job N+1 for the tree (all status inputs come in the
   one recursive query). Build history is a **separate lazy** call, only when a
   pipeline is expanded.
2. **Scope = `job/.QAA/job/E2E` only** (roots PREPROD, PROD). The root path is a
   config key so it can be widened later without code change, but the default and
   the only supported scope for this brief are those two.
3. **Status per pipeline** is computed server-side into a small enum
   (PASSED/FAILED/DISABLED/RUNNING/STUCK/NOTBUILT) so every UI (tree rows + board
   widgets) shares one definition. The **STUCK** ("жёлто-красный") bucket is the
   `discuss/09` glitch case (buildable, not scheduled, idle, nothing queued) — a
   **heuristic** (see Part C) with a config knob; treat it as tunable, not exact.
4. **Interactions are browser-native, not proxied:**
   - single-click pipeline → expand its recent builds inline (lazy);
   - double-click pipeline → `window.open(node.url)` (the real Jenkins page, in
     the engineer's browser session/VPN);
   - double-click build → `window.open(build.allureUrl)` where
     `allureUrl = "{build.url}allure/"`;
   - pin/unpin folders (client-side, persisted to `localStorage`); the Pinned
     board renders **recursive** status-count widgets (counts include pipelines
     in nested sub-folders); double-click a widget → `window.open(folder.url)`.
5. **Read-only MVP.** No Jenkins mutations (no build trigger, no rebuild) → NO
   `operations` audit, NO backend route, NO CSRF crumb. Just GETs.

## Hard scope rules
- **In scope:** a new `jenkins` service + routes + schemas in the **agent**;
  agent config keys; a new frontend builtin plugin folder (2 tabs: Tree, Pinned)
  + agent-client methods + types; frontend constants; backend `PluginId`
  registration; tests; docs.
- **OUT of scope (do NOT do):** any Jenkins **write** (trigger/rebuild/stop —
  a possible later brief, and the reason STUCK exists is exactly to *surface*
  such jobs for a human to rebuild manually for now); fetching `.QAA` beyond
  `E2E` (UI_E2E/Performance/Utils/…); any **backend** proxy to Jenkins (all
  Jenkins I/O goes via the agent); parsing/rendering Allure **inside** the app
  (we only open its URL in a new tab); a real OS-level separate window (the
  "separate window" from discuss/09 is realized as the **Pinned tab**; a true
  popup `window` is a later option, noted below); changing the plugin contract;
  touching Stagings / Kuber / qaa-generator / Admin plugins; the JobManager.
- English-only UI, dark theme, Mantine, enumerated constants, `ruff`/`mypy`/
  `eslint`/`tsc` clean.

---

## Part A — Agent constants (`agent/app/core/constants.py`)

- `AgentPath`: add
  - `JENKINS_TREE = "/jenkins/tree"`
  - `JENKINS_BUILDS = "/jenkins/builds"`
- `EnvKey`: add
  - `JENKINS_URL = "AGENT_JENKINS_URL"`
  - `JENKINS_USERNAME = "AGENT_JENKINS_USERNAME"`
  - `JENKINS_TOKEN = "AGENT_JENKINS_TOKEN"`
  - `JENKINS_ROOT_PATH = "AGENT_JENKINS_ROOT_PATH"`
  - `JENKINS_REQUEST_TIMEOUT = "AGENT_JENKINS_REQUEST_TIMEOUT"`
  - `JENKINS_TREE_DEPTH = "AGENT_JENKINS_TREE_DEPTH"`
  - `JENKINS_STUCK_MIN_IDLE_HOURS = "AGENT_JENKINS_STUCK_MIN_IDLE_HOURS"`
- Defaults:
  - `DEFAULT_JENKINS_URL = "https://jenkins.p.gc.onl"`
  - `DEFAULT_JENKINS_ROOT_PATH = "job/.QAA/job/E2E"`
  - `DEFAULT_JENKINS_REQUEST_TIMEOUT = 15.0` (seconds)
  - `DEFAULT_JENKINS_TREE_DEPTH = 5`
  - `DEFAULT_JENKINS_STUCK_MIN_IDLE_HOURS = 6`
  - `DEFAULT_JENKINS_BUILDS_LIMIT = 15`
- `JenkinsNodeKind(StrEnum)`: `FOLDER = "folder"`, `PIPELINE = "pipeline"`.
- `JenkinsStatus(StrEnum)`: `PASSED = "passed"`, `FAILED = "failed"`,
  `DISABLED = "disabled"`, `RUNNING = "running"`, `STUCK = "stuck"`,
  `NOTBUILT = "notbuilt"`.
- `JenkinsColor(StrEnum)` (only the values we branch on): `BLUE = "blue"`,
  `RED = "red"`, `YELLOW = "yellow"`, `DISABLED = "disabled"`,
  `NOTBUILT = "notbuilt"`, `ABORTED = "aborted"`; and
  `JENKINS_ANIME_SUFFIX = "_anime"`.
- Jenkins `_class` markers (substring match, keep as constants):
  `JENKINS_FOLDER_CLASS = "com.cloudbees.hudson.plugins.folder.Folder"`;
  timer-trigger detection: `JENKINS_TIMER_TRIGGER_CLASS = "hudson.triggers.TimerTrigger"`,
  `JENKINS_SCM_TRIGGER_CLASS = "hudson.triggers.SCMTrigger"`.
- `JenkinsApiPath`: `API_JSON = "api/json"`, `ALLURE_SUFFIX = "allure/"`.
- `ErrorMessage`: add
  - `JENKINS_NOT_CONFIGURED = "Jenkins is not configured (set AGENT_JENKINS_URL/USERNAME/TOKEN)."`
  - `JENKINS_UNREACHABLE = "Jenkins is unreachable."`
  - `JENKINS_PATH_OUT_OF_SCOPE = "Requested job path is outside the allowed .QAA/E2E scope."`

## Part B — Agent config (`agent/app/core/config.py`)

Add to `Settings` (`Field(default=..., alias=EnvKey.X.value)`):
- `jenkins_url: str` default `DEFAULT_JENKINS_URL` (normalize: `rstrip("/")`, same
  as `normalize_backend_url`).
- `jenkins_username: str` default `""`.
- `jenkins_token: str` default `""`.
- `jenkins_root_path: str` default `DEFAULT_JENKINS_ROOT_PATH` (normalize:
  strip leading/trailing `/`).
- `jenkins_request_timeout: float` default `DEFAULT_JENKINS_REQUEST_TIMEOUT`.
- `jenkins_tree_depth: int` default `DEFAULT_JENKINS_TREE_DEPTH`.
- `jenkins_stuck_min_idle_hours: int` default
  `DEFAULT_JENKINS_STUCK_MIN_IDLE_HOURS`.

`jenkins_configured` helper property: `bool(jenkins_url and jenkins_username and
jenkins_token)`.

Add all keys to `agent/.env.example` with comments (esp. that the token is the
engineer's **personal** Jenkins API token, VPN required).

## Part C — Agent Jenkins service (`agent/app/services/jenkins.py`)

HTTP client, no subprocess. Model it on `services/backend.py`.

- `class JenkinsNotConfiguredError(RuntimeError)` and
  `class JenkinsUnreachableError(RuntimeError)` (analogues of
  `StagingNotInstalledError`).
- `class JenkinsPathOutOfScopeError(ValueError)`.
- `def require_configured(settings) -> None`: raise `JenkinsNotConfiguredError(
  ErrorMessage.JENKINS_NOT_CONFIGURED.value)` unless `settings.jenkins_configured`.
- `async def _get_json(settings, job_path, *, tree) -> dict`: build
  `f"{settings.jenkins_url}/{job_path}/{JenkinsApiPath.API_JSON}"`, call it with
  `httpx.AsyncClient(timeout=settings.jenkins_request_timeout,
  auth=httpx.BasicAuth(settings.jenkins_username, settings.jenkins_token))`,
  `params={"tree": tree}`, `follow_redirects=True`. Map `httpx.HTTPError` /
  `httpx.TimeoutException` / non-2xx → `JenkinsUnreachableError(
  ErrorMessage.JENKINS_UNREACHABLE.value)` (include the status/URL in the log,
  NOT the token). Use `async with` per call (no shared client needed at this
  volume).

- **Scope guard** `validate_job_path(settings, path) -> str`: the frontend sends a
  Jenkins job path (e.g. `job/.QAA/job/E2E/job/PREPROD/job/Foo`). Normalize
  (strip `/`), then require it to start with `settings.jenkins_root_path` (the
  `E2E` prefix) AND contain no `..`, no scheme, no host, no query. Reject with
  `JenkinsPathOutOfScopeError(ErrorMessage.JENKINS_PATH_OUT_OF_SCOPE.value)`
  otherwise. This is the anti-SSRF boundary — NEVER accept an absolute URL from
  the client; only a validated relative job path that is expanded against the
  configured base.

- **Tree fetch** `async def fetch_tree(settings) -> list[JenkinsNode]`:
  - `require_configured`.
  - Build a recursive `tree=` filter `settings.jenkins_tree_depth` levels deep,
    each level:
    `jobs[name,url,_class,color,buildable,disabled,inQueue,`
    `lastBuild[timestamp,building,result],`
    `property[_class,triggers[_class,spec]],triggers[_class,spec],jobs[...]]`
    (nest `jobs[...]` to `jenkins_tree_depth`). Fetch once against
    `settings.jenkins_root_path` (`E2E`). The returned top-level `jobs[]` are
    PREPROD and PROD.
  - Recursively map each raw job → `JenkinsNode`:
    - `kind = FOLDER if JENKINS_FOLDER_CLASS in _class else PIPELINE`.
    - folders: `children = [map(child) for child in raw.get("jobs", [])]`,
      `status = None`.
    - pipelines: `status = derive_status(raw, settings)`, `children = []`.
  - Return the two root nodes (PREPROD, PROD) in the order Jenkins gives them.

- **Status derivation** `def derive_status(raw, settings) -> JenkinsStatus` — the
  single source of truth; document each branch with a comment mapping to
  `discuss/09`. Precedence:
  1. `color` endswith `_anime` → `RUNNING`.
  2. `disabled is True` or `color == "disabled"` → `DISABLED` (grey).
  3. `is_stuck(raw, settings)` → `STUCK` (yellow-red). **Checked before
     pass/fail** because a stuck job's last build may itself be blue/red — the
     "не работает фактически" state overrides the stale colour for the widgets.
  4. `color` startswith `blue` → `PASSED` (green).
  5. `color` startswith `red` or `yellow` → `FAILED` (red; `yellow`=unstable is
     bucketed as failed for MVP — note in code).
  6. else (`notbuilt`/`aborted`/`None`) → `NOTBUILT` (neutral grey).
- `def is_stuck(raw, settings) -> bool` — the heuristic for `discuss/09`'s glitch
  ("активный, не по расписанию, нет активного билда, нет явного ожидания"):
  `buildable is True` AND not `disabled` AND colour has no `_anime` AND
  `inQueue is False` AND **no schedule** (`has_schedule(raw) is False`) AND
  `lastBuild.building is False` AND the last build finished at least
  `settings.jenkins_stuck_min_idle_hours` ago (idle-age gate to cut false
  positives; if `lastBuild` or its `timestamp` is missing, do NOT flag stuck).
  Pass timestamps in explicitly if you need "now" — the agent may use
  `datetime.now(tz=UTC)` here (this is runtime code, not a workflow script).
- `def has_schedule(raw) -> bool`: True if any trigger under `raw["triggers"]` or
  under `raw["property"][*]["triggers"]` has a `_class` containing
  `JENKINS_TIMER_TRIGGER_CLASS` or `JENKINS_SCM_TRIGGER_CLASS`, or a non-empty
  `spec`. (Pipeline timer triggers live under the
  `PipelineTriggersJobProperty` property; freestyle under top-level `triggers`.
  The single tree filter above captures both.) Be defensive about missing keys.

- **Builds fetch** `async def fetch_builds(settings, job_path) -> list[JenkinsBuild]`:
  - `require_configured`; `validate_job_path`.
  - `_get_json(settings, job_path, tree=f"builds[number,result,building,timestamp,`
    `duration,url]{{0,{DEFAULT_JENKINS_BUILDS_LIMIT}}}")`.
  - Map each raw build → `JenkinsBuild(number, result, building, timestamp,
    durationMs=duration, url, allureUrl=f"{url}{JenkinsApiPath.ALLURE_SUFFIX}")`.
    `result` may be `None` while `building` is True.

## Part D — Agent schemas (`agent/app/schemas`, camelCase alias generator — match
`KubePodsResponse` style)

- `JenkinsNode { name: str, url: str, kind: JenkinsNodeKind,
  status: JenkinsStatus | None, color: str | None, children: list[JenkinsNode] }`
  (self-referential; use the forward-ref pattern the codebase already uses, or
  `model_rebuild()`).
- `JenkinsTreeResponse { roots: list[JenkinsNode] }`.
- `JenkinsBuild { number: int, result: str | None, building: bool,
  timestamp: int, durationMs: int, url: str, allureUrl: str }`.
- `JenkinsBuildsResponse { builds: list[JenkinsBuild] }`.

## Part E — Agent routes (`agent/app/api/routes.py`)

Both require `AuthDep`. Map `JenkinsNotConfiguredError` → **503**,
`JenkinsPathOutOfScopeError`/`ValueError` → **400**, `JenkinsUnreachableError`
→ **502** (mirror the existing exception→HTTPException mapping style).

- `GET JENKINS_TREE` → `JenkinsTreeResponse` (`roots = await fetch_tree(settings)`).
- `GET JENKINS_BUILDS` with `path: str = Query(...)` → `JenkinsBuildsResponse`
  (`builds = await fetch_builds(settings, path)`).

## Part F — Backend registration (`backend/app/core/constants.py`)

- `PluginId`: add `JENKINS = "jenkins"`.
- `OPTIONAL_PLUGIN_IDS`: append `PluginId.JENKINS` (so `PUT /me/plugins`
  validates/persists it and the Administration → Plugins toggle picks it up
  automatically). No `OperationType`, no new route, no migration — read-only
  plugin, no audit records.

## Part G — Frontend constants (`frontend/src/constants.ts`)

Append to the existing const-object + type-alias groups (every exhaustive
`Record` gets its new entries or `tsc` fails):
- `PluginId`: `JENKINS: "jenkins"`.
- `IconName`: add `JENKINS: "jenkins"` and register it in
  `core/plugins/icons.ts` `ICON_REGISTRY` (`IconBrandJenkins` from
  `@tabler/icons-react`; the `Record<IconName, TablerIcon>` is exhaustive).
- `ViewKey`: `JENKINS_TREE`, `JENKINS_BOARD`.
- `TabId`: `JENKINS_TREE: "tab-jenkins-tree"`, `JENKINS_BOARD: "tab-jenkins-board"`.
- `TabTitle` (`Record<TabId, string>`): `"Tree"`, `"Pinned"`.
- `AgentPath`: `JENKINS_TREE: "/jenkins/tree"`, `JENKINS_BUILDS: "/jenkins/builds"`.
- Path builders near the agent group (encode via `URLSearchParams`, never
  string-concat): `buildAgentJenkinsTreePath()`,
  `buildAgentJenkinsBuildsPath(path)` (`?path=<encoded>`).
- `QueryKey`: `JENKINS_TREE`, `JENKINS_BUILDS`.
- `StorageKey`: `JENKINS_PINNED` (persists the pinned folder paths).
- Status → colour/label maps for the UI, exhaustive over `JenkinsStatus`:
  `JenkinsStatusColor` (green/red/gray/`"yellow"`-ish for STUCK — pick Mantine
  colours: PASSED `green`, FAILED `red`, DISABLED `gray`, RUNNING `blue`,
  STUCK `yellow` or a red-on-yellow treatment, NOTBUILT `gray`) and
  `JenkinsStatusLabel`.
- `DEFAULT_JENKINS_TREE_REFETCH_MS = 30000` (tree auto-refresh cadence).

## Part H — Frontend agent client + types

`frontend/src/api/types.ts`: add `JenkinsNodeKind`, `JenkinsStatus`,
`JenkinsNode` (recursive), `JenkinsTreeResponse`, `JenkinsBuild`,
`JenkinsBuildsResponse` (match the agent camelCase wire shapes).

`frontend/src/api/agentClient.ts`: add, using `readAgentJson` + the new builders:
- `getJenkinsTree(port, token, signal)` → `JenkinsTreeResponse`.
- `getJenkinsBuilds(port, token, path, signal)` → `JenkinsBuildsResponse`.

## Part I — Frontend plugin folder `frontend/src/plugins/jenkins/`

Discovery is glob-based — the folder auto-registers once `manifest.tsx` exports a
valid `definePlugin(...)`.

- `manifest.tsx`: `definePlugin({ id: PluginId.JENKINS, icon: IconName.JENKINS,
  kind: PluginKind.OPTIONAL, origin: PluginOrigin.BUILTIN, contractVersion:
  CONTRACT_VERSION, label: "Jenkins", order: 25 (infra group: stagings 10,
  kuber 15, qaa-generator 20, jenkins 25, admin 30), route: "/jenkins",
  requiresAgent: true, tabs: [Tree, Pinned] })` — two element-tabs rendering
  `<JenkinsSection mode={ViewKey.X} />`.
- `JenkinsSection.tsx`: mode dispatcher (`ViewKey.JENKINS_BOARD → <BoardPanel/>`,
  default `<TreePanel/>`) + the agent-availability guard used by `KuberSection`
  (`discoverAgent` → graceful "companion app not running").
- `jenkinsStore.ts` (Zustand, mirror `kuberStore.ts`): `pinnedPaths: string[]`
  with `pin(path)`/`unpin(path)`/`isPinned(path)`, persisted to `localStorage`
  under `StorageKey.JENKINS_PINNED`; plus transient `expandedNodePaths: Set` for
  the tree if you don't keep expansion local to the component.
- `TreePanel.tsx`:
  - `useQuery(getJenkinsTree)` with `refetchInterval: DEFAULT_JENKINS_TREE_REFETCH_MS`
    while the tab is active. Loading/empty/error (503 → "Jenkins not configured
    in the companion app"; 502 → "Jenkins unreachable — VPN?").
  - Recursive tree component (build on Mantine — a recursive
    row/`Collapse` component is fine; don't pull a new dep). Per-node:
    - folder row: expand/collapse chevron + name + a **Pin/Unpin** toggle +
      double-click → `window.open(node.url, "_blank", "noopener")`.
    - pipeline row: status dot/`Badge` (colour from `JenkinsStatusColor`) + name;
      **single-click** toggles an inline builds sub-panel (lazy
      `useQuery(getJenkinsBuilds, path)`, enabled on first expand); **double-click**
      → `window.open(node.url)`. In the builds sub-panel each build row shows
      number/result/age and **double-click** → `window.open(build.allureUrl)`
      (tooltip: "Open Allure report"; not every build has one — that's fine, the
      tab will 404 in Jenkins, acceptable for MVP).
  - Toolbar: `Expand all` / `Collapse all`, `Refresh`.
  - Derive each node's Jenkins **path** from its `url` (strip the
    `settings.jenkins_url` origin → the `job/...` path) for the builds call, OR
    have the agent include a `path` field on each node (simpler + avoids origin
    coupling — **preferred**: add `path: str` to `JenkinsNode`/`JenkinsBuild`
    schema and set it agent-side from the job URL). If you add `path`, mirror it
    in Part D/H and the tests.
- `BoardPanel.tsx` (the "separate window / widgets" from discuss/09, realized as a
  tab): reads `pinnedPaths` from the store and the same tree query; for each
  pinned folder, locate its subtree and compute **recursive** counts over all
  descendant pipelines: `green=PASSED`, `red=FAILED`, `gray=DISABLED+NOTBUILT`,
  `yellow=STUCK`, and (optional) `running=RUNNING`. Render one widget card per
  pinned folder showing the four counts as coloured pills. **Single-click** a
  widget expands the list of its descendant pipelines (flattened, even from
  nested folders) with their statuses; **double-click** → `window.open(folder.url)`.
  Empty state when nothing is pinned ("Pin folders from the Tree tab").

## Part J — Store bootstrap + discovery test

- `frontend/src/store/uiStoreCore.ts` `createBootstrapTabsByPlugin()`: add a
  `[PluginId.JENKINS]` entry (`activeTabId`/`tabIds` = `TabId.JENKINS_TREE`) so
  `tabsByPlugin[PluginId.JENKINS]` is defined pre-hydration.
- `frontend/src/plugins/discovery.test.ts`: update the expected ordered
  `PLUGINS.map(p => p.id)` to `[STAGINGS, KUBER, QAA_GENERATOR, JENKINS, ADMIN]`
  (orders 10/15/20/25/30 — confirm against the actual qaa-generator order in the
  repo and slot JENKINS at 25).

## Part K — Tests

Agent (`agent/tests/test_jenkins.py`): stub Jenkins HTTP with
`httpx.MockTransport` (inject a transport/handler into the client the service
builds — refactor `_get_json` to accept an optional injected client/transport for
testability, same spirit as the backend push tests). Cover:
- tree parse: folders vs pipelines by `_class`; PREPROD/PROD as roots; recursion
  into nested folders.
- `derive_status`: a case for each bucket — `blue`→PASSED, `red`→FAILED,
  `yellow`→FAILED, `disabled`→DISABLED, `blue_anime`→RUNNING, `notbuilt`→NOTBUILT,
  and a STUCK case (buildable, not disabled, no schedule, not in queue, last
  build old & not building) → STUCK; plus a near-miss that is NOT stuck because a
  timer trigger exists (`has_schedule` true) and one not stuck because last build
  is within the idle-age gate.
- builds parse + `allureUrl` derivation; a `building:true`/`result:null` build.
- scope guard: an out-of-scope `path` (e.g. `job/.QAA/job/UI_E2E/...` or one with
  `..`) → 400; an in-scope path passes.
- not configured (missing token) → 503; unreachable (transport raises / 500 from
  Jenkins) → 502; auth required (no Bearer) → 401.

Frontend: `agentClient.test.ts` (stub `fetch`; assert URL/method/Bearer for
`getJenkinsTree`/`getJenkinsBuilds`, and that `path` is URL-encoded);
`TreePanel.test.tsx` (renders a mocked tree; expanding a pipeline fires the builds
query; pin toggles the store; **mock `window.open`** and assert double-click on a
pipeline/build calls it with the right URL); `BoardPanel.test.tsx` (pinned folder
→ recursive counts across a nested subtree; double-click opens the folder URL);
update `discovery.test.ts`. Reuse `renderWithProviders` from `src/test/render.tsx`.

## Part L — Docs

- `frontend/README.md`: add the Jenkins plugin (two tabs Tree/Pinned; talks to
  the local agent only; needs the engineer's Jenkins token in the companion app;
  scoped to `.QAA/E2E` PREPROD+PROD).
- `agent/README.md` / `agent/.env.example`: document `AGENT_JENKINS_URL`,
  `AGENT_JENKINS_USERNAME`, `AGENT_JENKINS_TOKEN`, `AGENT_JENKINS_ROOT_PATH`,
  `AGENT_JENKINS_REQUEST_TIMEOUT`, `AGENT_JENKINS_TREE_DEPTH`,
  `AGENT_JENKINS_STUCK_MIN_IDLE_HOURS`, and the `/jenkins/*` routes.

---

## Gates (all must pass)
- Agent: `cd agent && ruff check . && ruff format --check . && mypy app && pytest`
- Frontend: `cd frontend && npm run lint && npx tsc --noEmit && npm run test && npm run build`
- Backend: `cd backend && ruff check . && ruff format --check . && mypy app && pytest`

## Acceptance criteria
1. New builtin plugin `jenkins` (order 25, optional, `requiresAgent:true`)
   auto-discovered; sidebar shows it with the Jenkins icon; tabs Tree/Pinned
   render; with no agent it degrades gracefully ("companion app not running").
2. Tree tab shows the live `.QAA/E2E` forest (PREPROD + PROD roots, nested
   folders) with a correct status badge per pipeline from one recursive Jenkins
   call (no per-job N+1 for the tree); Expand all / Collapse all / Refresh work.
3. Single-click a pipeline lazily expands its recent builds; double-click a
   pipeline opens its Jenkins page in a new tab; double-click a build opens
   `{buildUrl}allure/`; all opens go through `window.open` in the engineer's
   browser (no proxy).
4. Pin/unpin folders persists across reloads; the Pinned tab shows per-folder
   widgets with recursive green/red/gray/yellow(STUCK) counts; clicking a widget
   lists its descendant pipelines (incl. nested); double-click opens the folder.
5. STUCK is computed by the documented heuristic (buildable + not disabled + not
   running + not queued + no timer/SCM schedule + idle ≥ configured hours) and is
   the only "unclear" bucket; it is tunable via
   `AGENT_JENKINS_STUCK_MIN_IDLE_HOURS`.
6. All Jenkins I/O flows ONLY through the local agent under the engineer's own
   Jenkins token; no app token/backend is used for Jenkins; the agent rejects
   out-of-scope job paths (400) and reports not-configured (503) / unreachable
   (502) clearly. Read-only: no Jenkins mutation, no `operations` record.
7. Stagings/Kuber/qaa-generator/Admin plugins and the JobManager are unchanged;
   the plugin contract is unchanged; all three gate suites are green; docs
   updated.

## Open questions (surface, don't silently decide)
- **STUCK precision:** the heuristic is a best-effort read of `discuss/09`'s glitch
  case. Validate it against the **live** `.QAA/E2E` tree (memory
  `reference_jenkins_data_access` has a regenerate snippet) and tune
  `jenkins_stuck_min_idle_hours` / the trigger rules — a manually-triggered idle
  job with no timer is *technically* "active but idle" yet may not be broken.
  Consider also treating "upstream-triggered but upstream is stuck" later.
- **Unstable (`yellow`) bucketing:** MVP folds unstable into FAILED (red). If the
  team wants a distinct amber "unstable" bucket, add a 7th status — cheap follow-up.
- **Real separate window:** discuss/09 says "на отдельном окне". MVP realizes the
  board as a tab. A true detached `window.open` mini-dashboard (its own route
  rendering `BoardPanel`) is a small follow-up if the team wants it on a second
  monitor.
- **Allure absence:** double-clicking a build whose run archived no Allure opens a
  Jenkins 404. Acceptable for MVP; a later enrich could HEAD the `allure/` URL and
  disable the action when absent.
- **Scope widening:** `AGENT_JENKINS_ROOT_PATH` makes it a one-line change to add
  UI_E2E/Performance/etc. later, but tree size (214 leaves for all of `.QAA`) and
  refetch cost should be measured before widening the default.

When done, ensure all three gate suites pass, then stop. Do not commit — the
reviewer inspects `git diff` and commits.
