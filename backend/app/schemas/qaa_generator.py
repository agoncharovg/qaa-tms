"""QAA generator schemas."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, model_validator

from app.core.constants import QaaRunProfile


class QaaRunCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jira_key: str
    dry_run: bool = False
    skip_pr: bool = False
    skip_exec: bool = False
    branch: str | None = None
    profile: QaaRunProfile = QaaRunProfile.BALANCED


class QaaUserCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str | None = None
    slack_user_id: str | None = None
    name: str | None = None
    description: str | None = None

    @model_validator(mode="after")
    def validate_identifier_presence(self) -> QaaUserCreateRequest:
        if self.email is None and self.slack_user_id is None:
            raise ValueError("At least one of email or slack_user_id is required.")
        return self


class QaaServiceTokenCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
