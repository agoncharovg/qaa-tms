#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
AGENT_DIR="$ROOT_DIR/agent"
TMP_BASE="${TMPDIR:-/tmp}/qaa-tms"
DB_SERVICE_NAME="db"
BACKEND_SQLITE_PATH="$BACKEND_DIR/.qaa-tms-dev.db"

BACKEND_PID_FILE="$TMP_BASE-backend.pid"
BACKEND_LOG_FILE="$TMP_BASE-backend.log"
FRONTEND_PID_FILE="$TMP_BASE-frontend.pid"
FRONTEND_LOG_FILE="$TMP_BASE-frontend.log"
AGENT_PID_FILE="$TMP_BASE-agent.pid"
AGENT_LOG_FILE="$TMP_BASE-agent.log"

BACKEND_RUNTIME_MODE=""
BACKEND_RUNTIME_DATABASE_URL=""
BACKEND_RUNTIME_DESCRIPTION=""

require_command() {
  local command_name="$1"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "error: required command not found: $command_name" >&2
    exit 1
  fi
}

pick_python() {
  local venv_dir="$1"

  if [[ -x "$venv_dir/bin/python" ]]; then
    echo "$venv_dir/bin/python"
    return
  fi

  if command -v python3.12 >/dev/null 2>&1; then
    echo "python3.12"
    return
  fi

  if command -v python3 >/dev/null 2>&1; then
    echo "python3"
    return
  fi

  echo "error: Python 3.12+ is required." >&2
  exit 1
}

load_root_env() {
  local root_env_file="$ROOT_DIR/.env"

  if [[ ! -f "$root_env_file" ]]; then
    return
  fi

  set -a
  # shellcheck disable=SC1090
  source "$root_env_file"
  set +a

  if [[ -z "${QAA_GENERATOR_SUPERUSER_TOKEN:-}" && -n "${QAA_GEN_SUPERUSER_TOKEN:-}" ]]; then
    export QAA_GENERATOR_SUPERUSER_TOKEN="$QAA_GEN_SUPERUSER_TOKEN"
  fi
}

ensure_env_file() {
  local env_file="$1"
  local example_file="$2"

  if [[ -f "$env_file" ]]; then
    return
  fi

  cp "$example_file" "$env_file"
}

ensure_python_service() {
  local service_dir="$1"
  local venv_dir="$2"
  local label="$3"
  local python_bin

  python_bin="$(pick_python "$venv_dir")"

  if [[ ! -x "$venv_dir/bin/python" ]]; then
    echo "Creating $label virtualenv..."
    "$python_bin" -m venv "$venv_dir"
  fi

  if [[ ! -x "$venv_dir/bin/uvicorn" ]]; then
    echo "Installing $label dependencies..."
    "$venv_dir/bin/pip" install --upgrade pip
    (
      cd "$service_dir"
      "$venv_dir/bin/pip" install -e ".[dev]"
    )
  fi
}

ensure_frontend_dependencies() {
  if [[ -d "$FRONTEND_DIR/node_modules" ]]; then
    return
  fi

  echo "Installing frontend dependencies..."
  (
    cd "$FRONTEND_DIR"
    npm install
  )
}

start_db() {
  echo "Starting PostgreSQL with Docker Compose..."
  (
    cd "$ROOT_DIR"
    docker compose up -d "$DB_SERVICE_NAME"
  )
}

wait_for_db_container() {
  local container_id
  local status
  local attempt

  container_id="$(cd "$ROOT_DIR" && docker compose ps -q "$DB_SERVICE_NAME")"
  if [[ -z "$container_id" ]]; then
    echo "warning: could not resolve Docker container id for $DB_SERVICE_NAME"
    return 1
  fi

  for ((attempt = 1; attempt <= 60; attempt += 1)); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
    if [[ "$status" == "healthy" || "$status" == "running" ]]; then
      echo "PostgreSQL container is ready"
      return 0
    fi
    sleep 2
  done

  echo "warning: timed out waiting for PostgreSQL container health"
  return 1
}

postgres_host_is_reachable() {
  BACKEND_DB_HOST="127.0.0.1" \
  BACKEND_DB_PORT="5432" \
  BACKEND_DB_NAME="${POSTGRES_DB:-qaa_tms}" \
  BACKEND_DB_USER="${POSTGRES_USER:-qaa_tms}" \
  BACKEND_DB_PASSWORD="${POSTGRES_PASSWORD:-qaa_tms}" \
  "$BACKEND_DIR/.venv/bin/python" - <<'PY' >/dev/null 2>&1
import asyncio
import os

import asyncpg


async def main() -> None:
    conn = await asyncpg.connect(
        host=os.environ["BACKEND_DB_HOST"],
        port=int(os.environ["BACKEND_DB_PORT"]),
        database=os.environ["BACKEND_DB_NAME"],
        user=os.environ["BACKEND_DB_USER"],
        password=os.environ["BACKEND_DB_PASSWORD"],
        timeout=5,
    )
    try:
        await conn.fetchval("select 1")
    finally:
        await conn.close()


asyncio.run(main())
PY
}

resolve_backend_runtime() {
  if postgres_host_is_reachable; then
    BACKEND_RUNTIME_MODE="postgres-local"
    BACKEND_RUNTIME_DATABASE_URL=""
    BACKEND_RUNTIME_DESCRIPTION="PostgreSQL via 127.0.0.1:5432"
    echo "Backend will use PostgreSQL on 127.0.0.1:5432"
    return
  fi

  BACKEND_RUNTIME_MODE="sqlite"
  BACKEND_RUNTIME_DATABASE_URL="sqlite+aiosqlite:///$BACKEND_SQLITE_PATH"
  BACKEND_RUNTIME_DESCRIPTION="Local backend on SQLite at $BACKEND_SQLITE_PATH"
  echo "Host cannot complete a PostgreSQL session to 127.0.0.1:5432; falling back to a local backend on SQLite at $BACKEND_SQLITE_PATH"
}

prepare_sqlite_backend() {
  echo "Preparing SQLite schema for backend..."
  (
    cd "$BACKEND_DIR"
    DATABASE_URL="$BACKEND_RUNTIME_DATABASE_URL" .venv/bin/python - <<'PY'
import asyncio
import os

from app.db.base import Base
from app.db.session import create_engine_and_session_maker
from app.models.operation import Operation
from app.models.user import User

engine, _ = create_engine_and_session_maker(os.environ["DATABASE_URL"])
_ = (Operation, User)

async def main() -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    await engine.dispose()

asyncio.run(main())
PY
  )
}

prepare_backend_database() {
  if [[ "$BACKEND_RUNTIME_MODE" == "sqlite" ]]; then
    prepare_sqlite_backend
  fi
}

pid_is_live() {
  local pid_file="$1"

  if [[ ! -f "$pid_file" ]]; then
    return 1
  fi

  local pid
  pid="$(<"$pid_file")"

  if [[ -z "$pid" ]]; then
    return 1
  fi

  kill -0 "$pid" >/dev/null 2>&1
}

http_is_ready() {
  local url="$1"
  curl -fsS "$url" >/dev/null 2>&1
}

start_backend() {
  if http_is_ready "http://127.0.0.1:8000/ready"; then
    echo "Backend already responds on http://127.0.0.1:8000/ready"
    return
  fi

  if pid_is_live "$BACKEND_PID_FILE"; then
    echo "Backend process already running with PID $(<"$BACKEND_PID_FILE")."
    return
  fi

  rm -f "$BACKEND_PID_FILE"

  echo "Starting backend locally..."
  (
    cd "$BACKEND_DIR"
    if [[ "$BACKEND_RUNTIME_MODE" == "postgres-local" ]]; then
      nohup sh -c '.venv/bin/alembic upgrade head && exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000' \
        >"$BACKEND_LOG_FILE" 2>&1 &
    else
      nohup env DATABASE_URL="$BACKEND_RUNTIME_DATABASE_URL" .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 \
        >"$BACKEND_LOG_FILE" 2>&1 &
    fi
    echo $! >"$BACKEND_PID_FILE"
  )
}

start_frontend() {
  if http_is_ready "http://127.0.0.1:3000"; then
    echo "Frontend already responds on http://127.0.0.1:3000"
    return
  fi

  if pid_is_live "$FRONTEND_PID_FILE"; then
    echo "Frontend process already running with PID $(<"$FRONTEND_PID_FILE")."
    return
  fi

  rm -f "$FRONTEND_PID_FILE"

  echo "Starting frontend locally..."
  (
    cd "$FRONTEND_DIR"
    nohup npm run dev -- --host 0.0.0.0 --port 3000 >"$FRONTEND_LOG_FILE" 2>&1 &
    echo $! >"$FRONTEND_PID_FILE"
  )
}

start_agent() {
  if http_is_ready "http://127.0.0.1:47600/ping"; then
    echo "Agent already responds on http://127.0.0.1:47600/ping"
    return
  fi

  if pid_is_live "$AGENT_PID_FILE"; then
    echo "Agent process already running with PID $(<"$AGENT_PID_FILE")."
    return
  fi

  rm -f "$AGENT_PID_FILE"

  echo "Starting agent locally..."
  (
    cd "$AGENT_DIR"
    nohup .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 47600 >"$AGENT_LOG_FILE" 2>&1 &
    echo $! >"$AGENT_PID_FILE"
  )
}

wait_for_http() {
  local service_name="$1"
  local url="$2"
  local attempts="${3:-60}"
  local delay_seconds="${4:-2}"
  local attempt

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if http_is_ready "$url"; then
      echo "$service_name is ready: $url"
      return
    fi

    sleep "$delay_seconds"
  done

  echo "error: timed out waiting for $service_name at $url" >&2
  exit 1
}

print_summary() {
  echo
  echo "QAA-TMS is up:"
  echo "  frontend: http://localhost:3000"
  echo "  backend:  http://localhost:8000"
  echo "  agent:    http://127.0.0.1:47600"
  echo "  backend-runtime: $BACKEND_RUNTIME_MODE"
  echo "  backend-mode: $BACKEND_RUNTIME_DESCRIPTION"
  if [[ "$BACKEND_RUNTIME_MODE" == "sqlite" ]]; then
    echo "  backend-db-file: $BACKEND_SQLITE_PATH"
  else
    echo "  db:       localhost:5432"
  fi
  echo
  echo "Logs:"
  echo "  backend:  $BACKEND_LOG_FILE"
  echo "  frontend: $FRONTEND_LOG_FILE"
  echo "  agent:    $AGENT_LOG_FILE"
  echo
  echo "Pids:"
  echo "  backend:  $BACKEND_PID_FILE"
  echo "  frontend: $FRONTEND_PID_FILE"
  echo "  agent:    $AGENT_PID_FILE"
  echo
  echo "To stop everything:"
  echo "  docker compose down"
  echo "  kill \$(cat \"$BACKEND_PID_FILE\")"
  echo "  kill \$(cat \"$FRONTEND_PID_FILE\")"
  echo "  kill \$(cat \"$AGENT_PID_FILE\")"
}

main() {
  require_command docker
  require_command curl
  require_command npm
  load_root_env
  ensure_env_file "$BACKEND_DIR/.env" "$BACKEND_DIR/.env.example"
  ensure_env_file "$AGENT_DIR/.env" "$AGENT_DIR/.env.example"
  ensure_python_service "$BACKEND_DIR" "$BACKEND_DIR/.venv" "backend"
  ensure_python_service "$AGENT_DIR" "$AGENT_DIR/.venv" "agent"
  ensure_frontend_dependencies
  start_db
  wait_for_db_container || true
  resolve_backend_runtime
  prepare_backend_database
  start_backend
  start_frontend
  start_agent
  wait_for_http "backend" "http://127.0.0.1:8000/ready"
  wait_for_http "frontend" "http://127.0.0.1:3000"
  wait_for_http "agent" "http://127.0.0.1:47600/ping"
  print_summary
}

main "$@"
