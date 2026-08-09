# QAA-TMS Backend

The backend is a FastAPI service with async SQLAlchemy, Alembic migrations, JWT stub auth, and an audit log for agent operations.

`POST /api/v1/operations` supports create-or-update semantics. If the client sends an `id`, the backend upserts that operation for the authenticated user. If `id` is omitted, the backend creates a new record and returns the generated UUID.

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
mypy app tests
pytest
```
