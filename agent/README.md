# QAA-TMS Agent

Headless local HTTP service for staging and Jenkins companion workflows. The
browser talks to `127.0.0.1`, the agent runs the real `staging` CLI with the
engineer's local VPN, kubeconfig, and Docker creds, makes authenticated
read-only Jenkins API calls with the engineer's own personal token, and the
agent best-effort pushes audit records to the central backend.

The companion is delivered as source code from the deployed backend. Engineers
download the source tarball, run `install.sh`, and the script creates an
autostarting user service (systemd on Linux, launchd on macOS). Every service
start runs `update.sh --if-newer` before launching the agent, and the browser
can also trigger `POST /update` for an immediate in-place refresh.

## Run

From `agent/` in a source checkout:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --host 127.0.0.1 --port 47600
```

You can also run:

```bash
python -m app.main
```

The service binds `127.0.0.1` only. The SPA probes `http://127.0.0.1:47600`
through `47605` and identifies the agent via `GET /ping`.

For the deployed installation flow, extract the downloaded tarball and run:

```bash
./install.sh --backend-url https://your-qaa-tms.example
```

The installer records one-time consent, bootstraps `.venv`, writes
`AGENT_CORS_ORIGINS` and `AGENT_BACKEND_URL` into `.env`, installs the
autostart service, and starts it immediately.

## Environment

All config uses the `AGENT_` prefix:

`Profile -> Settings` is the single editing surface in the SPA for operational config, but
the values still persist to the real consumer surfaces. Browser overrides stay in
localStorage, the companion settings below stay in the agent `.env`, and bootstrap-only
settings such as `AGENT_HOST`, `AGENT_PORT`, `AGENT_CORS_ORIGINS`, and
`AGENT_BACKEND_URL` remain outside the UI.

- `AGENT_HOST`
  Must stay `127.0.0.1`. Any other value is rejected.
- `AGENT_PORT`
  Local bind port. Default: `47600`.
- `AGENT_CORS_ORIGINS`
  Comma-separated allowlist for the TMS SPA. Default:
  `http://localhost:3000,http://127.0.0.1:3000`.
- `AGENT_BACKEND_URL`
  Central backend base URL used for `/api/v1/me` token validation and
  `/api/v1/operations` audit upserts. Default: `http://localhost:8000`.
- `AGENT_JENKINS_URL`
  Base Jenkins URL used by the Jenkins explorer plugin. Default: `https://jenkins.p.gc.onl`.
- `AGENT_JENKINS_USERNAME`
  The engineer's personal Jenkins username used only by the local companion app.
- `AGENT_JENKINS_TOKEN`
  The engineer's personal Jenkins API token used only by the local companion app. Jenkins access
  still depends on the engineer's own VPN session and Jenkins permissions.
- `AGENT_JENKINS_ROOT_GROUPS`
  Comma-separated `LABEL=job/path` list of grouped Jenkins source roots. Default:
  `BE=job/.QAA/job/E2E,FE=job/.QAA/job/UI_E2E`.
- `AGENT_JENKINS_ROOT_FOLDERS`
  Editable allow-list of shared env folders under every configured root group. Default:
  `PREPROD,PROD`. More roots can be added later without code changes; a UI editor is future work.
- `AGENT_JENKINS_REQUEST_TIMEOUT`
  Timeout for Jenkins API reads. Default: `15`.
- `AGENT_JENKINS_TREE_DEPTH`
  Recursive Jenkins jobs depth used for the single tree fetch. Default: `5`.
- `AGENT_JENKINS_STUCK_MIN_IDLE_HOURS`
  Idle-age threshold for the Jenkins `STUCK` heuristic. Default: `6`.
- `AGENT_STAGING_BIN`
  Optional explicit path to the `staging` executable. If unset, the agent uses
  `which staging`.
- `AGENT_STAGINGS_REPO`
  Optional explicit repo-root override. If unset, the agent derives the repo
  root from the resolved `staging` binary path.
- `STAGING_KUBECONFIG`
  Staging kubeconfig path inspected by preflight and the Stagings kubeconfig
  banner. Default: `~/.kube/ai-staging.yaml`.
- `AGENT_STAGING_KUBECONFIG_URL`
  Download URL used by `POST /staging/kubeconfig/refresh`. Default:
  `https://kubeconf.frn-stg.p.gc.onl/config`. It relies on ambient Full VPN access.
- `AGENT_KUBECONFIG_ACTIVE_PATH`
  Managed active kubeconfig symlink path. Default: `~/.kube/config`. If your
  normal `~/.kube/config` is a real merged file, point this setting at the same
  managed symlink path used by `qaa kuber`, for example `~/.kube/kubecfg.yaml`.
  The agent refuses to overwrite a regular file at this path.
- `AGENT_STAGING_KUBECONFIG_MAX_AGE_HOURS`
  Maximum accepted age for the staging kubeconfig before it is considered stale.
  Default: `48`.
- `AGENT_KUBECTL_BIN`
  Optional explicit path to the `kubectl` executable. Default: `kubectl`.
- `AGENT_KUBECONFIG`
  Optional explicit kubeconfig override exported only to `kubectl` subprocesses.
  If unset, the agent uses `AGENT_KUBECONFIG_ACTIVE_PATH` as the primary source
  and appends any inherited shell `KUBECONFIG` entries for merged context
  discovery.
- `AGENT_KUBECTL_REQUEST_TIMEOUT`
  Timeout added to non-streaming `kubectl` read commands. Default: `10s`.

See [.env.example](/home/andreigoncharov/Projects/qaa-tms/agent/.env.example).

## Real vs Injected `staging`

Production and normal local use run the real `staging` binary. Tests inject a
fake executable via `AGENT_STAGING_BIN` and point `AGENT_STAGINGS_REPO` at a
temporary git repo. The app code never fakes staging job behavior internally;
the binary seam exists only so tests can exercise the full job and SSE lifecycle.

## API Surface

Implemented in this slice:

- `GET /ping`
- `POST /update`
- `GET /settings`
- `PUT /settings`
- `GET /preflight`
- `GET /jenkins/tree`
- `GET /jenkins/builds?path=...`
- `GET /staging/kubeconfig/status`
- `POST /staging/kubeconfig/refresh`
- `POST /staging/kubeconfig/activate`
- `GET /namespaces`
- `GET /namespaces/{ns}/status`
- `GET /namespaces/{ns}/creds`
- `GET /namespaces/{ns}/logs?deploy=...`
- `GET /kube/contexts`
- `POST /kube/contexts/use`
- `GET /kube/namespaces?context=...`
- `GET /kube/pods?context=...&namespace=...`
- `GET /kube/pods/{pod}/describe?context=...&namespace=...`
- `GET /kube/pods/{pod}/logs?context=...&namespace=...&container=...&follow=...&tail=...&previous=...`
- `POST /kube/pods/{pod}/delete`
- `GET /kube/top?context=...&namespace=...`
- `POST /deploy`
- `POST /destroy`
- `POST /adopt`
- `POST /sync`
- `GET /e2e/suites?product=...`
- `POST /e2e-run`
- `GET /jobs/{id}`
- `GET /jobs/{id}/stream`
- `POST /jobs/{id}/cancel`

`GET /namespaces` now returns the raw `staging list` output plus a structured
split between `clusterNamespaces` and `localOverlays`, so local-only overlay
directories are not conflated with provisioned cluster namespaces.

The namespace read endpoints remain read-only wrappers around the local
`staging` CLI. They are not jobs, do not create `jobId` or `opId` values, and
do not write to the backend operations journal. The `creds` response is
sensitive and is meant only for the authenticated localhost browser flow.

The Stagings kubeconfig routes are pure local-agent helpers. `status` checks the
staging file for existence, content validity, JWT expiry, staleness, and active
path selection without calling the cluster. `refresh` downloads a fresh staging
kubeconfig, validates it before replacing the local file, and can activate it in
the same request. `activate` atomically re-points the managed active-kubeconfig
symlink at the staging file and refuses to overwrite a regular file.

`POST /deploy`, `POST /destroy`, `POST /adopt`, `POST /sync`, and `POST /e2e-run` are all
job-creating endpoints. They share the same job lifecycle: create `{ jobId, opId }`,
stream live output over `GET /jobs/{id}/stream`, support `POST /jobs/{id}/cancel`,
and push operation records to the backend journal. For `e2e-run`, cancel stops the
local watcher process only; the already-triggered remote Jenkins build keeps running.

`GET /e2e/suites?product=...` is a Bearer-guarded read endpoint that shells out to
`staging e2e-run <placeholder> --product <P> --list-suites`, parses the named suite
registry, and does not create backend audit records. `POST /e2e-run` also accepts the
optional raw runner flags mirrored from `qaa-stagings/scripts/e2e_run.py`: `image`
(`--image`), `mark` (pytest `-k`, sent as `--mark`), and `marks` (pytest `-m`, sent
as `--marks`), in addition to the existing named suites and threads fields.

The Jenkins routes are read-only local-agent helpers for the builtin `jenkins` plugin.
`GET /jenkins/tree` fetches the configured `.QAA/E2E` subtree in one recursive Jenkins
API call, derives shared pipeline statuses on the agent, and never proxies through
the central backend. `GET /jenkins/builds?path=...` lazily fetches recent builds for
a validated in-scope pipeline path and returns direct Jenkins URLs plus `{buildUrl}allure/`.

The `kube/*` routes shell out to the engineer's local `kubectl` binary and use
their real kubeconfig access. Reads are one-shot commands, pod logs stream over
the shared SSE frame format, and the two mutations (`use-context`, `delete pod`)
push best-effort audit rows to the backend operations journal.

Not implemented here:

- `/setup`
- grafana endpoints

`POST /update` returns `202 Accepted`, spawns the detached `update.sh` helper,
downloads the latest source tarball from the backend, verifies the manifest
sha256, updates the local install while preserving `.env`, and lets the service
manager restart the process.
