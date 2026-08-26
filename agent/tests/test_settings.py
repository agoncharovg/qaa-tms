from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from app.core import env_file
from app.core.config import get_settings


def write_agent_env(path: Path) -> None:
    path.write_text(
        "\n".join(
            [
                "AGENT_JENKINS_URL=https://initial.jenkins",
                "AGENT_JENKINS_USERNAME=initial-user",
                "AGENT_JENKINS_TOKEN=initial-token",
                "AGENT_LLM_ANTHROPIC_KEY=initial-anthropic-key",
                "AGENT_LLM_OPENAI_KEY=initial-openai-key",
                (
                    "AGENT_LLM_MODELS="
                    '[{"label":"Claude","provider":"anthropic","model_id":"claude-sonnet","params":{"max_tokens":1024}}]'
                ),
                "AGENT_QAA_GENERATOR_TOKEN=initial-qaa-token",
                "AGENT_JENKINS_ROOT_GROUPS=BE=job/.QAA/job/E2E,FE=job/.QAA/job/UI_E2E",
                "AGENT_JENKINS_ROOT_FOLDERS=PREPROD,PROD",
                "AGENT_JENKINS_HISTORY_LIMIT=8",
                "AGENT_JENKINS_REQUEST_TIMEOUT=15",
                "AGENT_JENKINS_TREE_DEPTH=5",
                "AGENT_JENKINS_STUCK_MIN_IDLE_HOURS=6",
                "AGENT_STAGING_BIN=/usr/local/bin/staging",
                "AGENT_STAGINGS_REPO=/tmp/stagings",
                "STAGING_KUBECONFIG=~/.kube/ai-staging.yaml",
                "AGENT_NOTEBOOK_ROOT=~/qaa-notebook",
                "AGENT_STAGING_KUBECONFIG_URL=https://kubeconf.example/config",
                "AGENT_KUBECONFIG_ACTIVE_PATH=~/.kube/config",
                "AGENT_STAGING_KUBECONFIG_MAX_AGE_HOURS=48",
                "AGENT_KUBECTL_BIN=kubectl",
                "AGENT_KUBECONFIG=",
                "AGENT_KUBECTL_REQUEST_TIMEOUT=10s",
                "",
            ]
        ),
        encoding="utf-8",
    )


@pytest.mark.asyncio
async def test_settings_routes_require_auth(client: httpx.AsyncClient) -> None:
    response = await client.get("/settings")

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_and_put_settings_mask_tokens_round_trip_lists_and_refresh_runtime(
    client: httpx.AsyncClient,
    auth_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    env_path = tmp_path / ".env"
    write_agent_env(env_path)
    monkeypatch.setattr(env_file, "AGENT_ENV_FILE", env_path)
    get_settings.cache_clear()
    initial_settings = get_settings()
    client._transport.app.state.settings = initial_settings
    client._transport.app.state.job_manager._settings = initial_settings

    get_response = await client.get("/settings", headers=auth_headers)

    assert get_response.status_code == 200
    body = get_response.json()
    assert body["jenkins_token_set"] is True
    assert body["llm_anthropic_key_set"] is True
    assert body["llm_openai_key_set"] is True
    assert body["llm_models"] == (
        '[{"label":"Claude","provider":"anthropic","model_id":"claude-sonnet","params":{"max_tokens":1024}}]'
    )
    assert body["qaa_generator_token_set"] is True
    assert body["jenkins_root_groups"] == [
        {"label": "BE", "path": "job/.QAA/job/E2E"},
        {"label": "FE", "path": "job/.QAA/job/UI_E2E"},
    ]
    assert body["jenkins_root_folders"] == ["PREPROD", "PROD"]
    assert body["jenkins_history_limit"] == 8
    assert "jenkins_token" not in body
    assert "llm_anthropic_key" not in body
    assert "llm_openai_key" not in body
    assert "qaa_generator_token" not in body
    assert "host" not in body
    assert "backend_url" not in body

    put_response = await client.put(
        "/settings",
        headers=auth_headers,
        json={
            "jenkins_url": "https://updated.jenkins",
            "jenkins_username": "updated-user",
            "jenkins_token": "",
            "llm_anthropic_key": "",
            "llm_openai_key": "",
            "llm_models": (
                '[{"label":"Codex","provider":"openai","model_id":"gpt-5","params":{"reasoning_effort":"high"}}]'
            ),
            "qaa_generator_token": "",
            "jenkins_root_groups": [
                {"label": "BE", "path": "job/.QAA/job/E2E/job/UPDATED"},
                {"label": "FE", "path": "job/.QAA/job/UI_E2E/job/UPDATED"},
            ],
            "jenkins_root_folders": ["UPDATED", "MORE"],
            "jenkins_history_limit": 10,
            "jenkins_request_timeout": 22,
            "jenkins_tree_depth": 7,
            "jenkins_stuck_min_idle_hours": 11,
            "staging_bin": "/opt/staging",
            "stagings_repo": "/work/stagings",
            "staging_kubeconfig": "~/.kube/updated.yaml",
            "notebook_root": "/tmp/notebook",
            "staging_kubeconfig_url": "https://updated.example/config",
            "kubeconfig_active_path": "~/.kube/active.yaml",
            "staging_kubeconfig_max_age_hours": 72,
            "kubectl_bin": "/usr/bin/kubectl",
            "kubeconfig": "/tmp/kubeconfig",
            "kubectl_request_timeout": "20s",
        },
    )

    assert put_response.status_code == 200
    updated = put_response.json()
    assert updated["jenkins_url"] == "https://updated.jenkins"
    assert updated["jenkins_username"] == "updated-user"
    assert updated["jenkins_token_set"] is False
    assert updated["llm_anthropic_key_set"] is False
    assert updated["llm_openai_key_set"] is False
    assert updated["llm_models"] == (
        '[{"label":"Codex","provider":"openai","model_id":"gpt-5","params":{"reasoning_effort":"high"}}]'
    )
    assert updated["qaa_generator_token_set"] is False
    assert updated["jenkins_root_groups"] == [
        {"label": "BE", "path": "job/.QAA/job/E2E/job/UPDATED"},
        {"label": "FE", "path": "job/.QAA/job/UI_E2E/job/UPDATED"},
    ]
    assert updated["jenkins_root_folders"] == ["UPDATED", "MORE"]
    assert updated["jenkins_history_limit"] == 10
    assert updated["staging_bin"] == "/opt/staging"
    assert updated["notebook_root"] == "/tmp/notebook"
    assert updated["kubectl_request_timeout"] == "20s"

    runtime_settings = client._transport.app.state.settings
    assert runtime_settings.jenkins_url == "https://updated.jenkins"
    assert runtime_settings.jenkins_username == "updated-user"
    assert runtime_settings.jenkins_token == ""
    assert runtime_settings.llm_anthropic_key == ""
    assert runtime_settings.llm_openai_key == ""
    assert runtime_settings.llm_models == (
        '[{"label":"Codex","provider":"openai","model_id":"gpt-5","params":{"reasoning_effort":"high"}}]'
    )
    assert runtime_settings.qaa_generator_token == ""
    assert [(group.label, group.path) for group in runtime_settings.jenkins_root_groups] == [
        ("BE", "job/.QAA/job/E2E/job/UPDATED"),
        ("FE", "job/.QAA/job/UI_E2E/job/UPDATED"),
    ]
    assert runtime_settings.jenkins_root_folders == ["UPDATED", "MORE"]
    assert runtime_settings.jenkins_history_limit == 10
    assert runtime_settings.notebook_root == "/tmp/notebook"
    assert (
        client._transport.app.state.job_manager._settings.jenkins_url == "https://updated.jenkins"
    )

    serialized_env = env_path.read_text(encoding="utf-8")
    assert "AGENT_JENKINS_TOKEN=\n" in serialized_env
    assert "AGENT_LLM_ANTHROPIC_KEY=\n" in serialized_env
    assert "AGENT_LLM_OPENAI_KEY=\n" in serialized_env
    assert (
        "AGENT_LLM_MODELS="
        '[{"label":"Codex","provider":"openai","model_id":"gpt-5","params":{"reasoning_effort":"high"}}]\n'
        in serialized_env
    )
    assert "AGENT_QAA_GENERATOR_TOKEN=\n" in serialized_env
    assert (
        "AGENT_JENKINS_ROOT_GROUPS="
        "BE=job/.QAA/job/E2E/job/UPDATED,FE=job/.QAA/job/UI_E2E/job/UPDATED\n" in serialized_env
    )
    assert "AGENT_JENKINS_ROOT_FOLDERS=UPDATED,MORE\n" in serialized_env
    assert "AGENT_JENKINS_HISTORY_LIMIT=10\n" in serialized_env
    assert "AGENT_NOTEBOOK_ROOT=/tmp/notebook\n" in serialized_env
