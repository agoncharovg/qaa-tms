"""Add durable Jenkins freezes."""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op
from app.core.constants import JenkinsFreezeStatus

revision = "20260818_0006"
down_revision = "20260811_0005"
branch_labels = None
depends_on = None


def enum_values(enum_type: type[JenkinsFreezeStatus]) -> list[str]:
    return [member.value for member in enum_type]


def snapshot_type() -> sa.JSON:
    return sa.JSON().with_variant(
        postgresql.JSONB(astext_type=sa.Text()),
        "postgresql",
    )


def upgrade() -> None:
    op.create_table(
        "jenkins_freezes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("folder_path", sa.String(length=255), nullable=False),
        sa.Column("folder_name", sa.String(length=255), nullable=False),
        sa.Column("signature", sa.String(length=255), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("kill_builds", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "status",
            sa.Enum(JenkinsFreezeStatus, native_enum=False, values_callable=enum_values),
            nullable=False,
        ),
        sa.Column("applied", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("snapshot", snapshot_type(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("resolved_by_id", sa.Integer(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("merged_into_id", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
            name="fk_jenkins_freezes_created_by_id_users",
        ),
        sa.ForeignKeyConstraint(
            ["resolved_by_id"],
            ["users.id"],
            name="fk_jenkins_freezes_resolved_by_id_users",
        ),
        sa.ForeignKeyConstraint(
            ["merged_into_id"],
            ["jenkins_freezes.id"],
            name="fk_jenkins_freezes_merged_into_id_jenkins_freezes",
        ),
    )
    op.create_index(
        "ix_jenkins_freezes_folder_path",
        "jenkins_freezes",
        ["folder_path"],
        unique=False,
    )
    op.create_index(
        "ix_jenkins_freezes_signature",
        "jenkins_freezes",
        ["signature"],
        unique=False,
    )
    op.create_index("ix_jenkins_freezes_status", "jenkins_freezes", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_jenkins_freezes_status", table_name="jenkins_freezes")
    op.drop_index("ix_jenkins_freezes_signature", table_name="jenkins_freezes")
    op.drop_index("ix_jenkins_freezes_folder_path", table_name="jenkins_freezes")
    op.drop_table("jenkins_freezes")
