from pathlib import Path

BACKEND_ORIGIN_PLACEHOLDER = "__BACKEND_ORIGIN__"
_TEMPLATE_PATH = Path(__file__).resolve().parent / "resources" / "agent-install.sh.tmpl"


def render_install_script(origin: str) -> str:
    template = _TEMPLATE_PATH.read_text(encoding="utf-8")
    return template.replace(BACKEND_ORIGIN_PLACEHOLDER, origin.rstrip("/"))
