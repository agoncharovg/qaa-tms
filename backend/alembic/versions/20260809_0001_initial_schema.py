"""Initial schema."""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op
from app.core.constants import OperationStatus, OperationType

revision = "20260809_0001"
down_revision = None
branch_labels = None
depends_on = None


def enum_values(enum_type: type[OperationType] | type[OperationStatus]) -> list[str]:
    return [member.value for member in enum_type]


def recipe_type() -> sa.JSON:
    return sa.JSON().with_variant(
        postgresql.JSONB(astext_type=sa.Text()),
        "postgresql",
    )


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=True),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("auto_login", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint("username", name="uq_users_username"),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=False)

    op.create_table(
        "operations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "type",
            sa.Enum(OperationType, native_enum=False, values_callable=enum_values),
            nullable=False,
        ),
        sa.Column("ns", sa.String(length=255), nullable=True),
        sa.Column("recipe", recipe_type(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(OperationStatus, native_enum=False, values_callable=enum_values),
            nullable=False,
        ),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("log", sa.Text(), nullable=True),
        sa.Column("exit_code", sa.Integer(), nullable=True),
        sa.Column("agent_host", sa.String(length=255), nullable=True),
        sa.Column("agent_version", sa.String(length=255), nullable=True),
        sa.Column("stagings_sha", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name="fk_operations_user_id_users"),
    )
    op.create_index("ix_operations_ns", "operations", ["ns"], unique=False)
    op.create_index("ix_operations_status", "operations", ["status"], unique=False)
    op.create_index("ix_operations_type", "operations", ["type"], unique=False)
    op.create_index("ix_operations_user_id", "operations", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_operations_user_id", table_name="operations")
    op.drop_index("ix_operations_type", table_name="operations")
    op.drop_index("ix_operations_status", table_name="operations")
    op.drop_index("ix_operations_ns", table_name="operations")
    op.drop_table("operations")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_table("users")
