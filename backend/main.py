import sys
from pathlib import Path

# Add backend directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from contextlib import asynccontextmanager
import os
from datetime import datetime
from dotenv import load_dotenv

# ✅ PHẢI gọi load_dotenv() TRƯỚC KHI import database
load_dotenv()

ACCESS_LOGS = []

from fastapi import FastAPI, Query, Request, HTTPException, Depends, BackgroundTasks, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from fastapi.exceptions import RequestValidationError
import urllib.request
import urllib.parse
from sqlalchemy.orm import Session
from sqlalchemy import func, inspect, text
from pydantic import BaseModel, Field

# Rate limiting
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from cedict_parser import cedict
from database import engine, Base, get_db
import models
from auth import (
    create_token,
    ensure_admin_user,
    get_current_user,
    get_optional_user,
    hash_password,
    require_admin,
    verify_password,
)
from sentences import get_random_sentences


class AuthPayload(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=6, max_length=128)


class SavedWordPayload(BaseModel):
    word: str
    pinyin: str
    meaning: str
    hsk_level: int = 0


def user_to_dict(user: models.User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "is_admin": bool(user.is_admin),
        "is_active": bool(user.is_active),
    }


def ensure_schema_columns():
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return
    user_cols = {c["name"] for c in inspector.get_columns("users")}
    with engine.begin() as conn:
        if "password_hash" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN password_hash TEXT"))
        if "is_admin" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE"))
        if "is_active" not in user_cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE"))

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Tạo các bảng trong database (nếu chưa có)
    try:
        models.Base.metadata.create_all(bind=engine)
        ensure_schema_columns()
        db = next(get_db())
        try:
            ensure_admin_user(db)
        finally:
            db.close()
        print("SUCCESS: Database tables ready")
    except Exception as e:
        print(f"ERROR: Table creation failed: {e}")
    cedict.load()
    yield

app = FastAPI(
    title="汉语Go API",
    version="1.0.0",
    description="API tra từ điển CC-CEDICT & học tiếng Trung theo chuẩn HSK.",
    lifespan=lifespan,
)

# Initialize Limiter
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={"detail": "Quá nhiều yêu cầu. Vui lòng thử lại sau."},
    )

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # Chuyển đổi lỗi validation từ list/object phức tạp thành chuỗi đơn giản
    # Giúp bảo mật cấu trúc schema và tránh hiển thị [object Object] ở frontend
    error_details = exc.errors()
    msg = "Dữ liệu không hợp lệ"
    if error_details:
        err = error_details[0]
        field = ".".join(str(l) for l in err.get("loc", []) if l != "body")
        msg = f"Lỗi: {err.get('msg')}" + (f" (trường {field})" if field else "")
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": msg},
    )

@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": str(exc.detail)})
    # Log lỗi thực tế ở server (không trả về client để bảo mật)
    print(f"CRITICAL ERROR: {exc}")
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau."},
    )

# CORS Configuration from .env
origins = os.getenv("CORS_ORIGINS", "*").split(",")
if "*" in origins:
    origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Custom Security & Anti-Bot Middleware
@app.middleware("http")
async def security_checks(request: Request, call_next):
    # Ghi lại log truy cập thiết bị
    ua_raw = request.headers.get("user-agent", "Unknown")
    log_entry = {
        "time": datetime.now().strftime("%H:%M:%S %d/%m"),
        "ip": request.client.host if request.client else "0.0.0.0",
        "device": ua_raw[:80] + "..." if len(ua_raw) > 80 else ua_raw,
        "path": request.url.path
    }
    ACCESS_LOGS.append(log_entry)
    if len(ACCESS_LOGS) > 100:  # Giới hạn 100 bản ghi gần nhất
        ACCESS_LOGS.pop(0)

    ua = request.headers.get("user-agent", "").lower()
    bot_keywords = ["python-requests", "aiohttp", "curl", "wget", "headlesschrome"]
    # Allow bots on localhost
    if request.url.hostname and "localhost" in request.url.hostname or "127.0.0.1" in str(request.url.hostname):
        return await call_next(request)
    
    if any(bot in ua for bot in bot_keywords):
        raise HTTPException(status_code=403, detail="Bots not allowed")

    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "static")

# ✅ Serve frontend tại route "/"
@app.get("/")
def root():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/admin1811")
def admin_entry():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


# ✅ Mount static files (CSS, JS, ảnh...)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.post("/api/auth/register")
def register(payload: AuthPayload, db: Session = Depends(get_db)):
    username = payload.username.strip().lower()
    if not username.replace("_", "").replace("-", "").isalnum():
        raise HTTPException(status_code=400, detail="Username can only contain letters, numbers, _ and -")
    existing = db.query(models.User).filter(models.User.username == username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")

    user = models.User(
        username=username,
        password_hash=hash_password(payload.password),
        is_admin=(username == "admin1811"),
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"token": create_token(user), "user": user_to_dict(user)}


@app.post("/api/auth/login")
def login(payload: AuthPayload, db: Session = Depends(get_db)):
    username = payload.username.strip().lower()
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")
    return {"token": create_token(user), "user": user_to_dict(user)}


@app.get("/api/auth/me")
def me(user: models.User = Depends(get_current_user)):
    return user_to_dict(user)


@app.post("/api/auth/logout")
def logout():
    # For JWT, logout is client-side, but we can return success
    return {"message": "Logged out successfully"}


@app.get("/api/admin/users")
def admin_users(
    admin: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    rows = db.query(models.User).order_by(models.User.id.desc()).all()
    return [user_to_dict(u) for u in rows]


@app.patch("/api/admin/users/{user_id}/active")
def admin_set_user_active(
    user_id: int,
    is_active: bool = Query(...),
    admin: models.User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.username == "admin1811":
        raise HTTPException(status_code=400, detail="Cannot disable admin1811")
    user.is_active = is_active
    db.commit()
    db.refresh(user)
    return user_to_dict(user)


@app.get("/api/admin/logs")
def admin_logs(admin: models.User = Depends(require_admin)):
    return ACCESS_LOGS


@app.get("/api/search")
@limiter.limit("30/minute")
def search_words(
    request: Request,
    q: str = Query("", description="Tìm kiếm bằng chữ Hán, pinyin hoặc tiếng Anh"),
    limit: int = Query(40, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    results = cedict.search(q, limit=limit, offset=offset)
    return {"query": q, "count": len(results), "results": results}


@app.get("/api/hsk/{level}")
def get_hsk_words(
    level: int,
    limit: int = Query(50, ge=1, le=300),
    offset: int = Query(0, ge=0),
):
    if level < 1 or level > 6:
        return {"error": "Level must be 1-6"}
    return cedict.get_hsk(level, limit=limit, offset=offset)



@app.post("/api/saved_words")
def save_word(
    payload: SavedWordPayload,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    existing = db.query(models.SavedWord).filter(
        models.SavedWord.user_id == user.id,
        models.SavedWord.word == payload.word,
    ).first()
    if existing:
        return {"msg": "Already saved", "status": "exists"}

    new_word = models.SavedWord(
        user_id=user.id,
        word=payload.word,
        pinyin=payload.pinyin,
        meaning=payload.meaning,
        hsk_level=payload.hsk_level,
    )
    db.add(new_word)
    db.commit()
    return {"msg": "Saved", "status": "success"}


@app.get("/api/saved_words")
def get_saved_words(
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    words = db.query(models.SavedWord)\
        .filter(models.SavedWord.user_id == user.id)\
        .order_by(models.SavedWord.id.desc())\
        .all()
    return [
        {
            "id": w.id,
            "word": w.word,
            "pinyin": w.pinyin,
            "meaning": w.meaning,
            "hsk_level": w.hsk_level
        } for w in words
    ]


@app.delete("/api/saved_words/{word_id}")
def delete_saved_word(
    word_id: int,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    word = db.query(models.SavedWord).filter(
        models.SavedWord.id == word_id,
        models.SavedWord.user_id == user.id,
    ).first()
    if word:
        db.delete(word)
        db.commit()
        return {"status": "success"}
    return {"status": "error", "msg": "Not found"}


@app.get("/api/flashcard/saved")
def get_saved_words_flashcard(
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Lấy danh sách từ đã lưu cho flashcard"""
    words = db.query(models.SavedWord)\
        .filter(models.SavedWord.user_id == user.id)\
        .order_by(models.SavedWord.id.desc())\
        .all()
    
    if not words:
        return {"words": [], "count": 0}
    
    result = []
    for w in words:
        entry = cedict.lookup(w.word)
        if entry:
            result.append({
                "id": w.id,
                "simplified": entry.get("simplified", w.word),
                "traditional": entry.get("traditional", w.word),
                "pinyin": entry.get("pinyin", w.pinyin),
                "english": entry.get("english", []),
                "vietnamese": entry.get("vietnamese", w.meaning),
                "hsk": entry.get("hsk", w.hsk_level),
            })
        else:
            result.append({
                "id": w.id,
                "simplified": w.word,
                "traditional": w.word,
                "pinyin": w.pinyin,
                "english": [],
                "vietnamese": w.meaning,
                "hsk": w.hsk_level,
            })

    return {"words": result, "count": len(result)}


@app.get("/api/hsk")
def hsk_summary(
    db: Session = Depends(get_db),
    user: models.User | None = Depends(get_optional_user),
):
    summary = cedict.hsk_summary()
    q = db.query(models.SavedWord.hsk_level, func.count(models.SavedWord.id))
    if user:
        q = q.filter(models.SavedWord.user_id == user.id)
    db_counts = q.group_by(models.SavedWord.hsk_level).all()
    db_map = {level: count for level, count in db_counts if level > 0}
    for s in summary:
        s["learned"] = db_map.get(s["level"], 0)
    return summary
@app.post("/api/hsk/update")
def update_hsk_database(background_tasks: BackgroundTasks):
    # Tải danh sách từ nhanh chóng (không dịch ngay)
    success = cedict.download_hsk_data(preload=False)
    if success:
        # Chạy việc dịch nghĩa ở background để không làm treo UI
        background_tasks.add_task(cedict.preload_hsk_words, cedict.hsk_words)
        return {"msg": "HSK database updated. Translation processing in background.", "status": "success"}
    else:
        return {"msg": "Update failed", "status": "error"}


@app.get("/api/random")
@limiter.limit("40/minute")
def random_words(
    request: Request,
    level: int = Query(0, ge=0, le=6, description="HSK level (0 = all)"),
    count: int = Query(20, ge=1, le=100),
):
    return cedict.random_words(level=level, count=count)


@app.get("/api/sentences")
@limiter.limit("40/minute")
def random_sentences(
    request: Request,
    level: int = Query(1, ge=1, le=6, description="HSK level"),
    count: int = Query(10, ge=1, le=30),
):
    sentences = get_random_sentences(level, count)
    return {"sentences": sentences, "count": len(sentences)}


@app.get("/api/pronounce/sentences")
@limiter.limit("40/minute")
def pronounce_sentences(
    request: Request,
    level: int = Query(1, ge=1, le=6, description="HSK level"),
    count: int = Query(24, ge=1, le=100),
):
    sentences = get_random_sentences(level, count)
    return {"sentences": sentences, "count": len(sentences)}


@app.get("/api/lookup/{word}")
def lookup_word(word: str):
    result = cedict.lookup(word)
    if result:
        return result
    return {"error": "Not found", "word": word}

@app.get("/api/audio")
@limiter.limit("60/minute")
def get_audio(request: Request, text: str):
    url = f"https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=zh-CN&q={urllib.parse.quote(text)}"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        response = urllib.request.urlopen(req, timeout=5)
        def iterfile():
            while chunk := response.read(8192):
                yield chunk
        return StreamingResponse(iterfile(), media_type="audio/mpeg")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"TTS service unavailable: {e}")


@app.get("/api/pinyin-to-chinese")
@limiter.limit("100/minute")
def convert_pinyin(request: Request, pinyin: str = Query("", description="Pinyin string (e.g. 'wo3 shi4 yi2 ge4 xue2 sheng1')")):
    """Convert pinyin to Chinese characters word by word."""
    return cedict.convert_pinyin_to_chinese(pinyin)
