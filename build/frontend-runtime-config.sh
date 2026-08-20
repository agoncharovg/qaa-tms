#!/bin/sh
set -eu

escape_js() {
  printf '%s' "${1:-}" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

api_base_url="$(escape_js "${VITE_API_BASE_URL:-}")"
agent_ports="$(escape_js "${VITE_AGENT_PORTS:-}")"

cat > /usr/share/nginx/html/runtime-config.js <<EOF
window.__QAA_TMS_RUNTIME_CONFIG__ = {
  apiBaseUrl: "${api_base_url}",
  agentPorts: "${agent_ports}"
};
EOF
