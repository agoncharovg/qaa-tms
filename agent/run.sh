#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PYTHON_BIN="${SCRIPT_DIR}/.venv/bin/python"
export QAA_TMS_AGENT_SERVICE_MANAGED=1

if ! "${SCRIPT_DIR}/update.sh" --if-newer; then
  printf '%s\n' "Automatic update check failed; starting the current agent build." >&2
fi

exec "${PYTHON_BIN}" -m app.main
