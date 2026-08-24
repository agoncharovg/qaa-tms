"""Authorization check routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_db
from app.core.constants import ApiTag, RoutePath
from app.schemas.authz import AuthzCheckRequest, AuthzCheckResponse, AuthzCheckResult
from app.services.authorization import has_permission

router = APIRouter(prefix=RoutePath.AUTHZ.value, tags=[ApiTag.SECURITY.value])


@router.post(RoutePath.CHECK.value, response_model=AuthzCheckResponse)
async def check_authorization(
    payload: AuthzCheckRequest,
    current_user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AuthzCheckResponse:
    results = []
    for check in payload.checks:
        allowed = await has_permission(current_user, check.permission, db)
        results.append(AuthzCheckResult(permission=check.permission, allowed=allowed))
    return AuthzCheckResponse(results=results)
