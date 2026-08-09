"""User routes."""

from fastapi import APIRouter

from app.api.deps import CurrentUser
from app.core.constants import ApiTag, RoutePath
from app.schemas.user import UserRead

router = APIRouter(tags=[ApiTag.USERS.value])


@router.get(RoutePath.ME.value, response_model=UserRead)
async def get_me(current_user: CurrentUser) -> UserRead:
    return UserRead.model_validate(current_user)
