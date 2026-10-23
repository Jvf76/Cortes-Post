"""phase 1 hardening (safe after the metadata-based greenfield 0001)."""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def _columns(table):
    return {x["name"] for x in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade():
    if "csrf_token" not in _columns("sessions"):
        op.add_column("sessions", sa.Column("csrf_token", sa.String(128), nullable=True))
        op.execute("UPDATE sessions SET csrf_token = '' WHERE csrf_token IS NULL")
        op.alter_column("sessions", "csrf_token", nullable=False)
    if "approved_snapshot" not in _columns("clips"):
        op.add_column("clips", sa.Column("approved_snapshot", sa.JSON(), nullable=True))
    oauth = _columns("oauth_states")
    if "session_id" not in oauth:
        # Old OAuth states cannot be securely associated retroactively.
        op.execute("DELETE FROM oauth_states")
        op.add_column("oauth_states", sa.Column("session_id", sa.String(64), nullable=True))
        op.add_column("oauth_states", sa.Column("code_verifier", sa.LargeBinary(), nullable=True))
        op.create_foreign_key("fk_oauth_state_session", "oauth_states", "sessions", ["session_id"], ["id"], ondelete="CASCADE")
        op.create_index("ix_oauth_states_session_id", "oauth_states", ["session_id"])
        op.alter_column("oauth_states", "session_id", nullable=False)
        op.alter_column("oauth_states", "code_verifier", nullable=False)
    if "artifact_path" not in _columns("publications"):
        op.add_column("publications", sa.Column("artifact_path", sa.Text(), nullable=True))
        op.execute("UPDATE publications SET artifact_path = '' WHERE artifact_path IS NULL")
        op.alter_column("publications", "artifact_path", nullable=False)
    outbox = _columns("outbox")
    if "lease_token" not in outbox:
        op.add_column("outbox", sa.Column("lease_token", sa.String(64), nullable=True))
        op.add_column("outbox", sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True))
        op.add_column("outbox", sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"))
        op.add_column("outbox", sa.Column("error", sa.Text(), nullable=True))
        op.create_index("ix_outbox_lease_token", "outbox", ["lease_token"])
    if "transcript_segments" not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(
            "transcript_segments",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
            sa.Column("start_seconds", sa.Float(), nullable=False),
            sa.Column("end_seconds", sa.Float(), nullable=False),
            sa.Column("original_text", sa.Text(), nullable=False),
            sa.Column("translated_text", sa.Text(), nullable=True),
        )
        op.create_index("ix_transcript_segments_project_id", "transcript_segments", ["project_id"])


def downgrade():
    op.drop_index("ix_transcript_segments_project_id", table_name="transcript_segments")
    op.drop_table("transcript_segments")
    op.drop_index("ix_outbox_lease_token", table_name="outbox")
    for name in ("error", "attempts", "lease_expires_at", "lease_token"):
        op.drop_column("outbox", name)
    op.drop_column("publications", "artifact_path")
    op.drop_index("ix_oauth_states_session_id", table_name="oauth_states")
    op.drop_constraint("fk_oauth_state_session", "oauth_states", type_="foreignkey")
    op.drop_column("oauth_states", "code_verifier")
    op.drop_column("oauth_states", "session_id")
    op.drop_column("clips", "approved_snapshot")
    op.drop_column("sessions", "csrf_token")
