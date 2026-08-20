#!/usr/bin/env bash
set -euo pipefail

BACKEND_URL="${QAA_TMS_BACKEND_URL:-}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/qaa-tms-agent"
CONSENT_FILE="${CONFIG_DIR}/consent"
LOG_DIR="${CONFIG_DIR}/logs"
SYSTEMD_USER_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SYSTEMD_UNIT_PATH="${SYSTEMD_USER_DIR}/qaa-tms-agent.service"
LAUNCHD_DIR="$HOME/Library/LaunchAgents"
LAUNCHD_PLIST_PATH="${LAUNCHD_DIR}/onl.gc.qaa-tms-agent.plist"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --backend-url)
      BACKEND_URL="${2:-}"
      shift 2
      ;;
    *)
      printf '%s\n' "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [ -z "${BACKEND_URL}" ]; then
  printf '%s\n' "Provide --backend-url or set QAA_TMS_BACKEND_URL." >&2
  exit 1
fi

normalize_origin() {
  python3 - "$1" <<'PY'
from __future__ import annotations

import sys
import urllib.parse

parsed = urllib.parse.urlparse(sys.argv[1])
if not parsed.scheme or not parsed.netloc:
    raise SystemExit("The backend URL must include a scheme and host.")
print(f"{parsed.scheme}://{parsed.netloc}")
PY
}

require_python() {
  python3 - <<'PY'
from __future__ import annotations

import sys

if sys.version_info < (3, 12):
    raise SystemExit("python3 >= 3.12 is required.")
PY
}

write_env_value() {
  python3 - "$1" "$2" "$3" <<'PY'
from __future__ import annotations

import sys
from pathlib import Path

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
written = False
updated: list[str] = []
for line in lines:
    if line.startswith(f"{key}="):
        updated.append(f"{key}={value}")
        written = True
    else:
        updated.append(line)
if not written:
    if updated and updated[-1] != "":
        updated.append("")
    updated.append(f"{key}={value}")
serialized = "\n".join(updated)
if updated:
    serialized = f"{serialized}\n"
path.write_text(serialized, encoding="utf-8")
PY
}

render_template() {
  python3 - "$1" "$2" "$3" "$4" <<'PY'
from __future__ import annotations

import sys
from pathlib import Path

template_path = Path(sys.argv[1])
output_path = Path(sys.argv[2])
install_dir = sys.argv[3]
log_dir = sys.argv[4]
content = template_path.read_text(encoding="utf-8")
content = content.replace("__INSTALL_DIR__", install_dir).replace("__LOG_DIR__", log_dir)
output_path.parent.mkdir(parents=True, exist_ok=True)
output_path.write_text(content, encoding="utf-8")
PY
}

ensure_consent() {
  mkdir -p "${CONFIG_DIR}"
  if [ -f "${CONSENT_FILE}" ]; then
    return
  fi

  cat <<'EOF'
This installer will configure the QAA-TMS companion to run under your personal credentials.
The companion uses:
- your VPN session
- your kubeconfig
- your personal Jenkins token
- local staging and kubectl commands on your behalf

Type I AGREE to continue:
EOF
  read -r confirmation
  if [ "${confirmation}" != "I AGREE" ]; then
    printf '%s\n' "Consent was not granted. Aborting." >&2
    exit 1
  fi
  printf '%s\n' "accepted" > "${CONSENT_FILE}"
}

bootstrap_venv() {
  if command -v uv >/dev/null 2>&1; then
    uv venv "${SCRIPT_DIR}/.venv"
    "${SCRIPT_DIR}/.venv/bin/python" -m pip install --upgrade pip
    uv pip install --python "${SCRIPT_DIR}/.venv/bin/python" -e "${SCRIPT_DIR}"
    return
  fi

  python3 -m venv "${SCRIPT_DIR}/.venv"
  "${SCRIPT_DIR}/.venv/bin/python" -m pip install --upgrade pip
  "${SCRIPT_DIR}/.venv/bin/python" -m pip install -e "${SCRIPT_DIR}"
}

install_systemd_unit() {
  render_template \
    "${SCRIPT_DIR}/deploy/qaa-tms-agent.service.tmpl" \
    "${SYSTEMD_UNIT_PATH}" \
    "${SCRIPT_DIR}" \
    "${LOG_DIR}"
  systemctl --user daemon-reload
  systemctl --user enable --now qaa-tms-agent.service
  printf '%s\n' "To keep the service running without an active login session, run: loginctl enable-linger ${USER}"
}

install_launchd_unit() {
  mkdir -p "${LAUNCHD_DIR}" "${LOG_DIR}"
  render_template \
    "${SCRIPT_DIR}/deploy/onl.gc.qaa-tms-agent.plist.tmpl" \
    "${LAUNCHD_PLIST_PATH}" \
    "${SCRIPT_DIR}" \
    "${LOG_DIR}"
  launchctl bootout "gui/$(id -u)" "${LAUNCHD_PLIST_PATH}" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "${LAUNCHD_PLIST_PATH}"
  launchctl kickstart -k "gui/$(id -u)/onl.gc.qaa-tms-agent"
}

main() {
  require_python
  ensure_consent
  mkdir -p "${LOG_DIR}"
  chmod +x "${SCRIPT_DIR}/install.sh" "${SCRIPT_DIR}/run.sh" "${SCRIPT_DIR}/update.sh"
  bootstrap_venv

  backend_origin="$(normalize_origin "${BACKEND_URL}")"
  env_path="${SCRIPT_DIR}/.env"
  write_env_value "${env_path}" "AGENT_BACKEND_URL" "${backend_origin}"
  write_env_value "${env_path}" "AGENT_CORS_ORIGINS" "${backend_origin}"

  case "$(uname -s)" in
    Darwin)
      install_launchd_unit
      ;;
    Linux)
      install_systemd_unit
      ;;
    *)
      printf '%s\n' "Unsupported operating system: $(uname -s)" >&2
      exit 1
      ;;
  esac

  printf '%s\n' "Verify the agent with: curl 127.0.0.1:47600/ping"
  if [ "$(uname -s)" = "Darwin" ]; then
    printf '%s\n' "View logs with: tail -f ${LOG_DIR}/stdout.log"
  else
    printf '%s\n' "View logs with: journalctl --user -u qaa-tms-agent.service -f"
  fi
}

main "$@"
