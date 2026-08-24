"""Helpers for the detached self-update workflow."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from app.core.constants import ErrorMessage

UPDATE_FORCE_FLAG = "--force"
UPDATE_HELPER_NAME = "update.sh"
SERVICE_MANAGED_ENV_VAR = "QAA_TMS_AGENT_SERVICE_MANAGED"


class UpdateUnsupportedError(RuntimeError):
    """Raised when self-update is unavailable in the current runtime mode."""


def resolve_install_dir() -> Path:
    """Return the repository root that contains the runtime scripts."""

    return Path(__file__).resolve().parents[2]


def resolve_update_helper_path() -> Path:
    """Resolve the update helper script inside the install dir."""

    return resolve_install_dir() / UPDATE_HELPER_NAME


def is_service_managed_runtime() -> bool:
    """Return whether the agent was started through the managed run.sh entrypoint."""

    return os.environ.get(SERVICE_MANAGED_ENV_VAR) == "1"


def spawn_update_helper() -> None:
    """Spawn the detached update helper outside the serving process."""

    if not is_service_managed_runtime():
        raise UpdateUnsupportedError(ErrorMessage.UPDATE_UNSUPPORTED_IN_SOURCE_RUN.value)

    helper_path = resolve_update_helper_path()
    if not helper_path.is_file():
        raise FileNotFoundError(ErrorMessage.UPDATE_HELPER_NOT_AVAILABLE.value)

    install_dir = resolve_install_dir()
    with open(os.devnull, "wb") as devnull:
        subprocess.Popen(  # noqa: S603
            ["bash", str(helper_path), UPDATE_FORCE_FLAG],
            cwd=install_dir,
            stdout=devnull,
            stderr=devnull,
            start_new_session=True,
        )
