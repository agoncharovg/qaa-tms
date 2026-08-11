# QAA-TMS Backend

The backend is a FastAPI service with async SQLAlchemy, Alembic migrations, JWT stub auth,
an audit log for agent operations, a qaa-generator proxy for central test-generation runs,
and per-user plugin enablement for the frontend shell.

`POST /api/v1/operations` supports create-or-update semantics. If the client sends an `id`,
the backend upserts that operation for the authenticated user. If `id` is omitted, the backend
creates a new record and returns the generated UUID.

## Plugin enablement model

Plugin ids are backend-local enums in `app/core/constants.py`:

- optional: `stagings`
- optional: `qaa-generator`
- system: `admin`

`users.enabled_plugins` is a nullable JSON column added by Alembic revision
`20260811_0002`. `NULL` means the user has never customized plugin visibility yet, so the
backend resolves it to "all optional plugins enabled" for backward compatibility.

The frontend bootstraps from `GET /api/v1/me`, which now always returns a resolved
`enabled_plugins` list. Self-service updates use:

- `GET /api/v1/me/plugins`
- `PUT /api/v1/me/plugins` with `{ "enabled_plugins": [...] }`

`PUT /me/plugins` accepts only optional plugin ids. Unknown ids and system ids such as
`admin` are rejected with `422`.

## API highlights

- `GET /api/v1/me`: return the currently authenticated user, including resolved `enabled_plugins`.
- `GET /api/v1/me/plugins`: return the caller's resolved optional-plugin selection.
- `PUT /api/v1/me/plugins`: persist the caller's explicit optional-plugin selection.
- `GET /api/v1/users`: admin-only list of all users ordered by `id`.
- `POST /api/v1/users`: admin-only create endpoint that accepts `{ username, password, display_name, is_admin?, auto_login? }` and returns `UserRead` without exposing `password_hash`.
- `GET /api/v1/users/{id}`: admin-only user detail.
- `PATCH /api/v1/users/{id}`: admin-only partial update for `display_name`, `is_admin`, `auto_login`, and `password`. `username` is immutable.
- `DELETE /api/v1/users/{id}`: admin-only hard delete with guardrails for self-delete, last-admin removal, and users who already own recorded operations.
- `POST /api/v1/qaa/runs`: create a qaa-generator run through the backend proxy. The backend adds the service-token `Authorization` header, derives the optional `Actor` header (`email:<username>` when the username contains `@`, otherwise `QAA_GENERATOR_ACTOR`), and records a `qaa_generate` audit operation for the authenticated user.
- `GET /api/v1/qaa/runs`: list centrally shared qaa-generator runs with cursor pagination and filters.
- `GET /api/v1/qaa/runs/{run_id}`: fetch one run and opportunistically reconcile the stored audit row to a terminal status when qaa-generator reports one.
- `POST /api/v1/qaa/runs/{run_id}/pause|resume|stop`: forward run-control actions.
- `GET /api/v1/qaa/runs/{run_id}/events/stream`: SSE passthrough from qaa-generator to the authenticated SPA client.
- `GET /api/v1/qaa/runs/{run_id}/artifacts`: read the run artifact metadata and generated report text.

## QAA generator proxy settings

- `QAA_GENERATOR_BASE_URL`: base URL for the upstream service. Default: `http://qaa-generator.default.svc.cluster.local:8080/api/v1`
- `QAA_GENERATOR_PORT_FORWARD_ENABLED`: when `true`, ignore the configured upstream URL locally and talk to qaa-generator through `kubectl port-forward`. Default: `false`
- `QAA_GENERATOR_PORT_FORWARD_NAMESPACE`: Kubernetes namespace for the local port-forward workaround. Default: `qaa-prod`
- `QAA_GENERATOR_PORT_FORWARD_RESOURCE`: Kubernetes service resource for the local port-forward workaround. Default: `svc/qaa-generator`
- `QAA_GENERATOR_PORT_FORWARD_LOCAL_PORT`: local port for the workaround tunnel. Default: `18080`
- `QAA_GENERATOR_PORT_FORWARD_REMOTE_PORT`: remote service port for the workaround tunnel. Default: `8080`
- `QAA_GENERATOR_SERVICE_TOKEN`: bearer token the backend sends to qaa-generator. This value never reaches the browser.
- `QAA_GENERATOR_ACTOR`: fallback `Actor` header value for non-email usernames such as the seeded `test` / `admin` accounts. Leave empty to omit the header in that case.

## Local run

1. Ensure Python 3.12+ and PostgreSQL 16 are available.
2. From `backend/`, create a virtual environment and install the app:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

3. Copy `.env.example` to `.env` and adjust values if needed.
4. Apply migrations:

```bash
alembic upgrade head
```

5. Start the API:

```bash
uvicorn app.main:app --reload
```

If qaa-generator has no ingress yet, enable `QAA_GENERATOR_PORT_FORWARD_ENABLED=true` and keep `kubectl` authenticated; the backend will tunnel `svc/qaa-generator` locally and keep the public API shape unchanged.

The startup sequence seeds the `test` and `admin` users if they do not exist yet.

## Docker Compose

From the repository root:

```bash
docker compose up --build
```

The `backend` service waits for PostgreSQL, applies Alembic migrations, seeds dev users on startup, and then starts Uvicorn on port `8000`.

## Dev users

- `test` with an empty password
- `admin` with password `admin`

## Quality checks

Run from `backend/`:

```bash
ruff check .
ruff format --check .
mypy app
pytest
```
