#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
MODE="${1:---force}"

case "${MODE}" in
  --if-newer|--force)
    ;;
  *)
    printf '%s\n' "Unsupported mode: ${MODE}" >&2
    exit 2
    ;;
esac

PYTHON_BIN="${SCRIPT_DIR}/.venv/bin/python"
if [ ! -x "${PYTHON_BIN}" ]; then
  PYTHON_BIN="$(command -v python3)"
fi

INSTALL_DIR="${SCRIPT_DIR}" UPDATE_MODE="${MODE}" "${PYTHON_BIN}" - <<'PY'
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import tomllib
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BACKEND_URL_KEY = "AGENT_BACKEND_URL"
DOWNLOAD_SUFFIX = "/api/v1/agent/download"
ENV_FILE_NAME = ".env"
INSTALL_DIR = Path(os.environ["INSTALL_DIR"]).resolve()
MANIFEST_SUFFIX = "/api/v1/agent/manifest"
UPDATE_MODE = os.environ["UPDATE_MODE"]


def read_env_value(path: Path, key: str) -> str:
    if not path.is_file():
        return ""
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        current_key, value = stripped.split("=", 1)
        if current_key == key:
            return value.strip().strip('"').strip("'")
    return ""


def read_version(pyproject_path: Path) -> str:
    with pyproject_path.open("rb") as handle:
        payload = tomllib.load(handle)
    version = payload.get("project", {}).get("version")
    if not isinstance(version, str) or not version.strip():
        raise RuntimeError(f"Missing project.version in {pyproject_path}.")
    return version.strip()


def normalize_version(version: str) -> tuple[int, ...]:
    core = version.split("-", 1)[0]
    return tuple(int(part) for part in core.split("."))


def request_json(url: str) -> dict[str, object]:
    with urllib.request.urlopen(url) as response:
        payload = response.read()
    import json

    data = json.loads(payload.decode("utf-8"))
    if not isinstance(data, dict):
        raise RuntimeError(f"Expected a JSON object from {url}.")
    return data


def download_bytes(url: str) -> bytes:
    with urllib.request.urlopen(url) as response:
        return response.read()


def ensure_venv(install_dir: Path, base_python: str) -> None:
    subprocess.run([base_python, "-m", "venv", ".venv"], cwd=install_dir, check=True)


def install_editable(install_dir: Path) -> None:
    python_bin = install_dir / ".venv" / "bin" / "python"
    subprocess.run([str(python_bin), "-m", "pip", "install", "--upgrade", "pip"], cwd=install_dir, check=True)
    subprocess.run([str(python_bin), "-m", "pip", "install", "-e", "."], cwd=install_dir, check=True)


def restart_service() -> None:
    if sys.platform == "darwin":
        subprocess.run(
            ["launchctl", "kickstart", "-k", f"gui/{os.getuid()}/onl.gc.qaa-tms-agent"],
            check=True,
        )
        return
    subprocess.run(["systemctl", "--user", "restart", "qaa-tms-agent.service"], check=True)


def main() -> int:
    base_python = os.path.realpath(sys.executable)
    if (
        not base_python
        or not os.access(base_python, os.X_OK)
        or Path(base_python).resolve().is_relative_to(INSTALL_DIR)
    ):
        base_python = ""
        for python_name in ("python3", "python"):
            candidate = shutil.which(python_name)
            if not candidate:
                continue
            candidate = os.path.realpath(candidate)
            if (
                candidate
                and os.access(candidate, os.X_OK)
                and not Path(candidate).resolve().is_relative_to(INSTALL_DIR)
            ):
                base_python = candidate
                break
    if not base_python:
        raise RuntimeError("Could not resolve a stable Python interpreter for the venv rebuild.")

    home = Path(os.environ.get("QAA_TMS_HOME") or INSTALL_DIR.parent)
    env_path = home / ENV_FILE_NAME
    backend_url = read_env_value(env_path, BACKEND_URL_KEY).rstrip("/")
    if not backend_url:
        raise RuntimeError("AGENT_BACKEND_URL is not configured in .env.")

    local_version = read_version(INSTALL_DIR / "pyproject.toml")
    manifest_url = urllib.parse.urljoin(f"{backend_url}/", MANIFEST_SUFFIX.lstrip("/"))
    manifest = request_json(manifest_url)
    remote_version = str(manifest["version"])
    remote_sha256 = str(manifest["sha256"])
    download_path = str(manifest["downloadUrl"])
    download_url = urllib.parse.urljoin(f"{backend_url}/", download_path.lstrip("/"))
    if UPDATE_MODE == "--if-newer" and normalize_version(remote_version) <= normalize_version(local_version):
        return 0

    archive_bytes = download_bytes(download_url)
    if hashlib.sha256(archive_bytes).hexdigest() != remote_sha256:
        raise RuntimeError("Downloaded agent archive sha256 does not match the manifest.")

    parent_dir = INSTALL_DIR.parent
    backup_dir = parent_dir / f"{INSTALL_DIR.name}.backup"
    next_dir = parent_dir / f"{INSTALL_DIR.name}.next"
    shutil.rmtree(backup_dir, ignore_errors=True)
    shutil.rmtree(next_dir, ignore_errors=True)

    with tempfile.TemporaryDirectory(prefix="qaa-tms-agent-update-") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        archive_path = temp_dir / "agent.tar.gz"
        archive_path.write_bytes(archive_bytes)
        extract_dir = temp_dir / "extract"
        extract_dir.mkdir()
        with tarfile.open(archive_path, "r:gz") as archive:
            archive.extractall(extract_dir)
        payload_root = extract_dir / "agent"
        if not payload_root.is_dir():
            raise RuntimeError("The downloaded archive does not contain the agent/ root.")
        shutil.copytree(payload_root, next_dir)

    try:
        INSTALL_DIR.rename(backup_dir)
        next_dir.rename(INSTALL_DIR)
        ensure_venv(INSTALL_DIR, base_python)
        install_editable(INSTALL_DIR)
    except Exception:
        shutil.rmtree(INSTALL_DIR, ignore_errors=True)
        if backup_dir.exists():
            backup_dir.rename(INSTALL_DIR)
        raise
    finally:
        shutil.rmtree(next_dir, ignore_errors=True)

    shutil.rmtree(backup_dir, ignore_errors=True)
    if UPDATE_MODE != "--if-newer":
        restart_service()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except urllib.error.URLError as exc:
        raise SystemExit(f"Failed to reach the backend manifest or archive: {exc}") from exc
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(str(exc)) from exc
PY
