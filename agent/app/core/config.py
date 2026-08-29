"""Application settings."""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

from app.core import env_file
from app.core.constants import (
    DEFAULT_AGENT_HOST,
    DEFAULT_AGENT_PORT,
    DEFAULT_BACKEND_URL,
    DEFAULT_CORS_ORIGINS,
    DEFAULT_JENKINS_HISTORY_LIMIT,
    DEFAULT_JENKINS_REQUEST_TIMEOUT,
    DEFAULT_JENKINS_RESUME_PAUSE_SECONDS,
    DEFAULT_JENKINS_ROOT_FOLDERS,
    DEFAULT_JENKINS_ROOT_GROUPS,
    DEFAULT_JENKINS_STUCK_MIN_IDLE_HOURS,
    DEFAULT_JENKINS_TREE_DEPTH,
    DEFAULT_JENKINS_URL,
    DEFAULT_KUBECONFIG_ACTIVE_PATH,
    DEFAULT_KUBECTL_BIN,
    DEFAULT_KUBECTL_REQUEST_TIMEOUT,
    DEFAULT_STAGING_KUBECONFIG,
    DEFAULT_STAGING_KUBECONFIG_MAX_AGE_HOURS,
    DEFAULT_STAGING_KUBECONFIG_URL,
    GROUP_LABEL_SEPARATOR,
    GROUP_LIST_SEPARATOR,
    NOTEBOOK_DIR_NAME,
    EnvKey,
    StagingEnvKey,
)


class JenkinsRootGroup(BaseModel):
    """Configured Jenkins source root grouped under a display label."""

    model_config = ConfigDict(extra="forbid")

    label: str
    path: str


def build_default_jenkins_root_groups() -> list[JenkinsRootGroup]:
    return [
        JenkinsRootGroup(label="BE", path="job/.QAA/job/E2E"),
        JenkinsRootGroup(label="FE", path="job/.QAA/job/UI_E2E"),
    ]


class Settings(BaseSettings):
    """Runtime configuration."""

    model_config = SettingsConfigDict(
        env_file=str(env_file.AGENT_ENV_FILE),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    host: str = Field(default=DEFAULT_AGENT_HOST, alias=EnvKey.HOST.value)
    port: int = Field(default=DEFAULT_AGENT_PORT, alias=EnvKey.PORT.value)
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: list(DEFAULT_CORS_ORIGINS),
        alias=EnvKey.CORS_ORIGINS.value,
    )
    backend_url: str = Field(default=DEFAULT_BACKEND_URL, alias=EnvKey.BACKEND_URL.value)
    jenkins_url: str = Field(default=DEFAULT_JENKINS_URL, alias=EnvKey.JENKINS_URL.value)
    jenkins_username: str = Field(default="", alias=EnvKey.JENKINS_USERNAME.value)
    jenkins_token: str = Field(default="", alias=EnvKey.JENKINS_TOKEN.value)
    jenkins_root_groups: Annotated[list[JenkinsRootGroup], NoDecode] = Field(
        default_factory=build_default_jenkins_root_groups,
        alias=EnvKey.JENKINS_ROOT_GROUPS.value,
    )
    jenkins_root_folders: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: list(DEFAULT_JENKINS_ROOT_FOLDERS),
        alias=EnvKey.JENKINS_ROOT_FOLDERS.value,
    )
    jenkins_history_limit: int = Field(
        default=DEFAULT_JENKINS_HISTORY_LIMIT,
        alias=EnvKey.JENKINS_HISTORY_LIMIT.value,
    )
    jenkins_request_timeout: float = Field(
        default=DEFAULT_JENKINS_REQUEST_TIMEOUT,
        alias=EnvKey.JENKINS_REQUEST_TIMEOUT.value,
    )
    jenkins_tree_depth: int = Field(
        default=DEFAULT_JENKINS_TREE_DEPTH,
        alias=EnvKey.JENKINS_TREE_DEPTH.value,
    )
    qaa_generator_token: str = Field(default="", alias=EnvKey.QAA_GENERATOR_TOKEN.value)
    jenkins_stuck_min_idle_hours: int = Field(
        default=DEFAULT_JENKINS_STUCK_MIN_IDLE_HOURS,
        alias=EnvKey.JENKINS_STUCK_MIN_IDLE_HOURS.value,
    )
    jenkins_resume_pause_seconds: float = Field(
        default=DEFAULT_JENKINS_RESUME_PAUSE_SECONDS,
        alias=EnvKey.JENKINS_RESUME_PAUSE_SECONDS.value,
    )
    staging_bin: str | None = Field(default=None, alias=EnvKey.STAGING_BIN.value)
    stagings_repo: str | None = Field(default=None, alias=EnvKey.STAGINGS_REPO.value)
    staging_kubeconfig: str = Field(
        default=DEFAULT_STAGING_KUBECONFIG,
        alias=StagingEnvKey.KUBECONFIG.value,
    )
    staging_kubeconfig_url: str = Field(
        default=DEFAULT_STAGING_KUBECONFIG_URL,
        alias=EnvKey.STAGING_KUBECONFIG_URL.value,
    )
    kubeconfig_active_path: str = Field(
        default=DEFAULT_KUBECONFIG_ACTIVE_PATH,
        alias=EnvKey.KUBECONFIG_ACTIVE_PATH.value,
    )
    staging_kubeconfig_max_age_hours: int = Field(
        default=DEFAULT_STAGING_KUBECONFIG_MAX_AGE_HOURS,
        alias=EnvKey.STAGING_KUBECONFIG_MAX_AGE_HOURS.value,
    )
    kubectl_bin: str = Field(default=DEFAULT_KUBECTL_BIN, alias=EnvKey.KUBECTL_BIN.value)
    kubeconfig: str = Field(default="", alias=EnvKey.KUBECONFIG.value)
    kubectl_request_timeout: str = Field(
        default=DEFAULT_KUBECTL_REQUEST_TIMEOUT,
        alias=EnvKey.KUBECTL_REQUEST_TIMEOUT.value,
    )

    @field_validator("kubeconfig", mode="before")
    @classmethod
    def normalize_kubeconfig(cls, value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, str) and not value.strip():
            return ""
        return str(value)

    @field_validator("host")
    @classmethod
    def validate_host(cls, value: str) -> str:
        if value != DEFAULT_AGENT_HOST:
            raise ValueError(f"AGENT_HOST must stay {DEFAULT_AGENT_HOST}.")
        return value

    @field_validator("backend_url", "jenkins_url")
    @classmethod
    def normalize_base_url(cls, value: str) -> str:
        return value.rstrip("/")

    @field_validator("jenkins_root_groups", mode="before")
    @classmethod
    def parse_jenkins_root_groups(cls, value: Any) -> list[JenkinsRootGroup]:
        if value is None:
            return cls._parse_root_group_items(list(DEFAULT_JENKINS_ROOT_GROUPS))
        if isinstance(value, list):
            parsed = cls._parse_root_group_items(value)
            return parsed or cls._parse_root_group_items(list(DEFAULT_JENKINS_ROOT_GROUPS))
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return cls._parse_root_group_items(list(DEFAULT_JENKINS_ROOT_GROUPS))
            if stripped.startswith("["):
                parsed = json.loads(stripped)
                if not isinstance(parsed, list):
                    raise ValueError(
                        "AGENT_JENKINS_ROOT_GROUPS must be a JSON array or CSV string."
                    )
                parsed_groups = cls._parse_root_group_items(parsed)
                return parsed_groups or cls._parse_root_group_items(
                    list(DEFAULT_JENKINS_ROOT_GROUPS)
                )
            values: list[Any] = [
                item.strip() for item in stripped.split(GROUP_LIST_SEPARATOR) if item.strip()
            ]
            parsed = cls._parse_root_group_items(values)
            return parsed or cls._parse_root_group_items(list(DEFAULT_JENKINS_ROOT_GROUPS))
        raise ValueError("AGENT_JENKINS_ROOT_GROUPS must be a list or string.")

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: Any) -> list[str]:
        if value is None:
            return list(DEFAULT_CORS_ORIGINS)
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return list(DEFAULT_CORS_ORIGINS)
            if stripped.startswith("["):
                parsed = json.loads(stripped)
                if not isinstance(parsed, list):
                    raise ValueError("AGENT_CORS_ORIGINS must be a JSON array or CSV string.")
                return [str(item).strip() for item in parsed if str(item).strip()]
            return [item.strip() for item in stripped.split(GROUP_LIST_SEPARATOR) if item.strip()]
        raise ValueError("AGENT_CORS_ORIGINS must be a list or string.")

    @field_validator("jenkins_root_folders", mode="before")
    @classmethod
    def parse_jenkins_root_folders(cls, value: Any) -> list[str]:
        if value is None:
            return list(DEFAULT_JENKINS_ROOT_FOLDERS)
        if isinstance(value, list):
            parsed = [str(item).strip() for item in value if str(item).strip()]
            return parsed or list(DEFAULT_JENKINS_ROOT_FOLDERS)
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return list(DEFAULT_JENKINS_ROOT_FOLDERS)
            if stripped.startswith("["):
                parsed = json.loads(stripped)
                if not isinstance(parsed, list):
                    raise ValueError(
                        "AGENT_JENKINS_ROOT_FOLDERS must be a JSON array or CSV string."
                    )
                values = [str(item).strip() for item in parsed if str(item).strip()]
                return values or list(DEFAULT_JENKINS_ROOT_FOLDERS)
            values = [item.strip() for item in stripped.split(GROUP_LIST_SEPARATOR) if item.strip()]
            return values or list(DEFAULT_JENKINS_ROOT_FOLDERS)
        raise ValueError("AGENT_JENKINS_ROOT_FOLDERS must be a list or string.")

    @property
    def jenkins_configured(self) -> bool:
        return bool(self.jenkins_url and self.jenkins_username and self.jenkins_token)

    @property
    def jenkins_root_path(self) -> str:
        if not self.jenkins_root_groups:
            return ""
        return self.jenkins_root_groups[0].path

    @property
    def notebook_root(self) -> str:
        return str(env_file.user_data_home() / NOTEBOOK_DIR_NAME)

    @classmethod
    def _normalize_jenkins_job_path(cls, value: Any) -> str:
        return str(value).strip("/")

    @classmethod
    def _parse_root_group_items(cls, items: list[Any]) -> list[JenkinsRootGroup]:
        groups: list[JenkinsRootGroup] = []
        for item in items:
            if isinstance(item, JenkinsRootGroup):
                label = item.label.strip()
                path = cls._normalize_jenkins_job_path(item.path)
            elif isinstance(item, dict):
                label = str(item.get("label", "")).strip()
                path = cls._normalize_jenkins_job_path(item.get("path", ""))
            else:
                raw = str(item).strip()
                label, separator, raw_path = raw.partition(GROUP_LABEL_SEPARATOR)
                if not separator:
                    raise ValueError(
                        "AGENT_JENKINS_ROOT_GROUPS entries must use LABEL=job/path syntax."
                    )
                label = label.strip()
                path = cls._normalize_jenkins_job_path(raw_path)

            if not label or not path:
                raise ValueError(
                    "AGENT_JENKINS_ROOT_GROUPS entries must include both label and path."
                )
            groups.append(JenkinsRootGroup(label=label, path=path))
        return groups


@lru_cache
def get_settings() -> Settings:
    """Return cached settings."""

    return Settings(_env_file=env_file.AGENT_ENV_FILE)
