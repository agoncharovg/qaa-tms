"""API v1 router."""

from fastapi import APIRouter

from app.api.v1.agent import router as agent_router
from app.api.v1.auth import router as auth_router
from app.api.v1.authz import router as authz_router
from app.api.v1.jenkins import router as jenkins_router
from app.api.v1.jenkins_freeze import router as jenkins_freeze_router
from app.api.v1.jenkins_resume_run import router as jenkins_resume_run_router
from app.api.v1.operations import router as operations_router
from app.api.v1.qaa_generator import router as qaa_generator_router
from app.api.v1.qaa_generator_admin import router as qaa_generator_admin_router
from app.api.v1.security import router as security_router
from app.api.v1.settings import router as settings_router
from app.api.v1.users import router as users_router
from app.core.constants import ApiPrefix

router = APIRouter(prefix=ApiPrefix.V1.value)
router.include_router(agent_router)
router.include_router(auth_router)
router.include_router(authz_router)
router.include_router(jenkins_router)
router.include_router(jenkins_freeze_router)
router.include_router(jenkins_resume_run_router)
router.include_router(security_router)
router.include_router(users_router)
router.include_router(settings_router)
router.include_router(operations_router)
router.include_router(qaa_generator_router)
router.include_router(qaa_generator_admin_router)
