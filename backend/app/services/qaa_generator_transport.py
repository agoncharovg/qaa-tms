"""qaa-generator transport helpers."""

from __future__ import annotations

import socket
import subprocess
import time
from contextlib import AbstractContextManager
from dataclasses import dataclass
from enum import StrEnum
from types import TracebackType

from app.core.config import Settings
from app.core.constants import ApiPrefix

PORT_FORWARD_POLL_INTERVAL_SECONDS = 0.1
PORT_FORWARD_LOCAL_CHECK_TIMEOUT_SECONDS = 0.2
PORT_FORWARD_TERMINATE_TIMEOUT_SECONDS = 2.0


class QaaGeneratorTransportError(RuntimeError):
    """Raised when the local qaa-generator transport cannot be prepared."""


class KubectlArg(StrEnum):
    EXECUTABLE = "kubectl"
    NAMESPACE_FLAG = "-n"
    PORT_FORWARD = "port-forward"


class QaaGeneratorLoopback(StrEnum):
    HOST = "127.0.0.1"
    HTTP_SCHEME = "http"


class QaaGeneratorTransportMessage(StrEnum):
    EARLY_EXIT = "kubectl port-forward exited early"
    TIMEOUT_PREFIX = "Timed out waiting for kubectl port-forward on"


@dataclass(frozen=True)
class QaaGeneratorPortForwardSettings:
    namespace: str
    resource: str
    local_port: int
    remote_port: int


@dataclass(frozen=True)
class QaaGeneratorRuntime:
    base_url: str
    port_forward: QaaGeneratorPortForwardSettings | None


class QaaGeneratorPortForwardProcess(AbstractContextManager["QaaGeneratorPortForwardProcess"]):
    def __init__(
        self,
        settings: QaaGeneratorPortForwardSettings,
        *,
        timeout_seconds: float,
    ) -> None:
        self.settings = settings
        self.timeout_seconds = timeout_seconds
        self.process: subprocess.Popen[str] | None = None

    def __enter__(self) -> QaaGeneratorPortForwardProcess:
        port_mapping = f"{self.settings.local_port}:{self.settings.remote_port}"
        argv = [
            KubectlArg.EXECUTABLE.value,
            KubectlArg.PORT_FORWARD.value,
            KubectlArg.NAMESPACE_FLAG.value,
            self.settings.namespace,
            self.settings.resource,
            port_mapping,
        ]
        try:
            self.process = subprocess.Popen(
                argv,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
        except OSError as exc:
            raise QaaGeneratorTransportError(str(exc)) from exc
        self._wait_until_ready()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        if self.process is None:
            return
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=PORT_FORWARD_TERMINATE_TIMEOUT_SECONDS)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=PORT_FORWARD_TERMINATE_TIMEOUT_SECONDS)

    def _wait_until_ready(self) -> None:
        deadline = time.monotonic() + self.timeout_seconds
        while time.monotonic() < deadline:
            process = self.process
            assert process is not None
            if process.poll() is not None:
                output = ""
                if process.stdout is not None:
                    output = process.stdout.read()
                message = output.strip() or QaaGeneratorTransportMessage.EARLY_EXIT.value
                raise QaaGeneratorTransportError(message)
            if self._local_port_is_open():
                return
            time.sleep(PORT_FORWARD_POLL_INTERVAL_SECONDS)
        raise QaaGeneratorTransportError(
            f"{QaaGeneratorTransportMessage.TIMEOUT_PREFIX.value} "
            f"{QaaGeneratorLoopback.HOST.value}:{self.settings.local_port}"
        )

    def _local_port_is_open(self) -> bool:
        try:
            with socket.create_connection(
                (QaaGeneratorLoopback.HOST.value, self.settings.local_port),
                timeout=PORT_FORWARD_LOCAL_CHECK_TIMEOUT_SECONDS,
            ):
                return True
        except OSError:
            return False


def build_port_forward_base_url(local_port: int) -> str:
    return (
        f"{QaaGeneratorLoopback.HTTP_SCHEME.value}://"
        f"{QaaGeneratorLoopback.HOST.value}:{local_port}{ApiPrefix.V1.value}"
    )


def resolve_direct_qaa_generator_runtime(settings: Settings) -> QaaGeneratorRuntime:
    return QaaGeneratorRuntime(base_url=settings.qaa_generator_base_url, port_forward=None)


def resolve_qaa_generator_runtime(settings: Settings) -> QaaGeneratorRuntime:
    if not settings.qaa_generator_port_forward_enabled:
        return resolve_direct_qaa_generator_runtime(settings)

    port_forward = QaaGeneratorPortForwardSettings(
        namespace=settings.qaa_generator_port_forward_namespace,
        resource=settings.qaa_generator_port_forward_resource,
        local_port=settings.qaa_generator_port_forward_local_port,
        remote_port=settings.qaa_generator_port_forward_remote_port,
    )
    return QaaGeneratorRuntime(
        base_url=build_port_forward_base_url(port_forward.local_port),
        port_forward=port_forward,
    )
