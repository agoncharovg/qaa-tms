"""Widen operations.type for kube operation names."""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260811_0004"
down_revision = "20260811_0003"
branch_labels = None
depends_on = None

PREVIOUS_OPERATION_TYPE_LENGTH = 12
KUBE_USE_CONTEXT_OPERATION_TYPE_LENGTH = 16
OPERATIONS_TABLE_NAME = "operations"
OPERATIONS_TYPE_COLUMN_NAME = "type"


def upgrade() -> None:
    with op.batch_alter_table(OPERATIONS_TABLE_NAME) as batch_op:
        batch_op.alter_column(
            OPERATIONS_TYPE_COLUMN_NAME,
            existing_type=sa.String(length=PREVIOUS_OPERATION_TYPE_LENGTH),
            type_=sa.String(length=KUBE_USE_CONTEXT_OPERATION_TYPE_LENGTH),
        )


def downgrade() -> None:
    with op.batch_alter_table(OPERATIONS_TABLE_NAME) as batch_op:
        batch_op.alter_column(
            OPERATIONS_TYPE_COLUMN_NAME,
            existing_type=sa.String(length=KUBE_USE_CONTEXT_OPERATION_TYPE_LENGTH),
            type_=sa.String(length=PREVIOUS_OPERATION_TYPE_LENGTH),
        )
