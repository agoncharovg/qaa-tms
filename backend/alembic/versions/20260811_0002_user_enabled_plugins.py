"""Add enabled_plugins to users."""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260811_0002"
down_revision = "20260809_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("enabled_plugins", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "enabled_plugins")
