"""QAA generator schemas."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from app.core.constants import QaaRunProfile


class QaaRunCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jira_key: str
    dry_run: bool = False
    skip_pr: bool = False
    skip_exec: bool = False
    branch: str | None = None
    profile: QaaRunProfile = QaaRunProfile.BALANCED
