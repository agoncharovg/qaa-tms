"""Leonid proxy schemas."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class LeonidSharedResourceLimitTypeResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    name: str


class LeonidSharedResourceLimitCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resource_name: str = Field(min_length=1)
    limit_type: int
    limit_value: int
    reset_date: str | None = None


class LeonidSharedResourceLimitUpdate(LeonidSharedResourceLimitCreate):
    pass


class LeonidSharedResourceLimitPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resource_name: str | None = Field(default=None, min_length=1)
    limit_type: int | None = None
    limit_value: int | None = None
    reset_date: str | None = None


class LeonidSharedResourceLimitResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    resource_name: str
    limit_type: int
    limit_value: int
    reset_date: str | None = None


class LeonidSharedResourceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resource_limit: int
    value: str = Field(min_length=1)
    count: int
    enabled: bool = True


class LeonidSharedResourceUpdate(LeonidSharedResourceCreate):
    pass


class LeonidSharedResourcePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resource_limit: int | None = None
    value: str | None = Field(default=None, min_length=1)
    count: int | None = None
    enabled: bool | None = None


class LeonidSharedResourceResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    resource_limit: int
    value: str
    count: int
    enabled: bool


class LeonidSkippedTest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: str = Field(min_length=1)


class LeonidSkippedTestResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    full_name: str


class LeonidSkippedSuiteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1)
    product: str = Field(min_length=1)
    expires_at: str = Field(min_length=1)
    tests: list[LeonidSkippedTest]

    @model_validator(mode="after")
    def validate_tests(self) -> LeonidSkippedSuiteCreate:
        if not self.tests:
            raise ValueError("At least one test is required.")
        return self


class LeonidSkippedSuiteResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    author: str
    reason: str
    product: str
    created_at: str
    expires_at: str
    cancelled_at: str | None = None
    cancelled_by: str | None = None
    status: str
    tests: list[LeonidSkippedTestResponse]


class LeonidObjectDefinitionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    object_name: str = Field(min_length=1)
    comment: str | None = None
    enabled: bool = True


class LeonidObjectDefinitionUpdate(LeonidObjectDefinitionCreate):
    pass


class LeonidObjectDefinitionPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    object_name: str | None = Field(default=None, min_length=1)
    comment: str | None = None
    enabled: bool | None = None


class LeonidObjectDefinitionResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    object_name: str
    comment: str | None = None
    enabled: bool


class LeonidObjectValueCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    object: int
    environment: int
    value: str = Field(min_length=1)
    comment: str | None = None
    enabled: bool = True


class LeonidObjectValueUpdate(LeonidObjectValueCreate):
    pass


class LeonidObjectValuePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    object: int | None = None
    environment: int | None = None
    value: str | None = Field(default=None, min_length=1)
    comment: str | None = None
    enabled: bool | None = None


class LeonidObjectValueResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    object: int
    environment: int
    value: str
    comment: str | None = None
    enabled: bool


class LeonidPipelineParamCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    job_path: str = Field(min_length=1)
    params: Any = Field(default_factory=list)


class LeonidPipelineParamUpdate(LeonidPipelineParamCreate):
    pass


class LeonidPipelineParamPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1)
    job_path: str | None = Field(default=None, min_length=1)
    params: Any = None


class LeonidPipelineParamResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: int
    name: str
    job_path: str
    params: Any = Field(default_factory=list)
