"""Read-only helpers around `staging` namespace commands."""

from __future__ import annotations

import re
import shlex
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from re import Pattern

from app.core.config import Settings
from app.core.constants import MAX_STAGE, MIN_STAGE, ErrorMessage, StagingFlag
from app.services.command import PlainTextCommandResult, run_plain_text_command, strip_ansi
from app.services.sse import stream_process_log_frames
from app.services.staging import (
    StagingInstallation,
    StagingNotInstalledError,
    resolve_staging_installation,
)


class NamespaceCommand(StrEnum):
    """Supported staging namespace subcommands."""

    LIST = "list"
    STATUS = "status"
    CREDS = "creds"
    LOGS = "logs"


@dataclass(slots=True)
class ClusterNamespaceRow:
    """Best-effort parsed cluster namespace row."""

    name: str
    status: str
    created_at: str | None = None
    has_local_overlay: bool = False


@dataclass(slots=True)
class LocalOverlayRow:
    """Best-effort parsed local overlay row."""

    name: str


@dataclass(slots=True)
class RecordedDeployRecipe:
    """Parsed deploy recipe reconstructed from a local deploy log."""

    ns: str
    services: list[str] = field(default_factory=list)
    images: dict[str, str] = field(default_factory=dict)
    clean: bool = False
    full: bool = False
    dry_run: bool = False
    no_sync: bool = False
    stage: int | None = None


@dataclass(slots=True)
class ParsedNamespaceList:
    """Structured `staging list` parse result."""

    cluster_namespaces: list[ClusterNamespaceRow] = field(default_factory=list)
    local_overlays: list[LocalOverlayRow] = field(default_factory=list)


class NamespaceListSection(StrEnum):
    """Active parser section for `staging list`."""

    CLUSTER = "cluster"
    LOCAL = "local"


CLUSTER_SECTION_PATTERN: Pattern[str] = re.compile(
    r"provisioned\s+namespaces.*cluster:",
    re.IGNORECASE,
)
LOCAL_SECTION_PATTERN: Pattern[str] = re.compile(
    r"local\s+overlay\s+directories:",
    re.IGNORECASE,
)


def build_namespace_list_argv(settings: Settings) -> tuple[list[str], StagingInstallation]:
    """Build argv for `staging list`."""

    return _build_namespace_argv(settings, NamespaceCommand.LIST)


def build_namespace_status_argv(
    settings: Settings,
    namespace: str,
) -> tuple[list[str], StagingInstallation]:
    """Build argv for `staging status <ns>`."""

    return _build_namespace_argv(settings, NamespaceCommand.STATUS, namespace)


def build_namespace_creds_argv(
    settings: Settings,
    namespace: str,
) -> tuple[list[str], StagingInstallation]:
    """Build argv for `staging creds <ns>`."""

    return _build_namespace_argv(settings, NamespaceCommand.CREDS, namespace)


def build_namespace_logs_argv(
    settings: Settings,
    namespace: str,
    deploy: str,
) -> tuple[list[str], StagingInstallation]:
    """Build argv for `staging logs <ns> <deploy>`."""

    return _build_namespace_argv(settings, NamespaceCommand.LOGS, namespace, deploy)


async def list_namespaces(settings: Settings) -> tuple[PlainTextCommandResult, ParsedNamespaceList]:
    """Run `staging list` and parse the labeled cluster/local sections."""

    argv, installation = build_namespace_list_argv(settings)
    result = await run_plain_text_command(argv, installation.repo_root)
    parsed = parse_namespace_list(result.raw)
    attach_local_overlay_flags(parsed, installation.repo_root)
    return result, parsed


async def read_namespace_status(settings: Settings, namespace: str) -> PlainTextCommandResult:
    """Run `staging status <ns>`."""

    argv, installation = build_namespace_status_argv(settings, namespace)
    return await run_plain_text_command(argv, installation.repo_root)


async def read_namespace_creds(settings: Settings, namespace: str) -> PlainTextCommandResult:
    """Run `staging creds <ns>`."""

    argv, installation = build_namespace_creds_argv(settings, namespace)
    return await run_plain_text_command(argv, installation.repo_root)


async def read_namespace_deploy_recipe(settings: Settings, namespace: str) -> RecordedDeployRecipe:
    """Read the latest supported local deploy recipe for an overlay namespace."""

    installation = resolve_staging_installation(settings)
    if installation.bin_path is None:
        raise StagingNotInstalledError(ErrorMessage.STAGING_BINARY_NOT_INSTALLED.value)
    if installation.repo_root is None:
        raise StagingNotInstalledError("The staging repository is not installed.")

    overlay_dir = installation.repo_root / "overlays" / namespace
    if not overlay_dir.is_dir():
        raise FileNotFoundError(f"No recorded deploy recipe was found for {namespace}.")

    for log_path in sorted(overlay_dir.glob("deploy-*.log"), reverse=True):
        recipe = parse_recorded_deploy_recipe(log_path, namespace)
        if recipe is not None:
            return recipe

    raise FileNotFoundError(f"No recorded deploy recipe was found for {namespace}.")


def stream_namespace_logs(
    settings: Settings,
    namespace: str,
    deploy: str,
    *,
    is_disconnected: Callable[[], Awaitable[bool]],
) -> AsyncIterator[str]:
    """Stream `staging logs` in the shared SSE frame format."""

    argv, installation = build_namespace_logs_argv(settings, namespace, deploy)
    repo_root = installation.repo_root

    return stream_process_log_frames(argv, repo_root, is_disconnected=is_disconnected)


def parse_namespace_list(raw_output: str) -> ParsedNamespaceList:
    """Split `staging list` output into cluster namespaces and local overlays."""

    parsed = ParsedNamespaceList()
    section: NamespaceListSection | None = None

    for raw_line in strip_ansi(raw_output).splitlines():
        line = raw_line.strip()
        if not line:
            continue

        if CLUSTER_SECTION_PATTERN.search(line):
            section = NamespaceListSection.CLUSTER
            continue
        if LOCAL_SECTION_PATTERN.search(line):
            section = NamespaceListSection.LOCAL
            continue
        if section is NamespaceListSection.CLUSTER:
            cluster_row = parse_cluster_namespace_row(line)
            if cluster_row is not None:
                parsed.cluster_namespaces.append(cluster_row)
            continue
        if section is NamespaceListSection.LOCAL:
            local_row = parse_local_overlay_row(line)
            if local_row is not None:
                parsed.local_overlays.append(local_row)

    return parsed


def parse_cluster_namespace_row(line: str) -> ClusterNamespaceRow | None:
    """Parse a single cluster namespace row."""

    parts = line.split()
    if len(parts) < 2:
        return None
    name = parts[0]
    status = parts[1]
    created_at = parts[2] if len(parts) >= 3 else None
    return ClusterNamespaceRow(name=name, status=status, created_at=created_at)


def parse_local_overlay_row(line: str) -> LocalOverlayRow | None:
    """Parse a single local overlay row."""

    parts = line.split()
    if not parts:
        return None
    return LocalOverlayRow(name=parts[0])


def parse_recorded_deploy_recipe(log_path: Path, namespace: str) -> RecordedDeployRecipe | None:
    """Extract a supported deploy recipe from a recorded overlay deploy log."""

    try:
        raw_output = log_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None

    for raw_line in raw_output.splitlines():
        line = raw_line.strip()
        if line.startswith("Command:"):
            return parse_recorded_deploy_command(line.removeprefix("Command:").strip(), namespace)

    return None


def parse_recorded_deploy_command(
    command: str,
    expected_namespace: str,
) -> RecordedDeployRecipe | None:
    """Parse a `deploy.py` command line captured in a deploy log header."""

    try:
        tokens = shlex.split(command)
    except ValueError:
        return None

    args = extract_recorded_deploy_args(tokens)
    if not args:
        return None

    namespace = args[0].strip()
    if not namespace or namespace != expected_namespace:
        return None

    recipe = RecordedDeployRecipe(ns=namespace)
    index = 1
    while index < len(args):
        token = args[index]
        if token == StagingFlag.SERVICES:
            if index + 1 >= len(args):
                return None
            recipe.services = [
                service.strip() for service in args[index + 1].split(",") if service.strip()
            ]
            index += 2
            continue
        if token == StagingFlag.IMAGE:
            if index + 1 >= len(args):
                return None
            image_spec = args[index + 1]
            if "=" not in image_spec:
                return None
            service, tag = image_spec.split("=", 1)
            service = service.strip()
            tag = tag.strip()
            if not service or not tag:
                return None
            recipe.images[service] = tag
            index += 2
            continue
        if token == StagingFlag.CLEAN:
            recipe.clean = True
            index += 1
            continue
        if token == StagingFlag.FULL:
            recipe.full = True
            index += 1
            continue
        if token == StagingFlag.DRY_RUN:
            recipe.dry_run = True
            index += 1
            continue
        if token == StagingFlag.NO_SYNC:
            recipe.no_sync = True
            index += 1
            continue
        if token == StagingFlag.STAGE:
            if index + 1 >= len(args):
                return None
            try:
                stage = int(args[index + 1])
            except ValueError:
                return None
            if stage < MIN_STAGE or stage > MAX_STAGE:
                return None
            recipe.stage = stage
            index += 2
            continue
        return None

    return recipe


def extract_recorded_deploy_args(tokens: list[str]) -> list[str] | None:
    """Return deploy arguments that follow the recorded `deploy.py` script token."""

    for index in range(len(tokens) - 1, -1, -1):
        if Path(tokens[index]).name == "deploy.py":
            remaining = tokens[index + 1 :]
            return remaining or None
    return None


def attach_local_overlay_flags(parsed: ParsedNamespaceList, repo_root: Path | None) -> None:
    """Mark cluster namespaces that have a matching local overlay directory."""

    overlay_names = read_overlay_names(repo_root)
    for entry in parsed.cluster_namespaces:
        entry.has_local_overlay = entry.name in overlay_names


def read_overlay_names(repo_root: Path | None) -> set[str]:
    """Read local overlay directory names from the staging repo."""

    if repo_root is None:
        return set()

    overlays_dir = repo_root / "overlays"
    if not overlays_dir.is_dir():
        return set()

    return {path.name for path in overlays_dir.iterdir() if path.is_dir()}


def _build_namespace_argv(
    settings: Settings,
    command: NamespaceCommand,
    *args: str,
) -> tuple[list[str], StagingInstallation]:
    installation = resolve_staging_installation(settings)
    if installation.bin_path is None:
        raise StagingNotInstalledError(ErrorMessage.STAGING_BINARY_NOT_INSTALLED.value)

    return [str(installation.bin_path), command.value, *args], installation
