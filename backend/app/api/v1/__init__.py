"""API v1 router."""

from fastapi import APIRouter

from app.api.v1.auth import router as auth_router
from app.api.v1.operations import router as operations_router
from app.api.v1.qaa_generator import router as qaa_generator_router
from app.api.v1.qaa_generator_admin import router as qaa_generator_admin_router
from app.api.v1.users import router as users_router
from app.core.constants import ApiPrefix

router = APIRouter(prefix=ApiPrefix.V1.value)
router.include_router(auth_router)
router.include_router(users_router)
router.include_router(operations_router)
router.include_router(qaa_generator_router)
router.include_router(qaa_generator_admin_router)
