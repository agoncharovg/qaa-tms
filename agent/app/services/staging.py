"""Helpers around the local `staging` CLI installation."""

from __future__ import annotations

import platform
import shutil
import socket
import subprocess
from dataclasses import dataclass
from importlib import metadata
from pathlib import Path

from app.core.config import Settings
from app.core.constants import AGENT_APP_NAME, DEFAULT_AGENT_VERSION, PACKAGE_NAME
from app.schemas import AgentPingResponse, DeployRequest, SyncFlags


@dataclass(slots=True)
class StagingInstallation:
    """Resolved local staging installation."""

    bin_path: Path | None
    repo_root: Path | None
    git_sha: str | None

    @property
    def installed(self) -> bool:
        return self.bin_path is not None


class StagingNotInstalledError(RuntimeError):
    """Raised when `staging` cannot be resolved."""


def get_agent_version() -> str:
    """Return the installed package version."""

    try:
        return metadata.version(PACKAGE_NAME)
    except metadata.PackageNotFoundError:
        return DEFAULT_AGENT_VERSION


def get_agent_host_name() -> str:
    """Return a hostname useful for audit records."""

    return socket.gethostname()


def resolve_staging_installation(settings: Settings) -> StagingInstallation:
    """Resolve the local staging binary, repo root, and git SHA."""

    bin_path = _resolve_binary_path(settings)
    repo_root = _resolve_repo_root(settings, bin_path)
    git_sha = _resolve_git_sha(repo_root)
    return StagingInstallation(bin_path=bin_path, repo_root=repo_root, git_sha=git_sha)


def build_ping_response(settings: Settings) -> AgentPingResponse:
    """Build the exact `/ping` payload."""

    installation = resolve_staging_installation(settings)
    return AgentPingResponse(
        app=AGENT_APP_NAME,
        version=get_agent_version(),
        stagings_installed=installation.installed,
        stagings_sha=installation.git_sha,
        os=platform.system().lower(),
    )


def build_deploy_argv(
    settings: Settings,
    request: DeployRequest,
) -> tuple[list[str], StagingInstallation]:
    """Translate the frontend deploy request into the real CLI argv."""

    argv, installation = _build_base_argv(settings, "deploy", request.ns)
    if request.services:
        argv.extend(["--services", ",".join(request.services)])
    for service, tag in request.images.items():
        argv.extend(["--image", f"{service}={tag}"])
    if request.flags.full:
        argv.append("--full")
    if request.flags.dry_run:
        argv.append("--dry-run")
    if request.flags.no_sync:
        argv.append("--no-sync")
    if request.flags.stage is not None:
        argv.extend(["--stage", str(request.flags.stage)])
    return argv, installation


def build_destroy_argv(settings: Settings, namespace: str) -> tuple[list[str], StagingInstallation]:
    """Translate a destroy request into the real CLI argv."""

    return _build_base_argv(settings, "destroy", namespace)


def build_adopt_argv(settings: Settings, namespace: str) -> tuple[list[str], StagingInstallation]:
    """Translate an adopt request into the real CLI argv."""

    return _build_base_argv(settings, "adopt", namespace)


def build_sync_argv(settings: Settings, flags: SyncFlags) -> tuple[list[str], StagingInstallation]:
    """Translate a sync request into the real CLI argv."""

    argv, installation = _build_base_argv(settings, "sync")
    if flags.service:
        argv.extend(["--service", flags.service])
    if flags.verbose:
        argv.append("--verbose")
    if flags.pull:
        argv.append("--pull")
    if flags.apply:
        argv.append("--apply")
    return argv, installation


def _resolve_binary_path(settings: Settings) -> Path | None:
    raw_path = settings.staging_bin or shutil.which("staging")
    if not raw_path:
        return None
    path = Path(raw_path).expanduser()
    if not path.exists():
        return None
    return path.resolve()


def _resolve_repo_root(settings: Settings, bin_path: Path | None) -> Path | None:
    if settings.stagings_repo:
        path = Path(settings.stagings_repo).expanduser()
        if path.exists():
            return path.resolve()
        return None
    if bin_path is None:
        return None
    return bin_path.parent.parent


def _resolve_git_sha(repo_root: Path | None) -> str | None:
    if repo_root is None:
        return None
    try:
        result = subprocess.run(
            ["git", "-C", str(repo_root), "rev-parse", "--short", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None
    sha = result.stdout.strip()
    return sha or None


def _build_base_argv(
    settings: Settings,
    command: str,
    *args: str,
) -> tuple[list[str], StagingInstallation]:
    installation = resolve_staging_installation(settings)
    if installation.bin_path is None:
        raise StagingNotInstalledError("The staging binary is not installed.")

    return [str(installation.bin_path), command, *args], installation
