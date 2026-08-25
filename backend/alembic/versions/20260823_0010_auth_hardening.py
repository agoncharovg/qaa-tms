"""auth hardening: session_version, auth_login_events

Revision ID: 20260823_0010
Revises: 20260819_0009
Create Date: 2026-08-23
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260823_0010"
down_revision = "20260819_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "session_version",
            sa.Integer(),
            nullable=False,
            server_default="1",
        ),
    )
    op.create_table(
        "auth_login_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(255), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("reason", sa.String(255), nullable=False),
        sa.Column("remote_addr", sa.String(255), nullable=True),
        sa.Column("user_agent", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_auth_login_events_user_id_users",
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_auth_login_events"),
    )
    op.create_index("ix_auth_login_events_username", "auth_login_events", ["username"])
    op.create_index("ix_auth_login_events_user_id", "auth_login_events", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_auth_login_events_user_id", table_name="auth_login_events")
    op.drop_index("ix_auth_login_events_username", table_name="auth_login_events")
    op.drop_table("auth_login_events")
    op.drop_column("users", "session_version")
