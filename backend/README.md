# QAA-TMS Backend

The backend is a FastAPI service with async SQLAlchemy, Alembic migrations, JWT stub auth,
an audit log for agent operations, and per-user plugin enablement for the frontend shell.

`POST /api/v1/operations` supports create-or-update semantics. If the client sends an `id`,
the backend upserts that operation for the authenticated user. If `id` is omitted, the backend
creates a new record and returns the generated UUID.

## Plugin enablement model

Plugin ids are backend-local enums in `app/core/constants.py`:

- optional: `stagings`
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
