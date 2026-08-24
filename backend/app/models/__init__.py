"""ORM models.

Importing this package registers every model on ``Base.metadata`` so schema
tooling (Alembic autogenerate, the SQLite dev-schema ``create_all`` in
``scripts/up-all.sh``) sees the full set. Add new models here.
"""

from app.models.auth_login_event import AuthLoginEvent
from app.models.jenkins_freeze import JenkinsFreeze
from app.models.jenkins_resume_run import JenkinsResumeRun
from app.models.operation import Operation
from app.models.security_event import SecurityEvent
from app.models.security_group import (
    SecurityGroup,
    SecurityGroupMembership,
    SecurityGroupPermission,
    SecurityGroupRole,
)
from app.models.security_permission import SecurityPermission
from app.models.security_role import SecurityRole, SecurityRolePermission
from app.models.user import User
from app.models.user_extra_permission import UserExtraPermission

__all__ = [
    "AuthLoginEvent",
    "JenkinsFreeze",
    "JenkinsResumeRun",
    "Operation",
    "SecurityEvent",
    "SecurityGroup",
    "SecurityGroupMembership",
    "SecurityGroupPermission",
    "SecurityGroupRole",
    "SecurityPermission",
    "SecurityRole",
    "SecurityRolePermission",
    "User",
    "UserExtraPermission",
]
