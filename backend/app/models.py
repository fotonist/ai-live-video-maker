from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid4
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="draft")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    audio: Mapped["AudioAsset | None"] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        uselist=False,
    )
    analysis: Mapped["AudioAnalysis | None"] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        uselist=False,
    )


class AudioAsset(Base):
    __tablename__ = "audio_assets"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid4
    )
    project_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    project: Mapped[Project] = relationship(back_populates="audio")


class AudioAnalysis(Base):
    __tablename__ = "audio_analyses"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid4
    )
    project_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    duration_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    sample_rate: Mapped[int] = mapped_column(Integer, nullable=False)
    bpm: Mapped[float] = mapped_column(Float, nullable=False)
    beat_interval_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    beat_positions_seconds: Mapped[list] = mapped_column(JSON, nullable=False)
    energy_curve: Mapped[list] = mapped_column(JSON, nullable=False)
    sections: Mapped[list] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="analyzed")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    project: Mapped[Project] = relationship(back_populates="analysis")
