from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase
from app.config import settings

database_url = make_url(
    "sqlite+aiosqlite:///./digital_twin.db"
    if settings.database_backend == "sqlite"
    else settings.database_url
)
if database_url.drivername in {"postgres", "postgresql"}:
    database_url = database_url.set(drivername="postgresql+asyncpg")
connect_args = {}
if database_url.drivername == "postgresql+asyncpg":
    sslmode = database_url.query.get("sslmode")
    database_url = database_url.difference_update_query(
        ["channel_binding", "sslmode"]
    )
    if sslmode == "require":
        connect_args["ssl"] = True

engine = create_async_engine(
    database_url,
    echo=False,
    connect_args={
        **({"check_same_thread": False} if database_url.drivername.startswith("sqlite") else {}),
        **connect_args,
    },
    pool_pre_ping=True,
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False
)

class Base(DeclarativeBase):
    pass

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
