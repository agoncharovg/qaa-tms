"""Notificator proxy schemas."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class NotificatorChannel(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    channel_id: str
    description: str | None = None


class NotificatorChoice(BaseModel):
    model_config = ConfigDict(extra="ignore")

    code: str
    label: str


class NotificatorNamedEntity(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    name: str


class NotificatorRecurrentFailRef(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    description: str | None = None


class NotificatorUser(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    sam_account_name: str | None = None
    user_principal_name: str | None = None
    username: str | None = None
    display_name: str | None = None


class NotificatorChoicesResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    notification_types: list[NotificatorChoice] = Field(default_factory=list)


class NotificatorNotificationConfigCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_team: int
    notification_type: str = Field(min_length=1)
    enabled: bool = True
    channels: list[int] = Field(default_factory=list)
    users: list[int] = Field(default_factory=list)


class NotificatorNotificationConfigUpdate(NotificatorNotificationConfigCreate):
    pass


class NotificatorNotificationConfigPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_team: int | None = None
    notification_type: str | None = Field(default=None, min_length=1)
    enabled: bool | None = None
    channels: list[int] | None = None
    users: list[int] | None = None


class NotificatorNotificationConfigResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    product_team_id: int
    product_team: str
    notification_type: str
    notification_type_label: str
    enabled: bool
    channels: list[NotificatorChannel] = Field(default_factory=list)
    users: list[NotificatorUser] = Field(default_factory=list)


class NotificatorProductTeamResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    name: str
    email: str
    pagerduty_ep: str | None = None
    product: NotificatorNamedEntity | None = None
    manager: NotificatorUser | None = None
    members: list[NotificatorUser] = Field(default_factory=list)
    notification_configs_count: int = 0
    sub_products_count: int = 0


class NotificatorProductCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    description: str | None = None


class NotificatorProductUpdate(NotificatorProductCreate):
    pass


class NotificatorProductPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1)
    description: str | None = None


class NotificatorProductResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    name: str
    description: str | None = None
    teams_count: int = 0
    sub_products_count: int = 0
    qaa_members_count: int = 0


class NotificatorSubProductCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    product: int | None = None
    team: int | None = None


class NotificatorSubProductUpdate(NotificatorSubProductCreate):
    pass


class NotificatorSubProductPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1)
    product: int | None = None
    team: int | None = None


class NotificatorSubProductResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    name: str
    product: NotificatorNamedEntity | None = None
    team: NotificatorNamedEntity | None = None


class NotificatorSlackChannelCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    channel_id: str = Field(min_length=1)
    description: str | None = None


class NotificatorSlackChannelUpdate(NotificatorSlackChannelCreate):
    pass


class NotificatorSlackChannelPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    channel_id: str | None = Field(default=None, min_length=1)
    description: str | None = None


class NotificatorSlackChannelResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    channel_id: str
    description: str | None = None


class NotificatorUserResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    username: str
    user_principal_name: str | None = None
    sam_account_name: str | None = None
    slack_id: str | None = None
    department: str | None = None
    company: str | None = None
    title: str | None = None
    notifications_enabled: bool = True
    teams: list[NotificatorNamedEntity] = Field(default_factory=list)
    events_subscriptions: list[NotificatorNamedEntity] = Field(default_factory=list)
    manager: NotificatorUser | None = None


class NotificatorQaaMemberResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    product: NotificatorNamedEntity
    user: NotificatorUser


class NotificatorFailureMentionRuleResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    pattern: str
    match_target: str
    environment: str
    message_template: str
    enabled: bool
    users: list[NotificatorUser] = Field(default_factory=list)


class NotificatorEventResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    name: str
    description: str
    enabled: bool


class NotificatorMuteStatusSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    created_at: str | None = None
    expires_at: str | None = None


class NotificatorRecurrentFailResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    description: str
    time_threshold: int
    number_of_fails: int
    environment: str
    is_enabled: bool
    channels: list[NotificatorChannel] = Field(default_factory=list)
    slack_mention: list[NotificatorUser] = Field(default_factory=list)
    fail_reasons: NotificatorNamedEntity | None = None
    product: NotificatorNamedEntity | None = None
    mute_statuses: list[NotificatorMuteStatusSummary] = Field(default_factory=list)


class NotificatorFailReasonResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    name: str


class NotificatorMuteStatusResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    created_at: str | None = None
    expires_at: str | None = None
    configuration: NotificatorRecurrentFailRef | None = None


class NotificatorHistoryItemResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int | None = None
    author: str
    when_muted: str | None = None
    muted_until: str | None = None
    config_id: str
