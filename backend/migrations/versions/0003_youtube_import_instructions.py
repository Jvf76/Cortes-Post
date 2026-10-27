"""Persist optional project editing instructions."""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    columns = {item["name"] for item in sa.inspect(op.get_bind()).get_columns("projects")}
    if "editing_instructions" not in columns:
        op.add_column("projects", sa.Column("editing_instructions", sa.Text(), nullable=False, server_default=""))
        op.alter_column("projects", "editing_instructions", server_default=None)


def downgrade():
    op.drop_column("projects", "editing_instructions")
