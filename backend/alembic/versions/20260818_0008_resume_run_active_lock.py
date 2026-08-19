"""Enforce one active Jenkins resume campaign per scope via a partial unique index."""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260818_0008"
down_revision = "20260818_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "uq_jenkins_resume_runs_active",
        "jenkins_resume_runs",
        ["signature"],
        unique=True,
        postgresql_where=sa.text("status = 'running'"),
        sqlite_where=sa.text("status = 'running'"),
    )


def downgrade() -> None:
    op.drop_index("uq_jenkins_resume_runs_active", table_name="jenkins_resume_runs")
