# QAA-TMS Agent

Headless local HTTP service for staging operations. This is the dev-mode form of
the future companion app: the browser talks to `127.0.0.1`, the agent runs the
real `staging` CLI with the engineer's local VPN, kubeconfig, and Docker creds,
and the agent best-effort pushes audit records to the central backend.

## Run

From `agent/`:

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

## Environment

All config uses the `AGENT_` prefix:

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
- `GET /preflight`
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
registry, and does not create backend audit records.

The `kube/*` routes shell out to the engineer's local `kubectl` binary and use
their real kubeconfig access. Reads are one-shot commands, pod logs stream over
the shared SSE frame format, and the two mutations (`use-context`, `delete pod`)
push best-effort audit rows to the backend operations journal.

Not implemented here:

- `/setup`
- grafana endpoints

## Companion App Scope

This package is only the headless service. The Tauri/Electron shell that will
embed the same agent code is a later slice.
