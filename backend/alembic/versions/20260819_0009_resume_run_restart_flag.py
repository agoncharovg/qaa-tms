"""Persist whether resumed pipelines should be restarted automatically."""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260819_0009"
down_revision = "20260818_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "jenkins_resume_runs",
        sa.Column("restart_pipelines", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "jenkins_resume_runs",
        sa.Column("target_path", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("jenkins_resume_runs", "target_path")
    op.drop_column("jenkins_resume_runs", "restart_pipelines")
