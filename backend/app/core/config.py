"""Application settings."""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from sqlalchemy.engine import make_url

from app.core import env_file
from app.core.constants import (
    DEFAULT_AGENT_DIST_DIR,
    DEFAULT_APP_ENV,
    DEFAULT_AUTH_LOGIN_MAX_ATTEMPTS,
    DEFAULT_AUTH_LOGIN_WINDOW_SECONDS,
    DEFAULT_DATABASE_URL,
    DEFAULT_JENKINS_COMMON_URL,
    DEFAULT_JENKINS_HISTORY_LIMIT,
    DEFAULT_JENKINS_REQUEST_TIMEOUT,
    DEFAULT_JENKINS_ROOT_FOLDERS,
    DEFAULT_JENKINS_ROOT_GROUPS,
    DEFAULT_JENKINS_TREE_DEPTH,
    DEFAULT_JWT_EXPIRE_MINUTES,
    DEFAULT_JWT_SECRET,
    DEFAULT_LEONID_REQUEST_TIMEOUT,
    DEFAULT_LEONID_TOKEN,
    DEFAULT_LEONID_URL,
    DEFAULT_NOTIFICATOR_REQUEST_TIMEOUT,
    DEFAULT_NOTIFICATOR_TOKEN,
    DEFAULT_NOTIFICATOR_URL,
    DEFAULT_QAA_GENERATOR_BASE_URL,
    DEFAULT_QAA_GENERATOR_SUPERUSER_TOKEN,
    DEFAULT_STATIC_DIR,
    GROUP_LABEL_SEPARATOR,
    GROUP_LIST_SEPARATOR,
    AppEnvironment,
    EnvKey,
)


def coerce_async_database_url(value: str) -> str:
    url = make_url(value)
    if url.drivername.split("+")[0] not in ("postgresql", "postgres"):
        return value

    url = url.set(drivername="postgresql+asyncpg")
    host = url.host or ""
    if host == "localhost":
        url = url.set(host="127.0.0.1")
        host = "127.0.0.1"
    query = dict(url.query)
    sslmode = query.pop("sslmode", None)
    if sslmode is not None and "ssl" not in query:
        query["ssl"] = sslmode
    elif "ssl" not in query and host in {"127.0.0.1", "::1"}:
        query["ssl"] = "disable"
    url = url.set(query=query)
    return url.render_as_string(hide_password=False)


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
        env_file=str(env_file.BACKEND_ENV_FILE),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_env: AppEnvironment = Field(
        default=DEFAULT_APP_ENV,
        alias=EnvKey.APP_ENV.value,
    )
    database_url: str = Field(
        default=DEFAULT_DATABASE_URL,
        alias=EnvKey.DATABASE_URL.value,
    )
    jwt_secret: str = Field(default=DEFAULT_JWT_SECRET, alias=EnvKey.JWT_SECRET.value)
    jwt_expire_minutes: int = Field(
        default=DEFAULT_JWT_EXPIRE_MINUTES,
        alias=EnvKey.JWT_EXPIRE_MINUTES.value,
    )
    auth_login_max_attempts: int = Field(
        default=DEFAULT_AUTH_LOGIN_MAX_ATTEMPTS,
        alias=EnvKey.AUTH_LOGIN_MAX_ATTEMPTS.value,
    )
    auth_login_window_seconds: int = Field(
        default=DEFAULT_AUTH_LOGIN_WINDOW_SECONDS,
        alias=EnvKey.AUTH_LOGIN_WINDOW_SECONDS.value,
    )
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=list,
        alias=EnvKey.CORS_ORIGINS.value,
    )
    static_dir: str = Field(default=DEFAULT_STATIC_DIR, alias=EnvKey.STATIC_DIR.value)
    agent_dist_dir: str = Field(
        default=DEFAULT_AGENT_DIST_DIR,
        alias=EnvKey.AGENT_DIST_DIR.value,
    )
    leonid_url: str = Field(default=DEFAULT_LEONID_URL, alias=EnvKey.LEONID_URL.value)
    leonid_token: str = Field(default=DEFAULT_LEONID_TOKEN, alias=EnvKey.LEONID_TOKEN.value)
    leonid_request_timeout: float = Field(
        default=DEFAULT_LEONID_REQUEST_TIMEOUT,
        alias=EnvKey.LEONID_REQUEST_TIMEOUT.value,
    )
    notificator_url: str = Field(
        default=DEFAULT_NOTIFICATOR_URL,
        alias=EnvKey.NOTIFICATOR_URL.value,
    )
    notificator_token: str = Field(
        default=DEFAULT_NOTIFICATOR_TOKEN,
        alias=EnvKey.NOTIFICATOR_TOKEN.value,
    )
    notificator_request_timeout: float = Field(
        default=DEFAULT_NOTIFICATOR_REQUEST_TIMEOUT,
        alias=EnvKey.NOTIFICATOR_REQUEST_TIMEOUT.value,
    )
    jenkins_common_url: str = Field(
        default=DEFAULT_JENKINS_COMMON_URL,
        alias=EnvKey.JENKINS_COMMON_URL.value,
    )
    jenkins_common_username: str = Field(default="", alias=EnvKey.JENKINS_COMMON_USERNAME.value)
    jenkins_common_token: str = Field(default="", alias=EnvKey.JENKINS_COMMON_TOKEN.value)
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
    qaa_generator_base_url: str = Field(
        default=DEFAULT_QAA_GENERATOR_BASE_URL,
        alias=EnvKey.QAA_GENERATOR_BASE_URL.value,
    )
    qaa_generator_superuser_token: str = Field(
        default=DEFAULT_QAA_GENERATOR_SUPERUSER_TOKEN,
        alias=EnvKey.QAA_GENERATOR_SUPERUSER_TOKEN.value,
    )

    @field_validator("database_url", mode="after")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        return coerce_async_database_url(value)

    @field_validator(
        "leonid_url",
        "notificator_url",
        "jenkins_common_url",
        "qaa_generator_base_url",
        mode="after",
    )
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
                    raise ValueError("JENKINS_ROOT_GROUPS must be a JSON array or CSV string.")
                parsed_groups = cls._parse_root_group_items(parsed)
                return parsed_groups or cls._parse_root_group_items(
                    list(DEFAULT_JENKINS_ROOT_GROUPS)
                )
            values: list[Any] = [
                item.strip() for item in stripped.split(GROUP_LIST_SEPARATOR) if item.strip()
            ]
            parsed = cls._parse_root_group_items(values)
            return parsed or cls._parse_root_group_items(list(DEFAULT_JENKINS_ROOT_GROUPS))
        raise ValueError("JENKINS_ROOT_GROUPS must be a list or string.")

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
                    raise ValueError("JENKINS_ROOT_FOLDERS must be a JSON array or CSV string.")
                values = [str(item).strip() for item in parsed if str(item).strip()]
                return values or list(DEFAULT_JENKINS_ROOT_FOLDERS)
            values = [item.strip() for item in stripped.split(GROUP_LIST_SEPARATOR) if item.strip()]
            return values or list(DEFAULT_JENKINS_ROOT_FOLDERS)
        raise ValueError("JENKINS_ROOT_FOLDERS must be a list or string.")

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return []
            if stripped.startswith("["):
                parsed = json.loads(stripped)
                if not isinstance(parsed, list):
                    raise ValueError("CORS_ORIGINS must be a JSON array or comma-separated list.")
                return [str(item).strip() for item in parsed if str(item).strip()]
            return [item.strip() for item in stripped.split(",") if item.strip()]
        raise ValueError("CORS_ORIGINS must be a list or string.")

    @property
    def is_development(self) -> bool:
        return self.app_env is AppEnvironment.DEVELOPMENT

    @property
    def jenkins_common_configured(self) -> bool:
        return bool(
            self.jenkins_common_url
            and self.jenkins_common_username.strip()
            and self.jenkins_common_token.strip()
        )

    @classmethod
    def _parse_root_group_items(cls, items: list[Any]) -> list[JenkinsRootGroup]:
        parsed_groups: list[JenkinsRootGroup] = []
        for item in items:
            if isinstance(item, JenkinsRootGroup):
                parsed_groups.append(item)
                continue
            if isinstance(item, dict):
                label = str(item.get("label", "")).strip()
                path = str(item.get("path", "")).strip().strip("/")
            elif isinstance(item, str):
                label, separator, path = item.partition(GROUP_LABEL_SEPARATOR)
                if separator != GROUP_LABEL_SEPARATOR:
                    raise ValueError("JENKINS_ROOT_GROUPS entries must use LABEL=job/path syntax.")
                label = label.strip()
                path = path.strip().strip("/")
            else:
                raise ValueError("JENKINS_ROOT_GROUPS entries must be strings or objects.")

            if not label or not path:
                raise ValueError("JENKINS_ROOT_GROUPS entries must include both label and path.")
            parsed_groups.append(JenkinsRootGroup(label=label, path=path))
        return parsed_groups


@lru_cache
def get_settings() -> Settings:
    return Settings(_env_file=env_file.BACKEND_ENV_FILE)
