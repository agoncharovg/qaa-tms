"""Read-only helpers around `staging e2e-run --list-suites`."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from re import Pattern

from app.core.config import Settings
from app.core.constants import ErrorMessage, Product, StagingCommand, StagingFlag
from app.services.namespaces import PlainTextCommandResult, run_plain_text_command, strip_ansi
from app.services.staging import (
    StagingInstallation,
    StagingNotInstalledError,
    resolve_staging_installation,
)

E2E_SUITES_PLACEHOLDER_NAMESPACE = "qaa-placeholder"
SUITE_ROW_PATTERN: Pattern[str] = re.compile(r"^\s*(?P<name>\S+)\s{2,}(?P<marks>.+?)\s*$")


@dataclass(slots=True)
class ParsedE2eSuite:
    """Best-effort parsed suite row."""

    name: str
    marks: str


@dataclass(slots=True)
class ParsedE2eSuites:
    """Parsed named suite registry for one product."""

    product: Product
    suites: list[ParsedE2eSuite] = field(default_factory=list)


def build_e2e_suites_argv(
    settings: Settings,
    product: Product,
) -> tuple[list[str], StagingInstallation]:
    """Build argv for `staging e2e-run <placeholder> --product <P> --list-suites`."""

    installation = resolve_staging_installation(settings)
    if installation.bin_path is None:
        raise StagingNotInstalledError(ErrorMessage.STAGING_BINARY_NOT_INSTALLED.value)

    return (
        [
            str(installation.bin_path),
            StagingCommand.E2E_RUN.value,
            E2E_SUITES_PLACEHOLDER_NAMESPACE,
            StagingFlag.PRODUCT.value,
            product.value,
            StagingFlag.LIST_SUITES.value,
        ],
        installation,
    )


async def list_e2e_suites(
    settings: Settings,
    product: Product,
) -> tuple[PlainTextCommandResult, ParsedE2eSuites]:
    """Run the suite-registry read and parse its plain-text output."""

    argv, installation = build_e2e_suites_argv(settings, product)
    result = await run_plain_text_command(argv, installation.repo_root)
    return result, parse_e2e_suites(result.raw, product)


def parse_e2e_suites(raw_output: str, product: Product) -> ParsedE2eSuites:
    """Parse named suites from `staging e2e-run --list-suites` output."""

    parsed = ParsedE2eSuites(product=product)
    for raw_line in strip_ansi(raw_output).splitlines():
        line = raw_line.rstrip()
        if not line or line.startswith("Suites for "):
            continue

        match = SUITE_ROW_PATTERN.match(line)
        if match is None:
            continue

        parsed.suites.append(
            ParsedE2eSuite(
                name=match.group("name"),
                marks=match.group("marks"),
            )
        )

    return parsed
