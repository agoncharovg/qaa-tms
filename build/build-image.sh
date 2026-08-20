#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

REGISTRY="${REGISTRY:-harbor.p.gc.onl}"
PROJECT="${PROJECT:-qaa}"
PLATFORM="${PLATFORM:-linux/amd64}"
PUSH_IMAGE=0
API_BASE_URL="${VITE_API_BASE_URL:-}"
AGENT_PORTS="${VITE_AGENT_PORTS:-47600-47605}"

usage() {
  cat <<'EOF'
Usage:
  build/build-image.sh [options]

Options:
  --tag <tag>              Docker tag. Default: sanitized current git branch.
  --registry <registry>    Registry host. Default: harbor.p.gc.onl
  --project <project>      Harbor project/repository namespace. Default: qaa
  --platform <platform>    Docker platform. Default: linux/amd64
  --push                   Push the built image to the registry
  --api-base-url <url>     Frontend build-time API base URL. Default: empty for same-origin
  --agent-ports <range>    Frontend build-time fallback agent port range
  -h, --help               Show this help

Environment overrides:
  REGISTRY, PROJECT, PLATFORM, VITE_API_BASE_URL, VITE_AGENT_PORTS

Examples:
  build/build-image.sh --tag feature-qaa-123
  build/build-image.sh --tag latest --push --api-base-url https://tms.example.com
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

IMAGE="${REGISTRY}/${PROJECT}/qaa-tms:${TAG}"

build_image() {
  printf '==> Building %s\n' "${IMAGE}"
  docker build \
    --platform "${PLATFORM}" \
    --build-arg "VITE_API_BASE_URL=${API_BASE_URL}" \
    --build-arg "VITE_AGENT_PORTS=${AGENT_PORTS}" \
    -t "${IMAGE}" \
    -f "${REPO_ROOT}/build/Dockerfile" \
    "${REPO_ROOT}"
}

push_image() {
  printf '==> Pushing %s\n' "${IMAGE}"
  docker push "${IMAGE}"
}

build_image
[[ "${PUSH_IMAGE}" -eq 1 ]] && push_image

printf '\nBuilt images:\n'
printf '  %s\n' "${IMAGE}"
