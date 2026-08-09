"""Authentication schemas."""

from pydantic import BaseModel

from app.core.constants import TokenType
from app.schemas.user import UserRead


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: TokenType
    user: UserRead
