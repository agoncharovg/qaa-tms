from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from app.core.constants import AgentPath


def configure_local_plugins_dir(client: httpx.AsyncClient, path: Path | None) -> None:
    client._transport.app.state.settings.local_plugins_dir = None if path is None else str(path)


def write_plugin(
    root: Path,
    directory_name: str,
    *,
    plugin_id: str,
    label: str,
    route: str | None = None,
    manifest_overrides: dict[str, object] | None = None,
    bundle_source: str = "export default {};\n",
) -> Path:
    plugin_dir = root / directory_name
    dist_dir = plugin_dir / "dist"
    dist_dir.mkdir(parents=True, exist_ok=True)
    (dist_dir / "index.js").write_text(bundle_source, encoding="utf-8")
    manifest = {
        "id": plugin_id,
        "label": label,
        "icon": "notebook",
        "route": route or f"/{plugin_id}",
        "order": 10,
        "contractVersion": 1,
        "requiresAgent": True,
        "entry": "dist/index.js",
        "tabs": [
            {
                "id": f"{plugin_id}-main",
                "title": "Main",
                "viewKey": f"{plugin_id}-main",
            }
        ],
    }
    if manifest_overrides:
        manifest.update(manifest_overrides)
    (plugin_dir / "plugin.json").write_text(json.dumps(manifest), encoding="utf-8")
    return plugin_dir


@pytest.mark.asyncio
async def test_plugins_route_returns_empty_for_missing_local_plugins_dir(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    tmp_path: Path,
) -> None:
    configure_local_plugins_dir(client, tmp_path / "missing")

    response = await client.get(AgentPath.PLUGINS.value, headers=auth_headers)

    assert response.status_code == 200
    assert response.json() == {"plugins": [], "warnings": []}


@pytest.mark.asyncio
async def test_plugins_route_returns_valid_plugin_metadata(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    tmp_path: Path,
) -> None:
    configure_local_plugins_dir(client, tmp_path)
    write_plugin(tmp_path, "notebook", plugin_id="notebook", label="Notebook")

    response = await client.get(AgentPath.PLUGINS.value, headers=auth_headers)

    assert response.status_code == 200
    assert response.json() == {
        "plugins": [
            {
                "id": "notebook",
                "label": "Notebook",
                "icon": "notebook",
                "route": "/notebook",
                "order": 10,
                "contractVersion": 1,
                "requiresAgent": True,
                "entry": "dist/index.js",
                "entryUrl": "/plugins/notebook/assets/dist/index.js",
                "navSection": None,
                "tabs": [
                    {
                        "id": "notebook-main",
                        "title": "Main",
                        "viewKey": "notebook-main",
                    }
                ],
            }
        ],
        "warnings": [],
    }


@pytest.mark.asyncio
async def test_plugins_route_skips_invalid_plugin_json_and_reports_warning(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    tmp_path: Path,
) -> None:
    configure_local_plugins_dir(client, tmp_path)
    write_plugin(tmp_path, "valid-plugin", plugin_id="valid-plugin", label="Valid plugin")
    write_plugin(
        tmp_path,
        "invalid-plugin",
        plugin_id="invalid-plugin",
        label="Invalid plugin",
        manifest_overrides={"route": "invalid-plugin"},
    )

    response = await client.get(AgentPath.PLUGINS.value, headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert [plugin["id"] for plugin in body["plugins"]] == ["valid-plugin"]
    assert body["warnings"] == [
        {
            "dir": "invalid-plugin",
            "error": "route: Value error, route must start with '/'.",
        }
    ]


@pytest.mark.asyncio
async def test_plugins_route_skips_later_duplicate_plugin_id(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    tmp_path: Path,
) -> None:
    configure_local_plugins_dir(client, tmp_path)
    write_plugin(tmp_path, "alpha", plugin_id="shared", label="Alpha")
    write_plugin(tmp_path, "beta", plugin_id="shared", label="Beta")

    response = await client.get(AgentPath.PLUGINS.value, headers=auth_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["plugins"] == [
        {
            "id": "shared",
            "label": "Alpha",
            "icon": "notebook",
            "route": "/shared",
            "order": 10,
            "contractVersion": 1,
            "requiresAgent": True,
            "entry": "dist/index.js",
            "entryUrl": "/plugins/shared/assets/dist/index.js",
            "navSection": None,
            "tabs": [
                {
                    "id": "shared-main",
                    "title": "Main",
                    "viewKey": "shared-main",
                }
            ],
        }
    ]
    assert body["warnings"] == [{"dir": "beta", "error": 'duplicate plugin id "shared"'}]


@pytest.mark.asyncio
async def test_plugin_asset_route_serves_files_and_rejects_traversal(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    tmp_path: Path,
) -> None:
    configure_local_plugins_dir(client, tmp_path)
    write_plugin(
        tmp_path,
        "demo",
        plugin_id="demo",
        label="Demo",
        bundle_source='console.log("demo");\n',
    )
    (tmp_path / "secret.js").write_text('console.log("secret");\n', encoding="utf-8")

    asset_response = await client.get(
        f"{AgentPath.PLUGINS.value}/demo/assets/dist/index.js",
        headers=auth_headers,
    )
    traversal_response = await client.get(
        f"{AgentPath.PLUGINS.value}/demo/assets/dist/%2E%2E/%2E%2E/secret.js",
        headers=auth_headers,
    )

    assert asset_response.status_code == 200
    assert asset_response.text == 'console.log("demo");\n'
    assert asset_response.headers["content-type"].startswith("text/javascript")
    assert traversal_response.status_code == 404
