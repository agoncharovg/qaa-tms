"""Read-only preflight checks."""

from __future__ import annotations

import asyncio
import contextlib
import json
import shutil
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

from app.core.config import Settings
from app.core.constants import (
    DEFAULT_COMMAND_TIMEOUT_SECONDS,
    HTTPS_PORT,
    DockerRegistry,
    KubeconfigReason,
    PreflightKey,
    RequiredTool,
    VpnProbeHost,
)
from app.schemas import KubeconfigStatus, PreflightItem
from app.services.kubeconfig import read_status
from app.services.staging import StagingInstallation, resolve_staging_installation


class KubeconfigPreflightMessage:
    HEALTHY = "Staging kubeconfig is fresh and valid."
    HOW_TO = "Use the Stagings kubeconfig banner to refresh and activate the staging kubeconfig."
    PREFIX = "Staging kubeconfig status:"


KUBECONFIG_REASON_DETAIL = {
    KubeconfigReason.MISSING: "missing",
    KubeconfigReason.CONTENT_INVALID: "invalid content",
    KubeconfigReason.TOKEN_EXPIRED: "token expired",
    KubeconfigReason.STALE: "stale",
    KubeconfigReason.NOT_ACTIVE: "not the active kubeconfig",
    KubeconfigReason.HEALTHY: "healthy",
}


@dataclass(slots=True)
class CommandResult:
    """Simplified subprocess result."""

    returncode: int
    stdout: str
    stderr: str


async def collect_preflight(settings: Settings) -> list[PreflightItem]:
    """Return the full 10-item preflight checklist."""

    installation = resolve_staging_installation(settings)
    docker_auths = _read_docker_auths()
    docker_harbor = await _safe_check(
        PreflightKey.DOCKER_HARBOR,
        lambda: _check_docker_auth(DockerRegistry.HARBOR, docker_auths),
    )

    checks: list[Callable[[], Awaitable[PreflightItem]]] = [
        _check_tools,
        lambda: _check_cluster_reachable(_kubeconfig_path(settings)),
        _check_vpn,
        lambda: _check_kubeconfig(settings),
        lambda: _check_docker_auth(DockerRegistry.HARBOR, docker_auths),
        lambda: _check_docker_auth(DockerRegistry.STAGING, docker_auths),
        lambda: _check_harbor_pull(docker_harbor.ok),
        lambda: _check_submodules(installation),
        lambda: _check_venv(installation),
        lambda: _check_repo_installed(installation),
    ]
    keys = [
        PreflightKey.TOOLS,
        PreflightKey.CLUSTER_REACHABLE,
        PreflightKey.VPN,
        PreflightKey.KUBECONFIG,
        PreflightKey.DOCKER_HARBOR,
        PreflightKey.DOCKER_STAGING,
        PreflightKey.HARBOR_PULL,
        PreflightKey.SUBMODULES,
        PreflightKey.VENV,
        PreflightKey.REPO_INSTALLED,
    ]
    return [await _safe_check(key, check) for key, check in zip(keys, checks, strict=True)]


async def _safe_check(
    key: PreflightKey,
    factory: Callable[[], Awaitable[PreflightItem]],
) -> PreflightItem:
    try:
        return await factory()
    except Exception as exc:
        return PreflightItem(
            key=key,
            ok=False,
            detail=f"Preflight check failed unexpectedly: {exc}",
            how_to="Retry after checking your local staging setup.",
        )


async def _check_tools() -> PreflightItem:
    found: list[str] = []
    missing: list[str] = []
    for tool in RequiredTool:
        if shutil.which(tool.value):
            found.append(tool.value)
        else:
            missing.append(tool.value)
    ok = not missing
    detail = (
        f"Found required tools: {', '.join(found)}."
        if ok
        else f"Missing required tools: {', '.join(missing)}."
    )
    return PreflightItem(
        key=PreflightKey.TOOLS,
        ok=ok,
        detail=detail,
        how_to="Install python3, kubectl, kustomize, docker, and git, then rerun preflight.",
    )


async def _check_cluster_reachable(kubeconfig_path: Path) -> PreflightItem:
    kubectl = shutil.which(RequiredTool.KUBECTL.value)
    if kubectl is None:
        return PreflightItem(
            key=PreflightKey.CLUSTER_REACHABLE,
            ok=False,
            detail="kubectl is not installed, so the cluster cannot be checked.",
            how_to="Install kubectl and ensure your kubeconfig file is available.",
        )

    result = await _run_command(
        [kubectl, "--kubeconfig", str(kubeconfig_path), "cluster-info"],
        timeout=DEFAULT_COMMAND_TIMEOUT_SECONDS,
    )
    ok = result is not None and result.returncode == 0
    detail = (
        "kubectl cluster-info succeeded."
        if ok
        else "kubectl cluster-info did not succeed. Full VPN or a fresh kubeconfig may be missing."
    )
    return PreflightItem(
        key=PreflightKey.CLUSTER_REACHABLE,
        ok=ok,
        detail=detail,
        how_to="Connect Full VPN and re-download ~/.kube/ai-staging.yaml if access has expired.",
    )


async def _check_vpn() -> PreflightItem:
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(VpnProbeHost.FULL_VPN_ONLY.value, HTTPS_PORT),
            timeout=DEFAULT_COMMAND_TIMEOUT_SECONDS,
        )
        del reader
        writer.close()
        await writer.wait_closed()
        ok = True
        detail = "A Full-VPN-only host is reachable."
    except Exception:
        ok = False
        detail = "A Full-VPN-only host is not reachable."
    return PreflightItem(
        key=PreflightKey.VPN,
        ok=ok,
        detail=detail,
        how_to="Connect Full VPN before using staging operations.",
    )


async def _check_kubeconfig(settings: Settings) -> PreflightItem:
    status = read_status(settings)
    detail = _format_kubeconfig_detail(status)
    return PreflightItem(
        key=PreflightKey.KUBECONFIG,
        ok=status.healthy,
        detail=detail,
        how_to=KubeconfigPreflightMessage.HOW_TO,
    )


async def _check_docker_auth(
    registry: DockerRegistry,
    docker_auths: dict[str, object],
) -> PreflightItem:
    ok = registry.value in docker_auths
    detail = (
        f"Docker login for {registry.value} is present."
        if ok
        else f"Docker login for {registry.value} is missing."
    )
    return PreflightItem(
        key=PreflightKey.DOCKER_HARBOR
        if registry is DockerRegistry.HARBOR
        else PreflightKey.DOCKER_STAGING,
        ok=ok,
        detail=detail,
        how_to=f"Run: docker login {registry.value}",
    )


async def _check_harbor_pull(docker_harbor_ok: bool) -> PreflightItem:
    detail = (
        "Harbor login is present. Pull access still depends on your Harbor project grants."
        if docker_harbor_ok
        else "Harbor login is missing, so pull access cannot be confirmed yet."
    )
    return PreflightItem(
        key=PreflightKey.HARBOR_PULL,
        ok=docker_harbor_ok,
        detail=detail,
        how_to=(
            "Request Harbor Pull access for the platform, billing, cdn, "
            "and frontend projects if needed."
        ),
    )


async def _check_submodules(installation: StagingInstallation) -> PreflightItem:
    if installation.repo_root is None:
        return PreflightItem(
            key=PreflightKey.SUBMODULES,
            ok=False,
            detail="The qaa-stagings repo root could not be resolved.",
            how_to="Install qaa-stagings and initialize the base/* submodules.",
        )

    result = await _run_command(
        ["git", "-C", str(installation.repo_root), "submodule", "status"],
        timeout=DEFAULT_COMMAND_TIMEOUT_SECONDS,
    )
    if result is None or result.returncode != 0:
        return PreflightItem(
            key=PreflightKey.SUBMODULES,
            ok=False,
            detail="git submodule status did not succeed.",
            how_to="Run git submodule update --init for the required base/* repositories.",
        )

    base_lines = [line for line in result.stdout.splitlines() if " base/" in line]
    if not base_lines:
        return PreflightItem(
            key=PreflightKey.SUBMODULES,
            ok=False,
            detail="No base/* submodules were reported.",
            how_to="Run git submodule update --init for the required base/* repositories.",
        )

    missing = [line for line in base_lines if line.startswith("-")]
    ok = not missing
    detail = (
        "All base/* submodules are initialized."
        if ok
        else "Some base/* submodules are not initialized."
    )
    return PreflightItem(
        key=PreflightKey.SUBMODULES,
        ok=ok,
        detail=detail,
        how_to=(
            "Run git submodule update --init base/iam-api base/billing-deploy "
            "base/cdn-be-deploy base/frontend-deploy base/platform-notifier"
        ),
    )


async def _check_venv(installation: StagingInstallation) -> PreflightItem:
    venv_path = installation.repo_root / "scripts" / ".venv" if installation.repo_root else None
    ok = venv_path is not None and venv_path.exists()
    detail = f"Virtualenv exists at {venv_path}." if ok else "scripts/.venv is missing."
    return PreflightItem(
        key=PreflightKey.VENV,
        ok=ok,
        detail=detail,
        how_to="Run make install in the qaa-stagings repo to create scripts/.venv and helpers.",
    )


async def _check_repo_installed(installation: StagingInstallation) -> PreflightItem:
    ok = installation.installed
    detail = (
        f"staging resolves to {installation.bin_path}."
        if ok
        else "The staging executable is not installed."
    )
    return PreflightItem(
        key=PreflightKey.REPO_INSTALLED,
        ok=ok,
        detail=detail,
        how_to="Clone qaa-stagings, run make install, or set AGENT_STAGING_BIN explicitly.",
    )


def _format_kubeconfig_detail(status: KubeconfigStatus) -> str:
    if status.reasons == [KubeconfigReason.HEALTHY]:
        return KubeconfigPreflightMessage.HEALTHY

    detail_parts = [
        f"{KubeconfigPreflightMessage.PREFIX} "
        + ", ".join(KUBECONFIG_REASON_DETAIL[reason] for reason in status.reasons)
        + "."
    ]
    if status.modified_at is not None and status.age_seconds is not None:
        detail_parts.append(
            "Last modified at "
            f"{status.modified_at.isoformat()} "
            f"({status.age_seconds}s old; max {status.max_age_seconds}s)."
        )
    if status.token_expires_at is not None:
        detail_parts.append(f"Token expires at {status.token_expires_at.isoformat()}.")
    return " ".join(detail_parts)


def _kubeconfig_path(settings: Settings) -> Path:
    return Path(settings.staging_kubeconfig).expanduser()


def _read_docker_auths() -> dict[str, object]:
    docker_config_path = Path.home() / ".docker" / "config.json"
    if not docker_config_path.exists():
        return {}
    try:
        data = json.loads(docker_config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    auths = data.get("auths", {})
    return auths if isinstance(auths, dict) else {}


async def _run_command(argv: list[str], timeout: float) -> CommandResult | None:
    try:
        process = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except (FileNotFoundError, OSError):
        return None

    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except TimeoutError:
        process.kill()
        with contextlib.suppress(ProcessLookupError):
            await process.wait()
        return None

    if process.returncode is None:
        return None

    return CommandResult(
        returncode=process.returncode,
        stdout=stdout_bytes.decode("utf-8", errors="replace"),
        stderr=stderr_bytes.decode("utf-8", errors="replace"),
    )
