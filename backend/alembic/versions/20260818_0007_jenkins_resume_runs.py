"""Add durable Jenkins resume campaigns."""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op
from app.core.constants import JenkinsResumeRunStatus

revision = "20260818_0007"
down_revision = "20260818_0006"
branch_labels = None
depends_on = None


def enum_values(enum_type: type[JenkinsResumeRunStatus]) -> list[str]:
    return [member.value for member in enum_type]


def items_type() -> sa.JSON:
    return sa.JSON().with_variant(
        postgresql.JSONB(astext_type=sa.Text()),
        "postgresql",
    )


def upgrade() -> None:
    op.create_table(
        "jenkins_resume_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("freeze_id", sa.Uuid(), nullable=False),
        sa.Column("signature", sa.String(length=255), nullable=False),
        sa.Column(
            "status",
            sa.Enum(JenkinsResumeRunStatus, native_enum=False, values_callable=enum_values),
            nullable=False,
        ),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("started_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("skipped_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("current_path", sa.String(length=255), nullable=True),
        sa.Column("current_name", sa.String(length=255), nullable=True),
        sa.Column("items", items_type(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "heartbeat_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("cancelled_by_id", sa.Integer(), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["freeze_id"],
            ["jenkins_freezes.id"],
            name="fk_jenkins_resume_runs_freeze_id_jenkins_freezes",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_id"],
            ["users.id"],
            name="fk_jenkins_resume_runs_created_by_id_users",
        ),
        sa.ForeignKeyConstraint(
            ["cancelled_by_id"],
            ["users.id"],
            name="fk_jenkins_resume_runs_cancelled_by_id_users",
        ),
    )
    op.create_index(
        "ix_jenkins_resume_runs_signature",
        "jenkins_resume_runs",
        ["signature"],
        unique=False,
    )
    op.create_index(
        "ix_jenkins_resume_runs_status",
        "jenkins_resume_runs",
        ["status"],
        unique=False,
    )
    op.create_index(
        "ix_jenkins_resume_runs_freeze_id",
        "jenkins_resume_runs",
        ["freeze_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_jenkins_resume_runs_freeze_id", table_name="jenkins_resume_runs")
    op.drop_index("ix_jenkins_resume_runs_status", table_name="jenkins_resume_runs")
    op.drop_index("ix_jenkins_resume_runs_signature", table_name="jenkins_resume_runs")
    op.drop_table("jenkins_resume_runs")
