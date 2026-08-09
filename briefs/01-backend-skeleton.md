# Brief 01 — Backend skeleton + docker-compose (Postgres)

You are implementing the FIRST slice of the QAA-TMS backend. Read
`CONVENTIONS.md`, `discuss/02`, and `discuss/04` in this repo first — they are
the source of truth. This brief covers ONLY the backend + a docker-compose for
Postgres+backend. Do NOT build the frontend or the companion-app agent yet.

## Context (short)
QAA-TMS is an internal portal for QA-automation engineers. The central backend
(FastAPI, runs in k8s) provides auth, users, and a central audit log of
operations that a LOCAL AGENT (on each engineer's machine) executes. The
backend itself never runs those operations — it only stores/serves their
records and serves auth. See `discuss/04` for the full contract.

## Stack (fixed — do not substitute)
- Python 3.12+, FastAPI, SQLAlchemy 2.0 **async**, asyncpg, Alembic.
- Config via `pydantic-settings` (env vars).
- Auth stub: JWT (HS256) with a dev secret from settings.
- Package manager / build: `pyproject.toml` (use `uv` or `pip`; your choice).
- Lint/type: `ruff` + `mypy`, both must pass clean.
- Tests: `pytest` (a handful of meaningful tests, see acceptance).

## Repository layout (create under `backend/`)
Follow `discuss/02 §3`:
```
backend/
  app/
    main.py                # FastAPI app factory, router include, health/ready
    core/
      config.py            # pydantic-settings Settings
      constants.py         # ALL global StrEnums + constant keys (see below)
      security.py          # JWT issue/verify, password check (stub)
    db/
      session.py           # async engine + session factory
      base.py              # DeclarativeBase
    models/
      user.py
      operation.py
    schemas/
      user.py
      operation.py
      auth.py
    api/
      deps.py              # get_db, get_current_user
      v1/
        __init__.py        # APIRouter aggregating routers, prefix /api/v1
        auth.py            # POST /auth/login
        users.py           # GET /me
        operations.py      # operations CRUD + replay
  alembic/                 # migrations
  alembic.ini
  pyproject.toml
  README.md                # how to run (local + docker)
```

## Constants — `app/core/constants.py` (per CONVENTIONS.md)
Model these as `enum.StrEnum` (NO bare string literals elsewhere in the code):
- `OperationType`: `deploy`, `destroy`, `e2e_run`, `adopt`, `sync`, `setup`.
- `OperationStatus`: `queued`, `running`, `success`, `failed`, `aborted`.
- `Product`: `IAM`, `Billing`, `CDN`, `DNS`, `Notifications`.
- `ApiPrefix` / route constants (e.g. `API_V1 = "/api/v1"`), tag names.
Any other string that is reused (token type, env keys) goes here too.

## Data models
`User`:
- `id` (int PK), `username` (unique), `password_hash` (nullable — empty password
  allowed for the dev `test` user), `display_name`, `is_admin` (bool),
  `auto_login` (bool, default False), timestamps.

`Operation` (mirror `discuss/04 §9`):
- `id` (UUID or int PK), `user_id` (FK), `type` (OperationType),
  `ns` (str, nullable), `recipe` (JSONB — `{services[], images{}, product,
  suites[], flags{}}`), `status` (OperationStatus),
  `started_at`, `finished_at` (nullable),
  `log` (Text, nullable), `exit_code` (int, nullable),
  `agent_host`, `agent_version`, `stagings_sha` (all nullable),
  `created_at`.

## Endpoints (`discuss/04 §8`) — all under `/api/v1`
- `POST /auth/login` — body `{username, password}`. Validate against the stub
  users. Return `{access_token, token_type: "bearer", user: {...}}`. The
  `test` user authenticates with an **empty** password.
- `GET /me` — requires bearer; returns the current user (incl. `is_admin`,
  `auto_login`).
- `POST /operations` — requires bearer; the agent creates OR updates an
  operation record (upsert by client-supplied id is fine, or create-then-PATCH;
  pick one and document it). Attribution: `user_id` comes from the token, NOT
  the body.
- `GET /operations` — requires bearer; list with filters `user_id`, `ns`,
  `type`, `status` + basic pagination. Non-admins see only their own; admins
  see all.
- `GET /operations/{id}` — details incl. full `log`.
- `GET /operations/{id}/replay` — returns the `recipe` (+ `type`, `ns`) so the
  frontend can re-submit it to the local agent. **The backend must NOT execute
  anything.**

Also, outside the versioned router:
- `GET /health` — liveness, no DB.
- `GET /ready` — readiness, checks DB connectivity.

## Auth stub details
- JWT HS256, secret + expiry from `Settings`. `sub` = username. Long-ish expiry
  (e.g. 12h) since the agent reuses the token for long jobs.
- `get_current_user` decodes the bearer, loads the user.
- No real password hashing complexity required, but store a hash (e.g. passlib
  bcrypt); the `test` user has an empty password (allow empty).

## Dev user seeding
Seed two users on first run (idempotent — via Alembic data migration or a
startup seed guarded against duplicates):
- `test` — empty password, `is_admin=False`.
- `admin` — password `admin`, `is_admin=True`.

## Config (`Settings`)
Env-driven: `DATABASE_URL` (async, e.g. `postgresql+asyncpg://...`),
`JWT_SECRET`, `JWT_EXPIRE_MINUTES`, `CORS_ORIGINS` (list). Provide a
`.env.example`. CORS must be configurable (the SPA origin will need it later).

## docker-compose (repo root `docker-compose.yml`)
- `db`: Postgres 16, healthcheck, named volume, env for db/user/pass.
- `backend`: builds from `backend/Dockerfile`, depends_on db healthy, runs
  migrations then uvicorn, exposes 8000, reads config from env.
- Bring the stack up with a single `docker compose up`. (Frontend service will
  be added in a later slice — leave a commented placeholder.)

## Acceptance criteria (must all hold)
1. `docker compose up` starts Postgres + backend; migrations apply
   automatically; dev users are seeded.
2. `GET /health` → 200; `GET /ready` → 200 when DB is up.
3. `POST /api/v1/auth/login` with `{"username":"admin","password":"admin"}`
   returns a token and `user.is_admin == true`; with
   `{"username":"test","password":""}` also succeeds.
4. `GET /api/v1/me` with the token returns the right user.
5. Operations: create via `POST /operations`, list/filter via `GET /operations`
   (non-admin sees only own), fetch one, and `GET /operations/{id}/replay`
   returns the recipe.
6. `ruff check` and `mypy` pass clean; `pytest` passes and includes at least:
   login (both users), `/me` auth-required (401 without token), operation
   create+attribution, replay returns recipe, non-admin list isolation.
7. All global constants are `StrEnum` in `app/core/constants.py`; no stray
   string literals for the enumerated values. All user-facing strings in English.
8. `backend/README.md` documents local run (without Docker) and docker-compose run.

## Out of scope (do NOT do)
- Frontend, companion-app/agent, real OIDC, real Jenkins/staging integration.
- Any actual execution of `staging` commands.

When done, ensure the working tree builds and the acceptance checks pass, then
stop. Do not commit — the reviewer will inspect `git diff` and commit.
