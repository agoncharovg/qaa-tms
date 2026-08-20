"""Helpers for the bundled companion source artifact."""

from __future__ import annotations

import hashlib
import tomllib
from dataclasses import dataclass
from pathlib import Path

from app.core.config import Settings
from app.core.constants import ErrorMessage

AGENT_TARBALL_NAME = "qaa-tms-agent-src.tar.gz"
AGENT_SHA256_NAME = "qaa-tms-agent-src.tar.gz.sha256"
AGENT_PYPROJECT_NAME = "agent-pyproject.toml"
SHA256_SEPARATOR = " "


@dataclass(frozen=True, slots=True)
class AgentBundle:
    """Resolved bundled companion artifact metadata."""

    pyproject_path: Path
    sha256: str
    tarball_path: Path
    version: str


class AgentBundleUnavailableError(RuntimeError):
    """Raised when the bundled artifact is not present."""


def get_agent_bundle(settings: Settings) -> AgentBundle:
    """Resolve the bundled tarball and metadata.

    The backend serves the build-time artifact only. A source checkout without the
    bundled files returns 503 instead of synthesizing the archive dynamically.
    """

    dist_dir = Path(settings.agent_dist_dir).resolve()
    tarball_path = dist_dir / AGENT_TARBALL_NAME
    pyproject_path = dist_dir / AGENT_PYPROJECT_NAME

    if not tarball_path.is_file():
        raise AgentBundleUnavailableError(ErrorMessage.AGENT_BUNDLE_NOT_AVAILABLE.value)
    if not pyproject_path.is_file():
        raise AgentBundleUnavailableError(ErrorMessage.AGENT_MANIFEST_NOT_AVAILABLE.value)

    return AgentBundle(
        pyproject_path=pyproject_path,
        sha256=_read_sha256(dist_dir, tarball_path),
        tarball_path=tarball_path,
        version=_read_version(pyproject_path),
    )


def _read_version(pyproject_path: Path) -> str:
    with pyproject_path.open("rb") as handle:
        payload = tomllib.load(handle)
    version = payload.get("project", {}).get("version")
    if not isinstance(version, str) or not version.strip():
        raise AgentBundleUnavailableError(ErrorMessage.AGENT_MANIFEST_NOT_AVAILABLE.value)
    return version.strip()


def _read_sha256(dist_dir: Path, tarball_path: Path) -> str:
    sha_path = dist_dir / AGENT_SHA256_NAME
    if sha_path.is_file():
        content = sha_path.read_text(encoding="utf-8").strip()
        if content:
            return content.split(SHA256_SEPARATOR, 1)[0].strip()
    return hashlib.sha256(tarball_path.read_bytes()).hexdigest()
