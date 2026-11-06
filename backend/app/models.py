from datetime import datetime, timezone
from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


def utcnow():
    return datetime.now(timezone.utc)


class Questionnaire(Base):
    __tablename__ = "questionnaires"
    id: Mapped[int] = mapped_column(primary_key=True)
    version: Mapped[str] = mapped_column(String(100), unique=True)
    title: Mapped[str] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=False)
    definition_hash: Mapped[str] = mapped_column(String(64))
    provenance: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    questions: Mapped[list["Question"]] = relationship(cascade="all, delete-orphan", order_by="Question.position", lazy="selectin")
    __table_args__ = (Index("one_active_questionnaire", "active", unique=True, postgresql_where=text("active = true"), sqlite_where=text("active = 1")),)


class Question(Base):
    __tablename__ = "questions"
    id: Mapped[int] = mapped_column(primary_key=True)
    questionnaire_id: Mapped[int] = mapped_column(ForeignKey("questionnaires.id"), index=True)
    key: Mapped[str] = mapped_column(String(100))
    prompt: Mapped[str] = mapped_column(Text)
    source_column: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(20))
    section: Mapped[str] = mapped_column(String(80))
    required: Mapped[bool] = mapped_column(Boolean)
    position: Mapped[int] = mapped_column(Integer)
    eligible_values: Mapped[list | None] = mapped_column(JSON, nullable=True)
    options: Mapped[list["Option"]] = relationship(cascade="all, delete-orphan", order_by="Option.position", lazy="selectin")
    __table_args__ = (UniqueConstraint("questionnaire_id", "key"), CheckConstraint("kind IN ('category', 'text')"))


class Option(Base):
    __tablename__ = "question_options"
    id: Mapped[int] = mapped_column(primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id"), index=True)
    value: Mapped[str] = mapped_column(Text)
    label: Mapped[str] = mapped_column(Text)
    position: Mapped[int] = mapped_column(Integer)
    __table_args__ = (UniqueConstraint("question_id", "value"),)


class ImportBatch(Base):
    __tablename__ = "import_batches"
    id: Mapped[int] = mapped_column(primary_key=True)
    file_sha256: Mapped[str] = mapped_column(String(64), unique=True)
    questionnaire_id: Mapped[int] = mapped_column(ForeignKey("questionnaires.id"))
    received: Mapped[int] = mapped_column(Integer)
    eligible: Mapped[int] = mapped_column(Integer)
    rejected: Mapped[int] = mapped_column(Integer)
    invalid: Mapped[int] = mapped_column(Integer)
    stored: Mapped[int] = mapped_column(Integer)
    duplicates: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    validation: Mapped[dict] = mapped_column(JSON)


class SurveyResponse(Base):
    __tablename__ = "responses"
    id: Mapped[int] = mapped_column(primary_key=True)
    questionnaire_id: Mapped[int] = mapped_column(ForeignKey("questionnaires.id"), index=True)
    source: Mapped[str] = mapped_column(String(30))
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True)
    payload_hash: Mapped[str] = mapped_column(String(64))
    import_batch_id: Mapped[int | None] = mapped_column(ForeignKey("import_batches.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (CheckConstraint("source IN ('microsoft_forms', 'integrated')"),)


class Answer(Base):
    __tablename__ = "answers"
    id: Mapped[int] = mapped_column(primary_key=True)
    response_id: Mapped[int] = mapped_column(ForeignKey("responses.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id"), index=True)
    value: Mapped[str] = mapped_column(Text)
    __table_args__ = (UniqueConstraint("response_id", "question_id"), Index("answer_category_lookup", "question_id", "value"))
