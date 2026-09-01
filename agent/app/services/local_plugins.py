"""Local plugin discovery and asset serving helpers."""

from __future__ import annotations

import mimetypes
import os
from pathlib import Path
from urllib.parse import quote

from pydantic import ValidationError

from app.core.config import Settings
from app.core.constants import AgentPath
from app.schemas import (
    LocalPluginManifestFile,
    LocalPluginRead,
    LocalPluginsResponse,
    LocalPluginWarning,
)

SUPPORTED_CONTRACT_VERSION_MIN = 1
SUPPORTED_CONTRACT_VERSION_MAX = 1
JAVASCRIPT_SUFFIXES = {".js", ".mjs"}


class LocalPluginValidationError(ValueError):
    """Raised when a local plugin directory fails manifest validation."""


def scan_local_plugins(settings: Settings) -> LocalPluginsResponse:
    """Return validated plugin metadata from the configured local-plugins folder."""

    root = _resolve_local_plugins_root(settings)
    if root is None:
        return LocalPluginsResponse()

    plugins: list[LocalPluginRead] = []
    warnings: list[LocalPluginWarning] = []
    seen_ids: set[str] = set()

    for plugin_dir in _iter_plugin_dirs(root):
        try:
            manifest = _read_plugin_manifest(plugin_dir)
        except LocalPluginValidationError as exc:
            warnings.append(LocalPluginWarning(dir=plugin_dir.name, error=str(exc)))
            continue

        if manifest is None:
            continue

        if manifest.id in seen_ids:
            warnings.append(
                LocalPluginWarning(
                    dir=plugin_dir.name,
                    error=f'duplicate plugin id "{manifest.id}"',
                )
            )
            continue

        seen_ids.add(manifest.id)
        plugins.append(
            LocalPluginRead(
                id=manifest.id,
                label=manifest.label,
                icon=manifest.icon,
                route=manifest.route,
                order=manifest.order,
                contract_version=manifest.contract_version,
                requires_agent=manifest.requires_agent,
                entry=manifest.entry,
                entry_url=_build_entry_url(manifest.id, manifest.entry),
                nav_section=manifest.nav_section,
                tabs=list(manifest.tabs),
            )
        )

    plugins.sort(key=lambda plugin: (plugin.order, plugin.id))
    return LocalPluginsResponse(plugins=plugins, warnings=warnings)


def resolve_local_plugin_asset(
    settings: Settings,
    plugin_id: str,
    asset_path: str,
) -> tuple[Path, str | None] | None:
    """Resolve a requested local-plugin asset to a safe on-disk path."""

    plugin_dir = find_local_plugin_dir(settings, plugin_id)
    if plugin_dir is None:
        return None

    try:
        resolved_asset_path = _resolve_path_within_plugin_dir(plugin_dir, asset_path, strict=True)
    except LocalPluginValidationError:
        return None

    if not resolved_asset_path.is_file() or not os.access(resolved_asset_path, os.R_OK):
        return None

    return resolved_asset_path, guess_local_plugin_media_type(resolved_asset_path)


def find_local_plugin_dir(settings: Settings, plugin_id: str) -> Path | None:
    """Find the first valid plugin directory that declares the requested id."""

    root = _resolve_local_plugins_root(settings)
    if root is None:
        return None

    for plugin_dir in _iter_plugin_dirs(root):
        try:
            manifest = _read_plugin_manifest(plugin_dir)
        except LocalPluginValidationError:
            continue
        if manifest is None:
            continue
        if manifest.id == plugin_id:
            return plugin_dir
    return None


def guess_local_plugin_media_type(path: Path) -> str | None:
    """Return a deterministic media type for plugin assets."""

    if path.suffix.lower() in JAVASCRIPT_SUFFIXES:
        return "text/javascript"
    media_type, _ = mimetypes.guess_type(str(path))
    return media_type


def _resolve_local_plugins_root(settings: Settings) -> Path | None:
    local_plugins_dir = settings.local_plugins_dir
    if local_plugins_dir is None:
        return None

    root = Path(local_plugins_dir).expanduser()
    if not root.exists() or not root.is_dir():
        return None
    return root


def _iter_plugin_dirs(root: Path) -> list[Path]:
    try:
        children = sorted(root.iterdir(), key=lambda child: child.name)
    except OSError:
        return []

    plugin_dirs: list[Path] = []
    for child in children:
        try:
            if child.is_dir():
                plugin_dirs.append(child)
        except OSError:
            continue
    return plugin_dirs


def _read_plugin_manifest(plugin_dir: Path) -> LocalPluginManifestFile | None:
    manifest_path = plugin_dir / "plugin.json"
    if not manifest_path.is_file():
        return None

    try:
        manifest = LocalPluginManifestFile.model_validate_json(
            manifest_path.read_text(encoding="utf-8")
        )
    except OSError as exc:
        raise LocalPluginValidationError(f"unable to read plugin.json: {exc}") from exc
    except ValidationError as exc:
        raise LocalPluginValidationError(_format_validation_error(exc)) from exc

    _validate_contract_version(manifest)
    resolved_entry_path = _resolve_path_within_plugin_dir(plugin_dir, manifest.entry, strict=True)
    if not resolved_entry_path.is_file() or not os.access(resolved_entry_path, os.R_OK):
        message = (
            f'path "{manifest.entry}" does not resolve to a readable file '
            "inside the plugin directory"
        )
        raise LocalPluginValidationError(message)
    return manifest


def _validate_contract_version(manifest: LocalPluginManifestFile) -> None:
    version = manifest.contract_version
    if version < SUPPORTED_CONTRACT_VERSION_MIN or version > SUPPORTED_CONTRACT_VERSION_MAX:
        raise LocalPluginValidationError(
            "unsupported contractVersion "
            f"{version}; supported range is "
            f"{SUPPORTED_CONTRACT_VERSION_MIN}-{SUPPORTED_CONTRACT_VERSION_MAX}"
        )


def _resolve_path_within_plugin_dir(plugin_dir: Path, relative_path: str, *, strict: bool) -> Path:
    plugin_root = plugin_dir.resolve()
    try:
        resolved_path = (plugin_root / relative_path).resolve(strict=strict)
    except OSError as exc:
        message = (
            f'path "{relative_path}" does not resolve to a readable file '
            "inside the plugin directory"
        )
        raise LocalPluginValidationError(message) from exc

    try:
        resolved_path.relative_to(plugin_root)
    except ValueError as exc:
        raise LocalPluginValidationError(
            f'path "{relative_path}" escapes the plugin directory'
        ) from exc

    return resolved_path


def _build_entry_url(plugin_id: str, entry: str) -> str:
    return f"{AgentPath.PLUGINS.value}/{quote(plugin_id, safe='')}/assets/{quote(entry, safe='/')}"


def _format_validation_error(error: ValidationError) -> str:
    messages: list[str] = []
    for entry in error.errors():
        location = ".".join(str(part) for part in entry["loc"])
        messages.append(f"{location}: {entry['msg']}")
    return "; ".join(messages) if messages else str(error)
