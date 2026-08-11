# Brief 15 — Kuber plugin (Kubernetes explorer over the local agent)

Add a new **builtin** ("общий", first-party) plugin `kuber` that lets an engineer
inspect the Kubernetes clusters **available on their own machine** (per the
kubeconfig(s) on disk): list contexts, switch the active context, browse
namespaces and pods, read pod details/events, tail container logs (with container
selection, follow, tail-N, `--previous`), delete/restart a pod, and see resource
usage (`kubectl top`).

The command **`qaa kuber`** (`~/Projects/qaa-cli/scripts/kuber.py`) is the
inspiration, NOT the transport: it is only a curated-TOML context switcher that
ends in a single `k get pods`. We deliberately do **more** and more generally —
we read the **real** kubeconfig via `kubectl` and add pods/logs/describe/top.

Because kubeconfig, VPN, and cluster creds live on the **engineer's machine**,
this plugin talks to the **local agent** on `127.0.0.1` (the Stagings model),
which shells out to `kubectl` under the engineer's own environment. It does NOT
use the app backend for cluster access. `origin: "builtin"`, `kind: "optional"`,
`requiresAgent: true`.

This upholds the `discuss/06` trust model: П1 — the plugin gets only
local-machine capability, never the app token/backend for cluster work; П2 — it
cannot exceed the engineer's own kube access (kubectl uses their kubeconfig).

Read FIRST:
- `discuss/06` §1 (trust П1/П2), §2 (two channels), §3 (contract).
- `discuss/07` — the four product decisions this brief implements.
- `briefs/12-unified-plugin-contract.md` — the plugin contract this rides on.
- `briefs/05-stagings-namespaces.md` / brief 06 notes — the read + SSE-log +
  confirm-gated-mutation patterns being mirrored.
- Agent template: `agent/app/api/routes.py` (`_build_sse_response`, read GETs,
  SSE log route), `agent/app/services/namespaces.py`
  (`run_plain_text_command`, `stream_namespace_logs`, `terminate_process`,
  `spawn_namespaces_process`, `strip_ansi`, `LOG_READ_POLL_SECONDS`),
  `agent/app/services/staging.py` (`StagingInstallation`,
  `StagingNotInstalledError`, argv building + `shutil.which` resolution),
  `agent/app/services/backend.py` (`build_operation_payload`, `push_operation`),
  `agent/app/services/sse.py` (`encode_sse`), `agent/app/core/constants.py`,
  `agent/app/core/config.py`, `agent/app/api/deps.py` (`AuthContext`,
  `require_auth`).
- Frontend template: `frontend/src/plugins/stagings/manifest.tsx`,
  `StagingsSection.tsx`, `NamespacesPanel.tsx`, `LiveJobPanel.tsx`,
  `useTransientLiveJob.ts`, `liveJobState.ts`, `frontend/src/store/stagingsStore.ts`;
  `frontend/src/api/agentClient.ts` (`readAgentJson`, `streamAgentCommand`,
  path builders), `frontend/src/api/sse.ts`, `frontend/src/api/types.ts`;
  `frontend/src/core/plugins/{definePlugin.ts,types.ts,icons.ts}`;
  `frontend/src/plugins/discovery.ts`, `frontend/src/plugins/discovery.test.ts`;
  `frontend/src/store/uiStoreCore.ts`; `frontend/src/constants.ts`.
- Backend template: `backend/app/core/constants.py` (`PluginId`,
  `OPTIONAL_PLUGIN_IDS`, `OperationType`), `backend/app/api/v1/users.py`
  (`/me/plugins` validation), the operations `Enum(..., native_enum=False)`
  column length.
- `CONVENTIONS.md` — no inline string/number literals; enumerate everything;
  English-only UI.

---

## Decisions (from discuss/07 — implement, do not re-litigate)
1. **Source = real kubeconfig on the machine.** Discover contexts via
   `kubectl config view -o json` (kubectl already merges the `KUBECONFIG` env
   list / `~/.kube/config`). Do NOT port `qaa kuber`'s curated TOML profiles or
   its JWT-`exp`/curl kubeconfig-refresh logic (out of scope; may be a later
   brief).
2. **Switching = per-request `--context=<name>` (non-invasive) + an explicit
   "Set as active" action.** Every read/log/mutation takes an OPTIONAL `context`
   param passed as `--context=<name>`; when omitted, kubectl's current context is
   used. A separate explicit action runs `kubectl config use-context <name>`
   which persists `current-context` to disk (this is the only invasive call and
   is user-initiated).
3. **MVP capabilities:** contexts (list + set-active), namespaces list, pods list
   (structured), pod describe/events (raw), container logs (follow + tail-N +
   `--previous`), delete pod, `kubectl top pods`.
4. **Executor:** the local agent shells out to `kubectl` (list-argv, never a
   shell string). No JobManager (reads are one-shot; logs stream like
   `stream_namespace_logs`; delete is a fast one-shot with best-effort audit).

## Hard scope rules
- **In scope:** a new `kube` service + routes + schemas in the **agent**; agent
  config keys; new frontend builtin plugin folder (2 tabs) + agent-client methods
  + types; frontend/backend constants; backend `PluginId` + `OperationType`
  registration; tests; docs.
- **OUT of scope (do NOT do):** curated-TOML profiles / kubeconfig auto-refresh
  (qaa kuber's URL+curl+JWT-exp logic); any backend proxy to a cluster (all
  cluster I/O goes via the agent); `kubectl exec` / port-forward / apply / edit /
  scale (a later brief); switching between kubeconfig **files** (contexts only for
  MVP); the local-plugin/iframe runtime (discuss/06 role II); changing the plugin
  contract; touching Stagings / qaa-generator / Admin plugins; the JobManager.
- English-only UI, dark theme, Mantine, enumerated constants, `ruff`/`mypy`/
  `eslint`/`tsc` clean.

---

## Part A — Agent constants (`agent/app/core/constants.py`)

- `AgentPath`: add the kube paths (full paths; sub-paths built with f-strings in
  the route decorators exactly like the namespaces routes):
  - `KUBE_CONTEXTS = "/kube/contexts"`
  - `KUBE_USE_CONTEXT = "/kube/contexts/use"`
  - `KUBE_NAMESPACES = "/kube/namespaces"`
  - `KUBE_PODS = "/kube/pods"`
  - `KUBE_TOP = "/kube/top"`
  - `DESCRIBE = "/describe"`, `DELETE = "/delete"` (suffix members; reuse the
    existing `LOGS` suffix for pod logs).
- `EnvKey`: add `KUBECTL_BIN = "AGENT_KUBECTL_BIN"`,
  `KUBECONFIG = "AGENT_KUBECONFIG"`,
  `KUBECTL_REQUEST_TIMEOUT = "AGENT_KUBECTL_REQUEST_TIMEOUT"`.
- `OperationType`: add `KUBE_USE_CONTEXT = "kube_use_context"` and
  `KUBE_DELETE_POD = "kube_delete_pod"` (audit types for the two mutations).
- Add a `KubectlCommand(StrEnum)` (`CONFIG = "config"`, `GET = "get"`,
  `DESCRIBE = "describe"`, `LOGS = "logs"`, `DELETE = "delete"`, `TOP = "top"`,
  `VIEW = "view"`, `USE_CONTEXT = "use-context"`, `PODS = "pods"`,
  `NAMESPACES = "namespaces"`).
- Add a `KubectlFlag(StrEnum)` (`OUTPUT = "-o"`, `CONTEXT = "--context"`,
  `NAMESPACE = "--namespace"`, `CONTAINER = "--container"`, `FOLLOW = "--follow"`,
  `TAIL = "--tail"`, `PREVIOUS = "--previous"`, `REQUEST_TIMEOUT =
  "--request-timeout"`, `NO_HEADERS = "--no-headers"`, `IGNORE_NOT_FOUND =
  "--ignore-not-found"`). Prefer the `--flag=value` form for value flags so a
  value can never be mis-parsed as another flag.
- Add `KubectlOutput(StrEnum)` (`JSON = "json"`), and default constants:
  `DEFAULT_KUBECTL_BIN = "kubectl"`, `DEFAULT_KUBECTL_REQUEST_TIMEOUT = "10s"`,
  `DEFAULT_KUBE_LOG_TAIL = 200`.
- Add `ErrorMessage.KUBECTL_NOT_INSTALLED = "kubectl is not installed."` and
  `ErrorMessage.INVALID_KUBE_NAME = "Invalid Kubernetes resource name."`.

## Part B — Agent config (`agent/app/core/config.py`)

Add to `Settings` (pattern: `Field(default=..., alias=EnvKey.X.value)`):
- `kubectl_bin: str` default `DEFAULT_KUBECTL_BIN`.
- `kubeconfig: str` default `""` (empty ⇒ inherit the agent process's ambient
  `KUBECONFIG` / `~/.kube/config`; when set, exported as `KUBECONFIG` to the
  kubectl subprocess so it points at a specific file).
- `kubectl_request_timeout: str` default `DEFAULT_KUBECTL_REQUEST_TIMEOUT`.
Add all three to `agent/.env.example` with comments.

## Part C — Shared subprocess helpers (small, low-risk extraction)

`run_plain_text_command`, `spawn_namespaces_process`, `terminate_process`,
`strip_ansi`, and `LOG_READ_POLL_SECONDS` currently live in
`services/namespaces.py`. Extract them **verbatim** into a new
`agent/app/services/command.py` and re-import them from `namespaces.py` so
Stagings behaviour is byte-identical (no logic change; the namespaces tests must
stay green). **Add one backward-compatible parameter** to `run_plain_text_command`
and `spawn_namespaces_process`: an optional `env: dict[str, str] | None = None`
that, when provided, is merged over `os.environ` for the subprocess (`env=None`
⇒ inherit as today). Kube commands need this to inject `KUBECONFIG`.

If you prefer to avoid the extraction, importing these helpers from
`services.namespaces` into `services.kube` is acceptable — but the `env`
parameter addition is required either way.

## Part D — Agent kube service (`agent/app/services/kube.py`)

Mirror `services/staging.py` + `services/namespaces.py`. No repo root, no git sha
— cluster commands run with `cwd=None`.

- `class KubectlNotInstalledError(RuntimeError)` (analogue of
  `StagingNotInstalledError`).
- `resolve_kubectl_bin(settings) -> str`: `shutil.which(settings.kubectl_bin)`
  (or the path if absolute+executable); raise `KubectlNotInstalledError(
  ErrorMessage.KUBECTL_NOT_INSTALLED.value)` if missing.
- `build_kube_env(settings) -> dict[str, str] | None`: `{"KUBECONFIG":
  expanduser(settings.kubeconfig)}` when `settings.kubeconfig` is non-empty, else
  `None` (inherit ambient).
- **Name safety.** kubectl argv is a list (no shell) so shell-injection is
  impossible, but guard anyway:
  - `validate_kube_name(value)` for namespace/pod/container: enforce RFC 1123
    (`^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$`, length ≤ 253); raise
    `ValueError(ErrorMessage.INVALID_KUBE_NAME.value)` otherwise.
  - context names are freer (may contain `/`, `@`); just reject empty/whitespace
    and control characters, and ALWAYS pass context via the `--context=<name>`
    (`=`) form so a leading dash can't become a flag.
- argv builders (each returns `list[str]`, kubectl bin first; append
  `--request-timeout=<settings value>` to all NON-streaming read commands; do NOT
  add a request-timeout to `logs --follow`):
  - `build_contexts_argv()` → `kubectl config view -o json`.
  - `build_use_context_argv(context)` → `kubectl config use-context <context>`
    (positional, validated non-empty).
  - `build_namespaces_argv(context?)` → `kubectl get namespaces -o json`.
  - `build_pods_argv(context?, namespace)` → `kubectl get pods -o json`.
  - `build_describe_pod_argv(context?, namespace, pod)` → `kubectl describe pod
    <pod>` (raw text; describe has no JSON).
  - `build_pod_logs_argv(context?, namespace, pod, container?, follow, tail,
    previous)` → `kubectl logs <pod> [--container=<c>] [--follow] [--tail=<n>]
    [--previous]`.
  - `build_delete_pod_argv(context?, namespace, pod)` → `kubectl delete pod
    <pod> --ignore-not-found`.
  - `build_top_argv(context?, namespace)` → `kubectl top pods --no-headers`.
  Every builder appends `--context=<context>` only when a context is given, and
  `--namespace=<namespace>` for the namespaced ones.
- read helpers (one-shot, use `run_plain_text_command(argv, None,
  env=build_kube_env(settings))`):
  - `list_contexts(settings)` → run `build_contexts_argv`, `json.loads` the raw,
    map `contexts[]` → `KubeContextRow(name, cluster, user, namespace)` from each
    `contexts[i].context`, and `current-context` → mark `current`. Return
    `(PlainTextCommandResult, list[KubeContextRow], current_context)`.
  - `use_context(settings, context)` → run `build_use_context_argv`, return the
    `PlainTextCommandResult`.
  - `list_namespaces_kube(settings, context)` → run + `json.loads` →
    `KubeNamespaceRow(name=items[i].metadata.name,
    phase=items[i].status.phase)`.
  - `list_pods(settings, context, namespace)` → run + `json.loads` → for each
    item build `KubePodRow`: `name` (metadata.name), `phase` (status.phase),
    `containers` = `[c.name for c in spec.containers]`, `ready_count`/`total` and
    `restarts` computed from `status.containerStatuses` (`ready` bool,
    `restartCount`), `node` (spec.nodeName), `created_at`
    (metadata.creationTimestamp). Be defensive: missing keys ⇒ sane defaults
    (a Pending pod may have no `containerStatuses`).
  - `describe_pod(settings, context, namespace, pod)` → raw text result.
  - `top_pods(settings, context, namespace)` → raw text result (metrics-server
    may be absent → non-zero exit; surface `raw` + `exit_code`, do NOT raise).
- log streaming: `stream_pod_logs(settings, context, namespace, pod, container,
  follow, tail, previous, *, is_disconnected)` → clone `stream_namespace_logs`
  exactly (poll-read loop, `encode_sse(SseEvent.LOG, JobLogEvent(...))`,
  `is_disconnected()` abort, `terminate_process` teardown, terminal
  `SseEvent.TERMINAL` with SUCCESS/FAILED by exit code). Use
  `spawn_namespaces_process(argv, None, env=build_kube_env(settings))`.
- mutation audit helper: `push_kube_operation(client, token, *, op_type, ns,
  recipe, result)` — a thin wrapper over `build_operation_payload` +
  `push_operation` (see `services/backend.py`) that records the mutation
  (RUNNING→terminal collapsed into one upsert is fine: pass
  `status=SUCCESS if exit_code == 0 else FAILED`, `started_at`/`finished_at`
  = now, `log=result.raw`, `exit_code=result.exit_code`, `stagings_sha=None`).
  Best-effort — swallow push errors like the existing code does.

## Part E — Agent schemas (`agent/app/schemas/__init__.py` or a new module,
matching the existing layout)

Pydantic response models (camelCase via the existing alias generator the other
schemas use — match `NamespaceListResponse` style exactly):
- `KubeContext { name, cluster, user, namespace: str | None, current: bool }`
- `KubeContextsResponse { contexts: list[KubeContext], currentContext: str | None,
  exitCode: int }`
- `KubeNamespace { name, phase: str | None }`
- `KubeNamespacesResponse { namespaces: list[KubeNamespace], exitCode }`
- `KubePod { name, phase, ready: str (e.g. "1/1"), restarts: int,
  containers: list[str], node: str | None, createdAt: str | None }`
- `KubePodsResponse { pods: list[KubePod], exitCode }`
- `KubePodDescribeResponse { name, raw: str, exitCode }`
- `KubeTopResponse { raw: str, exitCode }`
- `KubeCommandResult { raw: str, exitCode }` (for use-context + delete)
- request bodies: `KubeUseContextRequest { context: str }`,
  `KubeDeletePodRequest { context: str | None, namespace: str }`.

## Part F — Agent routes (`agent/app/api/routes.py`)

Add routes alongside the existing ones. All require `AuthDep` (except none are
public). Wrap `KubectlNotInstalledError` → `503` and `ValueError` (bad name) →
`400`, mirroring the existing `StagingNotInstalledError` handling. `context` is an
optional `Query(None)`; namespaced routes take `namespace: str = Query(...)`.

- `GET  KUBE_CONTEXTS` → `KubeContextsResponse`.
- `POST KUBE_USE_CONTEXT` (body `KubeUseContextRequest`) → `KubeCommandResult`;
  after running, best-effort `push_kube_operation(op_type=KUBE_USE_CONTEXT,
  ns=None, recipe={"context": ...})`.
- `GET  KUBE_NAMESPACES` (`context?`) → `KubeNamespacesResponse`.
- `GET  KUBE_PODS` (`context?`, `namespace`) → `KubePodsResponse`.
- `GET  f"{KUBE_PODS}/{{pod}}{DESCRIBE}"` (`context?`, `namespace`) →
  `KubePodDescribeResponse`.
- `GET  f"{KUBE_PODS}/{{pod}}{LOGS}"` (`context?`, `namespace`, `container?`,
  `follow: bool = Query(True)`, `tail: int = Query(DEFAULT_KUBE_LOG_TAIL)`,
  `previous: bool = Query(False)`) → `StreamingResponse` via `_build_sse_response(
  stream_pod_logs(...))` passing `is_disconnected=request.is_disconnected`.
- `POST f"{KUBE_PODS}/{{pod}}{DELETE}"` (body `KubeDeletePodRequest`) →
  `KubeCommandResult`; best-effort `push_kube_operation(op_type=KUBE_DELETE_POD,
  ns=namespace, recipe={"pod": ..., "context": ...})`.
- `GET  KUBE_TOP` (`context?`, `namespace`) → `KubeTopResponse`.

## Part G — Backend registration (`backend/app/core/constants.py`)

- `PluginId`: add `KUBER = "kuber"`.
- `OPTIONAL_PLUGIN_IDS`: append `PluginId.KUBER` (so `PUT /me/plugins` validates
  and persists it; the Administration → Plugins toggle picks it up automatically).
- `OperationType`: add `KUBE_USE_CONTEXT = "kube_use_context"` and
  `KUBE_DELETE_POD = "kube_delete_pod"`. The `operations.type` column is
  `Enum(..., native_enum=False)` (stored as VARCHAR) → **verify the column length
  accommodates the new values** (both are ≤ 20 chars; `kube_use_context` = 16).
  If a fixed `String(length=...)` is too small, add a widening Alembic migration
  (see the `20260811_0003` VARCHAR-length migration for the pattern); otherwise
  no migration is needed. No backend route is added — kuber never proxies a
  cluster; audit records arrive via the agent's existing `POST /operations`.

## Part H — Frontend constants (`frontend/src/constants.ts`)

Append to existing groups (const-object + type-alias style; every exhaustive
`Record` map gets its new entries or `tsc` fails):
- `PluginId`: `KUBER: "kuber"`.
- `IconName`: add e.g. `CLUSTER: "cluster"` and register it in
  `core/plugins/icons.ts` `ICON_REGISTRY` (a Tabler icon, e.g. `IconServer` /
  `IconCloud` — pick one that reads as "clusters/infra"; the `Record<IconName,
  TablerIcon>` is exhaustive, so TS forces this).
- `ViewKey`: `KUBE_CLUSTERS`, `KUBE_PODS`.
- `TabId`: `KUBE_CLUSTERS: "tab-kube-clusters"`, `KUBE_PODS: "tab-kube-pods"`.
- `TabTitle` (`Record<TabId, string>`): `"Clusters"`, `"Pods"`.
- `AgentPath`: mirror the agent additions — `KUBE_CONTEXTS`, `KUBE_USE_CONTEXT`,
  `KUBE_NAMESPACES`, `KUBE_PODS`, `KUBE_TOP` (+ the `DESCRIBE`, `DELETE`, and the
  existing `LOGS` suffixes reused by builders).
- Path builders near the agent group (mirror `buildAgentNamespaceLogsPath` which
  uses `URLSearchParams`):
  - `buildAgentKubeNamespacesPath(context?)`,
  - `buildAgentKubePodsPath(context, namespace)`,
  - `buildAgentKubePodDescribePath(pod, context, namespace)`,
  - `buildAgentKubePodLogsPath(pod, params)` (context/namespace/container/follow/
    tail/previous),
  - `buildAgentKubePodDeletePath(pod)`,
  - `buildAgentKubeTopPath(context, namespace)`.
  Encode all names/params via `URLSearchParams` (never string-concat user values).
- `QueryKey`: `KUBE_CONTEXTS`, `KUBE_NAMESPACES`, `KUBE_PODS`, `KUBE_POD_DESCRIBE`,
  `KUBE_TOP`.
- `OperationType` (frontend mirror) + any exhaustive label/color `Record` maps:
  add `KUBE_USE_CONTEXT`, `KUBE_DELETE_POD` (+ human labels "Set context",
  "Delete pod" if a `Record<OperationType,...>` exists).
- `DEFAULT_KUBE_LOG_TAIL = 200` (mirror the agent default).

## Part I — Frontend agent client + types

`frontend/src/api/types.ts`: add `KubeContext`, `KubeContextsResponse`,
`KubeNamespace`, `KubeNamespacesResponse`, `KubePod`, `KubePodsResponse`,
`KubePodDescribe`, `KubeTopResponse`, `KubeCommandResult`, and request types
`KubeUseContextRequest`, `KubeDeletePodRequest` (match the agent camelCase wire
shapes).

`frontend/src/api/agentClient.ts`: add methods using the existing `readAgentJson`
(JSON) and `streamAgentCommand` (SSE) helpers + the new path builders:
- `getKubeContexts(port, token, signal)`,
- `useKubeContext(port, token, context, signal)` (POST, `createJsonBody`),
- `listKubeNamespaces(port, token, context?, signal)`,
- `listKubePods(port, token, context, namespace, signal)`,
- `describeKubePod(port, token, pod, context, namespace, signal)`,
- `deleteKubePod(port, token, pod, payload, signal)` (POST),
- `getKubeTop(port, token, context, namespace, signal)`,
- `streamKubePodLogs(port, token, pod, params, onMessage, signal)` — reuse
  `streamAgentCommand` (fetch-stream + Bearer + `parseSseStream`; **not**
  `EventSource`), exactly like `streamNamespaceLogs`.

## Part J — Frontend plugin folder `frontend/src/plugins/kuber/`

Discovery is glob-based — the folder is auto-registered once `manifest.tsx`
exports a valid `definePlugin(...)`.

- `manifest.tsx`: `definePlugin({ id: PluginId.KUBER, icon: IconName.CLUSTER,
  kind: PluginKind.OPTIONAL, origin: PluginOrigin.BUILTIN, contractVersion:
  CONTRACT_VERSION, label: "Kuber", order: 15 (infra group: stagings 10, kuber
  15, qaa-generator 20, admin 30), route: "/kuber", requiresAgent: true, tabs:
  [Clusters, Pods] })` — two element-tabs rendering `<KuberSection
  mode={ViewKey.X} />`.
- `KuberSection.tsx`: mode dispatcher (`ViewKey.KUBE_PODS → <PodsPanel/>`,
  default `<ClustersPanel/>`), plus the agent-availability guard used by
  `StagingsSection` (graceful "companion app not running" via `discoverAgent`).
- `kuberStore.ts` (mirror `stagingsStore.ts`, Zustand): `selectedContext: string
  | null`, `selectedNamespace: string | null`, setters; persist
  `selectedContext` to `localStorage` (add a `StorageKey.KUBE` entry). Shared by
  both tabs.
- `ClustersPanel.tsx`: `useQuery` (`getKubeContexts`) → a `<Table>` of contexts
  (name/cluster/user/namespace, a "current" `Badge` on the active row); clicking
  a row sets `selectedContext` (does NOT persist to disk); a **"Set as active"**
  button per row runs `useKubeContext` (confirm not required — low risk), then
  invalidates the contexts query. Show a clear empty state when kubectl is
  missing (503) or no contexts exist.
- `PodsPanel.tsx` (template: `NamespacesPanel.tsx`): a context `<Select>`
  (options from contexts query, default = `selectedContext` or current) + a
  namespace `<Select>` (`listKubeNamespaces` for the chosen context) + a pods
  `<Table>` (`listKubePods`, `refetchInterval` ~5s while the tab is active).
  Columns: name, ready, phase (colored `Badge`), restarts, node, age.
  A `Refresh` button. Row click opens a `<Drawer>` with the pod detail:
  - **Logs**: a container `<Select>` (from `pod.containers`), `follow` switch,
    `tail` number input (default `DEFAULT_KUBE_LOG_TAIL`), `previous` switch, and
    a live scrolling monospace log via `streamKubePodLogs` — reuse the transient
    live-stream hook shape from `useTransientLiveJob.ts`/`liveJobState.ts`
    (AbortController on unmount / param change / tab switch).
  - **Describe**: a "Describe" action → `describeKubePod` → raw monospace text
    (contains the Events section).
  - **Top**: a "Resource usage" action → `getKubeTop` → raw text (note in the UI
    that it needs metrics-server; a non-zero exit shows the raw stderr).
  - **Delete pod**: a destructive button behind a **type-to-confirm gate** (copy
    the destroy confirm UX from the Stagings Namespaces drawer) → `deleteKubePod`
    → on success invalidate the pods query.

## Part K — Store bootstrap + discovery test

- `frontend/src/store/uiStoreCore.ts` `createBootstrapTabsByPlugin()`: add a
  `[PluginId.KUBER]` entry (`activeTabId`/`tabIds` = `TabId.KUBE_CLUSTERS`) so
  `tabsByPlugin[PluginId.KUBER]` is defined pre-hydration.
- `frontend/src/plugins/discovery.test.ts`: update the expected ordered
  `PLUGINS.map(p => p.id)` to `[STAGINGS, KUBER, QAA_GENERATOR, ADMIN]` (orders
  10/15/20/30).

## Part L — Tests

Agent (`agent/tests/test_kube.py`): a fake `kubectl` binary (same technique as
the fake `staging` bin in the existing agent tests; point `AGENT_KUBECTL_BIN` at
it) that emits canned JSON/text per argv. Cover: contexts parse (current marker);
namespaces parse; pods parse (ready/restarts/containers, incl. a Pending pod with
no `containerStatuses`); describe raw passthrough + exitCode; top non-zero exit
surfaces raw (no raise); use-context + delete return `KubeCommandResult` and push
a best-effort operation (assert the payload via a `MockTransport` backend, like
the deploy tests); logs SSE emits `log` frames then a `terminal` frame; kubectl
missing → 503; invalid namespace/pod name → 400; auth required (401 without
Bearer). Ensure the extracted `services/command.py` keeps the namespaces tests
green.

Frontend: `agentClient.test.ts` (stub `fetch`; assert URL/method/body/Bearer for
each new method + a `streamKubePodLogs` test feeding a `ReadableStream`);
`ClustersPanel.test.tsx` (render contexts, set-active calls the client);
`PodsPanel.test.tsx` (context/namespace select drives the pods query; delete
behind the confirm gate); update `discovery.test.ts`. Reuse
`renderWithProviders` from `src/test/render.tsx`.

## Part M — Docs

- `frontend/README.md`: add the Kuber plugin (two tabs; talks to the local agent
  only; needs `kubectl` on the engineer's PATH).
- `agent/README.md` / `agent/.env.example`: document `AGENT_KUBECTL_BIN`,
  `AGENT_KUBECONFIG`, `AGENT_KUBECTL_REQUEST_TIMEOUT`, and the `/kube/*` routes.

---

## Gates (all must pass)
- Agent: `cd agent && ruff check . && ruff format --check . && mypy app && pytest`
- Frontend: `cd frontend && npm run lint && npx tsc --noEmit && npm run test && npm run build`
- Backend: `cd backend && ruff check . && ruff format --check . && mypy app && pytest`

## Acceptance criteria
1. New builtin plugin `kuber` (order 15, optional, `requiresAgent:true`)
   auto-discovered; sidebar shows it with the new icon; tabs Clusters/Pods render;
   with no agent it degrades gracefully ("companion app not running").
2. Clusters tab lists the real contexts from the machine's kubeconfig with the
   current one marked; "Set as active" runs `kubectl config use-context` and the
   marker updates.
3. Pods tab: choosing a context + namespace lists pods with ready/phase/restarts/
   node/age; a per-request `--context=` is used (reads never mutate global state).
4. Pod drawer streams container logs (container select + follow + tail-N +
   `--previous`) via agent SSE (fetch-stream + Bearer, not EventSource); Describe
   and `top` show raw output; Delete works behind a type-to-confirm gate.
5. Cluster access flows ONLY through the local agent under the engineer's own
   kubeconfig; no app token/backend is used for kube I/O; the two mutations are
   recorded best-effort in `operations` (`kube_use_context`/`kube_delete_pod`,
   `user_id` = current user).
6. Stagings/qaa-generator/Admin plugins and the JobManager are unchanged; the
   plugin contract is unchanged; all three gate suites are green; docs updated.

## Open questions (surface, don't silently decide)
- **operations History pollution:** kuber mutations land in the global
  `operations` table, which the Stagings History tab currently lists. Decide
  whether to filter Stagings History to stagings-only types (small follow-up) or
  accept mixed rows for now. MVP: accept mixed, note it.
- **Unreachable cluster UX:** a read against a context whose token expired hangs
  until `--request-timeout`; confirm 10s is a good default and that the UI shows
  the timeout error clearly (this is where qaa kuber's refresh logic would later
  help — a future brief could re-introduce curated-profile refresh).
- **Namespace discovery when RBAC forbids `list namespaces`:** fall back to a
  free-text namespace input if `get namespaces` returns 403.

When done, ensure all three gate suites pass, then stop. Do not commit — the
reviewer inspects `git diff` and commits.
