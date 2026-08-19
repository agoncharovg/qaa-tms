# QAA-TMS Frontend

The SPA shell is now a static plugin host. Sidebar items, plugin routes, tab catalogs,
and workspace views are derived from plugin metadata instead of hardcoded section enums.

## Local run

Install dependencies and start the Vite dev server:

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 3000
```

The SPA serves on `http://localhost:3000` and expects the backend on
`http://localhost:8000` by default.

## Plugin model

Two plugin classes exist in this slice:

- `system`: first-party shell plugins. `Profile` is visible to every authenticated user; `Administration` is visible to admins only. System plugins are never toggleable.
- `optional`: visible only when the current user enables it for themselves. `Stagings`, `Kuber`, `QAA Generator`, and `Jenkins` ship as optional builtin plugins in this build.

Static metadata lives in `src/plugins/catalog.ts`. React view wiring lives in
`src/plugins/*/manifest.tsx`, discovered statically at build time through Vite
`import.meta.glob("./*/manifest.tsx", { eager: true })`. Each manifest is authored
through `definePlugin(...)` and exports a self-contained `PluginManifest` with:

- `origin`: currently always `PluginOrigin.BUILTIN` for shipped plugins. `PluginOrigin.LOCAL`
  is reserved for the next slice and is intentionally not rendered in this build.
- `contractVersion`: the host/plugin contract version the manifest targets. The
  current host version is `CONTRACT_VERSION`.
- `icon`: an `IconName` string resolved by the shell through its icon registry.
- `tabs`: each tab must declare exactly one render path:
  `element` for the builtin fast-path, or `mount(ctx)` for the in-process host API path.

`src/plugins/catalog.ts` derives selectors from the discovered manifest list, and
`src/plugins/registry.ts` provides the builtin `viewRegistry` used by the workspace.

The shared contract surface for plugin rendering is:

- `definePlugin(...)`: validates manifest shape, contract version support, and
  per-plugin tab uniqueness.
- `MountContext`: `{ container, viewKey, host, agentBaseUrl? }`
- `HostApi`: chrome-only host access for theme tokens, view metadata, and optional
  tab navigation.

`HostApi` intentionally does not expose the app auth token, backend client, or any
other credentials. Builtin plugins may still use first-party application modules
directly because they ship in the same bundle, but that is outside the portable contract.

To add a plugin:

1. Add the plugin id and tab/view enums to `src/constants.ts` if the plugin introduces new stable identifiers.
2. Create `src/plugins/<plugin-id>/manifest.tsx` that `export default`s `definePlugin({...})`.
3. Set the manifest `order`, `origin`, `contractVersion`, and `icon`, reuse the existing enum values (`PluginId`, `TabId`, `ViewKey`, `TabTitle`), and place the actual screen code under `src/plugins/<plugin-id>/`.

There is no central plugin registry to edit anymore. Dropping a folder with a valid
`manifest.tsx` under `src/plugins/<plugin-id>/` is enough for the frontend build to
pick it up. Discovery stays fully static: no runtime filesystem scan, no remote module
loading, and no extra chunks for plugin manifests. Optional plugins still need the
backend to carry its own `PluginId` entry and optional/system classification.

Only builtin, bundle-time plugins are wired today. Runtime-loaded or local plugins,
their transport, and their discovery source are explicitly out of scope for this slice.

The shell keeps `TabId` and `ViewKey` stable, so localStorage tab persistence stays
compatible while each manifest becomes the source of truth.

## Profile workflow

The bottom sidebar account entry opens the `Profile` system plugin plus a logout action with confirmation.

- `Account` tab: self-service update screen for the signed-in user's `display_name`, password, and server-side `auto_login` flag.
- `Plugins` tab: self-service enable/disable screen for optional plugins. Toggling calls
  `PUT /api/v1/me/plugins`, updates the Zustand auth state immediately, and the sidebar
  reacts without a reload.
- `Settings` tab: one editing surface for operational settings, split by the surface that
  actually consumes each value instead of pretending one physical `.env` file exists:
  browser overrides go to localStorage, companion settings go to the local agent `.env`,
  and admin-only server settings go to the backend `.env`.

`Settings -> Application` writes runtime overrides for `VITE_API_BASE_URL` and
`VITE_AGENT_PORTS` into localStorage. They are read at module load, so the UI asks for a
reload after saving. `Settings -> Local companion` talks directly to the agent on
`127.0.0.1`. `Settings -> Server` is visible to admins only and updates the backend-side
qaa-generator operational config; changing the base URL there still requires a backend
restart because the outbound client is created at startup.

## Administration workflow

`Administration` is now admin-only.

- `Users` tab: admin-only user management surface backed by `/api/v1/users`.

## Stagings workflow

The `Stagings` optional plugin exposes six tabs:

- `Preflight`: probe the local companion app and inspect the staging prerequisite checklist.
- `Deploy`: submit a deploy recipe to the local agent, stream the live job log over authenticated fetch-SSE, and cancel a running job.
- `History`: browse recorded backend operations, inspect the stored recipe and full log, and replay deploy operations by prefilling the Deploy tab.
- `Namespaces`: render cluster namespaces and local overlays as separate groups, inspect namespace status, load masked credentials on demand, tail live deployment logs, and start namespace-scoped `adopt` / `destroy` jobs from the detail drawer.
- `Sync`: submit the global `staging sync` flags form and watch the shared live job log panel used by deploy, destroy, adopt, and sync.
- `E2E`: choose a product, load its named suite registry from the agent, select suites, submit `{ ns, product, suites[], threads? }`, and watch the shared live job log panel for the `staging e2e-run` job.

Every Stagings tab also shares a persistent kubeconfig banner from the section
shell. It detects whether the staging kubeconfig is missing, stale, token-expired,
invalid, or merely not the active kubeconfig, and it exposes `Refresh only`,
`Refresh & activate`, and `Activate` actions through the local companion app.
Refreshing the kubeconfig requires Full VPN because the agent downloads it from
the staging kubeconfig URL under the engineer's local environment.

The Deploy, Sync, Namespaces, and E2E workflows depend on the local companion app being
reachable on a probed localhost port, because authenticated agent requests reuse the same
Bearer token as the central backend.

## QAA Generator workflow

The `QAA Generator` optional plugin now uses the local companion for all non-admin flows.

- `Generate`: submit `{ jira_key, dry_run, skip_pr, skip_exec, branch?, profile }` to the local companion.
- `Live`: stream one run over authenticated fetch-SSE, inspect its live events, and issue `pause` / `resume` / `stop` through the companion.
- `Runs`: filter the shared run list with cursor pagination, inspect a run and its artifacts inline, and open any run into the Live tab.
- `Admin`: admin-only tab, always kept last in the plugin tab order, for QAA generator user lookup/create, user-token regeneration, and service registration / revoke.

Generate, Live, and Runs require the user's personal QAA generator token in the local companion `.env` (`AGENT_QAA_GENERATOR_TOKEN`). The backend never stores that token in the TMS database. Admin calls use the backend-held `QAA_GENERATOR_SUPERUSER_TOKEN` only.

Plaintext QAA generator user and service tokens returned by the admin workflows are shown exactly once in a copy modal. They are not persisted in local storage, Zustand, or React Query list caches, and they are not written to the backend operations audit.

## Kuber workflow

The `Kuber` optional plugin talks only to the local companion app and never to the
central backend for cluster I/O.

- `Clusters`: list the real contexts merged by local `kubectl config view -o json`,
  highlight the current context, and optionally persist a new active context with
  `kubectl config use-context`.
- `Pods`: choose a context and namespace, browse structured pod rows, open a pod
  drawer, stream container logs over authenticated fetch-SSE, load raw `describe`
  output, inspect raw `kubectl top pods` output, and delete a pod behind a type-to-confirm gate.

The plugin requires `kubectl` to be available on the engineer's machine. The
companion app may optionally override the kubectl path or kubeconfig via its
`AGENT_KUBECTL_BIN` and `AGENT_KUBECONFIG` settings.

## Jenkins workflow

The `Jenkins` optional plugin talks only to the local companion app and never to the
central backend for Jenkins I/O. The agent uses the engineer's own Jenkins username
and personal API token from its local environment, so the browser never receives a shared
server credential and each engineer sees only what their own Jenkins account can access.

- `Tree`: fetch the live `.QAA/E2E` subtree once from the agent, render the configured
  roots (default `PREPROD`, `PROD`) as a collapsible status tree, lazy-load recent builds per pipeline,
  and open the real Jenkins pipeline page or `{buildUrl}allure/` in a browser tab on double-click.
- `Pinned`: persist pinned Jenkins folders in local storage and render recursive status-count
  widgets over all descendant pipelines, including nested folders.

The MVP is intentionally scoped to `.QAA/E2E` only. The companion app must be configured
with `AGENT_JENKINS_URL`, `AGENT_JENKINS_USERNAME`, and `AGENT_JENKINS_TOKEN`, and the
engineer still needs VPN access to reach Jenkins from their own machine.

## Docker Compose

From the repository root:

```bash
docker compose up --build frontend backend db
```

That starts Postgres, the FastAPI backend, and the Vite frontend together for local development.

## Environment variables

- `VITE_API_BASE_URL`: build-time default base URL for the FastAPI backend. Runtime override available at `Profile -> Settings -> Application`. Default: `http://localhost:8000`
- `VITE_AGENT_PORTS`: build-time default local companion-app probe range. Runtime override available at `Profile -> Settings -> Application`. Default: `47600-47605`
