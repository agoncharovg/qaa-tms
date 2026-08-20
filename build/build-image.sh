#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

REGISTRY="${REGISTRY:-harbor.p.gc.onl}"
PROJECT="${PROJECT:-qaa}"
PLATFORM="${PLATFORM:-linux/amd64}"
SERVICE="${SERVICE:-all}"
PUSH_IMAGE=0
API_BASE_URL="${VITE_API_BASE_URL:-http://localhost:8000}"
AGENT_PORTS="${VITE_AGENT_PORTS:-47600-47605}"

usage() {
  cat <<'EOF'
Usage:
  build/build-image.sh [backend|frontend|all] [options]

Options:
  --tag <tag>              Docker tag. Default: sanitized current git branch.
  --registry <registry>    Registry host. Default: harbor.p.gc.onl
  --project <project>      Harbor project/repository namespace. Default: qaa
  --platform <platform>    Docker platform. Default: linux/amd64
  --push                   Push built images to registry
  --api-base-url <url>     Frontend runtime/build fallback API URL
  --agent-ports <range>    Frontend runtime/build fallback agent port range
  -h, --help               Show this help

Environment overrides:
  REGISTRY, PROJECT, PLATFORM, VITE_API_BASE_URL, VITE_AGENT_PORTS

Examples:
  build/build-image.sh all --tag feature-qaa-123
  build/build-image.sh frontend --tag latest --push --api-base-url https://tms.example.com
EOF
}

sanitize_tag() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's#[^a-z0-9_.-]+#-#g; s#(^[-.]+|[-.]+$)##g; s#[-.]{2,}#-#g'
}

detect_default_tag() {
  local branch
  branch="$(git -C "${REPO_ROOT}" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"

  if [[ -z "${branch}" || "${branch}" == "HEAD" ]]; then
    branch="$(git -C "${REPO_ROOT}" rev-parse --short HEAD 2>/dev/null || true)"
  fi

  if [[ -z "${branch}" ]]; then
    branch="latest"
  fi

  sanitize_tag "${branch}"
}

TAG="${TAG:-$(detect_default_tag)}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    backend|frontend|all)
      SERVICE="$1"
      shift
      ;;
    --tag)
      TAG="$(sanitize_tag "${2:?missing value for --tag}")"
      shift 2
      ;;
    --registry)
      REGISTRY="${2:?missing value for --registry}"
      shift 2
      ;;
    --project)
      PROJECT="${2:?missing value for --project}"
      shift 2
      ;;
    --platform)
      PLATFORM="${2:?missing value for --platform}"
      shift 2
      ;;
    --push)
      PUSH_IMAGE=1
      shift
      ;;
    --api-base-url)
      API_BASE_URL="${2:?missing value for --api-base-url}"
      shift 2
      ;;
    --agent-ports)
      AGENT_PORTS="${2:?missing value for --agent-ports}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

BACKEND_IMAGE="${REGISTRY}/${PROJECT}/qaa-tms-backend:${TAG}"
FRONTEND_IMAGE="${REGISTRY}/${PROJECT}/qaa-tms-frontend:${TAG}"

build_backend() {
  printf '==> Building %s\n' "${BACKEND_IMAGE}"
  docker build \
    --platform "${PLATFORM}" \
    -t "${BACKEND_IMAGE}" \
    -f "${REPO_ROOT}/build/backend.Dockerfile" \
    "${REPO_ROOT}"
}

build_frontend() {
  printf '==> Building %s\n' "${FRONTEND_IMAGE}"
  docker build \
    --platform "${PLATFORM}" \
    --build-arg "VITE_API_BASE_URL=${API_BASE_URL}" \
    --build-arg "VITE_AGENT_PORTS=${AGENT_PORTS}" \
    -t "${FRONTEND_IMAGE}" \
    -f "${REPO_ROOT}/build/frontend.Dockerfile" \
    "${REPO_ROOT}"
}

push_image() {
  local image="$1"
  printf '==> Pushing %s\n' "${image}"
  docker push "${image}"
}

case "${SERVICE}" in
  backend)
    build_backend
    [[ "${PUSH_IMAGE}" -eq 1 ]] && push_image "${BACKEND_IMAGE}"
    ;;
  frontend)
    build_frontend
    [[ "${PUSH_IMAGE}" -eq 1 ]] && push_image "${FRONTEND_IMAGE}"
    ;;
  all)
    build_backend
    build_frontend
    if [[ "${PUSH_IMAGE}" -eq 1 ]]; then
      push_image "${BACKEND_IMAGE}"
      push_image "${FRONTEND_IMAGE}"
    fi
    ;;
  *)
    printf 'Unsupported service: %s\n' "${SERVICE}" >&2
    exit 1
    ;;
esac

printf '\nBuilt images:\n'
case "${SERVICE}" in
  backend)
    printf '  %s\n' "${BACKEND_IMAGE}"
    ;;
  frontend)
    printf '  %s\n' "${FRONTEND_IMAGE}"
    ;;
  all)
    printf '  %s\n' "${BACKEND_IMAGE}"
    printf '  %s\n' "${FRONTEND_IMAGE}"
    ;;
esac
