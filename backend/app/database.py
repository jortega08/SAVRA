from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from .config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
pool_options = ({"pool_size": settings.db_pool_size, "max_overflow": settings.db_max_overflow,
                 "pool_timeout": 15, "pool_recycle": 300,
                 "connect_args": {"connect_timeout": 15, "prepare_threshold": None}}
                if settings.database_url.startswith("postgresql+") else {})
engine = create_engine(settings.database_url, pool_pre_ping=True, hide_parameters=True, **pool_options)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db():
    with SessionLocal() as session:
        yield session
