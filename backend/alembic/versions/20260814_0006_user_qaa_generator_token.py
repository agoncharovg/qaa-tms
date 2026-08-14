"""Add per-user qaa-generator token storage."""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260814_0006"
down_revision = "20260811_0005"
branch_labels = None
depends_on = None

USERS_TABLE_NAME = "users"
QAA_GENERATOR_TOKEN_COLUMN_NAME = "qaa_generator_token"
DEFAULT_STRING_LENGTH = 255


def upgrade() -> None:
    with op.batch_alter_table(USERS_TABLE_NAME) as batch_op:
        batch_op.add_column(
            sa.Column(
                QAA_GENERATOR_TOKEN_COLUMN_NAME,
                sa.String(length=DEFAULT_STRING_LENGTH),
                nullable=True,
            )
        )


def downgrade() -> None:
    with op.batch_alter_table(USERS_TABLE_NAME) as batch_op:
        batch_op.drop_column(QAA_GENERATOR_TOKEN_COLUMN_NAME)
