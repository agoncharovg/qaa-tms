"""Jenkins path helpers."""

from urllib.parse import unquote


def normalize_jenkins_path(path: str) -> str:
    return unquote(path).strip("/")
