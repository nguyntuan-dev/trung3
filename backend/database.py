import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

load_dotenv()

DEFAULT_SQLITE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "local.db")


def _is_truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _build_database_url() -> str | None:
    direct_url = os.environ.get("DATABASE_URL")
    if direct_url:
        return direct_url

    pg_host = os.environ.get("PGHOST")
    pg_database = os.environ.get("PGDATABASE")
    pg_user = os.environ.get("PGUSER")
    pg_password = os.environ.get("PGPASSWORD")
    pg_port = os.environ.get("PGPORT", "5432")

    if pg_host and pg_database and pg_user and pg_password:
        return f"postgresql://{pg_user}:{pg_password}@{pg_host}:{pg_port}/{pg_database}"

    return None


DATABASE_URL = _build_database_url()
IS_RAILWAY = bool(os.environ.get("RAILWAY_ENVIRONMENT") or os.environ.get("RAILWAY_PROJECT_ID"))
REQUIRE_PERSISTENT_DB = _is_truthy(os.environ.get("REQUIRE_PERSISTENT_DB")) or IS_RAILWAY

if not DATABASE_URL:
    if REQUIRE_PERSISTENT_DB:
        raise RuntimeError(
            "Persistent database is required, but DATABASE_URL/PG* is missing. "
            "Attach Railway Postgres and set DATABASE_URL."
        )
    DATABASE_URL = f"sqlite:///{DEFAULT_SQLITE_PATH}"
    print(f"WARNING: DATABASE_URL not found, using SQLite: {DEFAULT_SQLITE_PATH}")
else:
    print("SUCCESS: DATABASE_URL loaded OK")

# Fix URL cũ của Heroku: postgres:// → postgresql://
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)


def _make_engine(url: str):
    """Tạo engine, SQLite cần connect_args riêng."""
    ca = {"check_same_thread": False} if url.startswith("sqlite") else {}
    engine = create_engine(url, connect_args=ca)
    
    # Enable WAL mode for SQLite to prevent locking lag
    if url.startswith("sqlite"):
        from sqlalchemy import event
        @event.listens_for(engine, "connect")
        def set_sqlite_pragma(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.close()
            
    return engine



# Thử kết nối Postgres; production/Railway không được fallback về SQLite.
engine = _make_engine(DATABASE_URL)

if not DATABASE_URL.startswith("sqlite"):
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print("SUCCESS: Database connected successfully")
    except Exception as e:
        if REQUIRE_PERSISTENT_DB:
            raise RuntimeError(
                f"Could not connect to persistent database: {e}. "
                "Refusing to fall back to ephemeral SQLite."
            ) from e
        print(f"ERROR: Could not connect to database ({e})")
        print(f"WARNING: Fallback to SQLite: {DEFAULT_SQLITE_PATH}")
        DATABASE_URL = f"sqlite:///{DEFAULT_SQLITE_PATH}"
        engine = _make_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
