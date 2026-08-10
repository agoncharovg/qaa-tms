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
from app.core.constants import (
    AGENT_APP_NAME,
    DEFAULT_AGENT_VERSION,
    DEFAULT_STAGING_BINARY_NAME,
    PACKAGE_NAME,
    ErrorMessage,
    Product,
    StagingCommand,
    StagingFlag,
)
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

    argv, installation = _build_base_argv(settings, StagingCommand.DEPLOY, request.ns)
    if request.services:
        argv.extend([StagingFlag.SERVICES.value, ",".join(request.services)])
    for service, tag in request.images.items():
        argv.extend([StagingFlag.IMAGE.value, f"{service}={tag}"])
    if request.flags.clean:
        argv.append(StagingFlag.CLEAN.value)
    if request.flags.full:
        argv.append(StagingFlag.FULL.value)
    if request.flags.dry_run:
        argv.append(StagingFlag.DRY_RUN.value)
    if request.flags.no_sync:
        argv.append(StagingFlag.NO_SYNC.value)
    if request.flags.stage is not None:
        argv.extend([StagingFlag.STAGE.value, str(request.flags.stage)])
    return argv, installation


def build_destroy_argv(settings: Settings, namespace: str) -> tuple[list[str], StagingInstallation]:
    """Translate a destroy request into the real CLI argv."""

    return _build_base_argv(settings, StagingCommand.DESTROY, namespace)


def build_adopt_argv(settings: Settings, namespace: str) -> tuple[list[str], StagingInstallation]:
    """Translate an adopt request into the real CLI argv."""

    return _build_base_argv(settings, StagingCommand.ADOPT, namespace)


def build_sync_argv(settings: Settings, flags: SyncFlags) -> tuple[list[str], StagingInstallation]:
    """Translate a sync request into the real CLI argv."""

    argv, installation = _build_base_argv(settings, StagingCommand.SYNC)
    if flags.service:
        argv.extend([StagingFlag.SERVICE.value, flags.service])
    if flags.verbose:
        argv.append(StagingFlag.VERBOSE.value)
    if flags.pull:
        argv.append(StagingFlag.PULL.value)
    if flags.apply:
        argv.append(StagingFlag.APPLY.value)
    return argv, installation


def build_e2e_run_argv(
    settings: Settings,
    namespace: str,
    product: Product,
    suites: list[str],
    threads: int | None,
) -> tuple[list[str], StagingInstallation]:
    """Translate an E2E run request into the real CLI argv."""

    argv, installation = _build_base_argv(
        settings,
        StagingCommand.E2E_RUN,
        namespace,
        StagingFlag.PRODUCT.value,
        product.value,
    )
    if suites:
        argv.extend([StagingFlag.SUITE.value, ",".join(suites)])
    if threads is not None:
        argv.extend([StagingFlag.THREADS.value, str(threads)])
    return argv, installation


def _resolve_binary_path(settings: Settings) -> Path | None:
    raw_path = settings.staging_bin or shutil.which(DEFAULT_STAGING_BINARY_NAME)
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
    command: StagingCommand,
    *args: str,
) -> tuple[list[str], StagingInstallation]:
    installation = resolve_staging_installation(settings)
    if installation.bin_path is None:
        raise StagingNotInstalledError(ErrorMessage.STAGING_BINARY_NOT_INSTALLED.value)

    return [str(installation.bin_path), command.value, *args], installation
