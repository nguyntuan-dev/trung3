import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL")
DEFAULT_SQLITE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "local.db")

if not DATABASE_URL:
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
    return create_engine(url, connect_args=ca)


# Thử kết nối Postgres; nếu lỗi → fallback SQLite
engine = _make_engine(DATABASE_URL)

if not DATABASE_URL.startswith("sqlite"):
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print("SUCCESS: Database connected successfully")
    except Exception as e:
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
