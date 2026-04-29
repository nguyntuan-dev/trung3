import sys
from pathlib import Path

# Add backend directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from contextlib import asynccontextmanager
import os
from datetime import datetime, timedelta
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
import requests
from sqlalchemy.orm import Session
from sqlalchemy import func, inspect, text
from pydantic import BaseModel, Field

# Rate limiting
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from cedict_parser import cedict
from viet_dict import VI
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
from vietnamese import translate_to_chinese, translate_word


class AuthPayload(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=6, max_length=128)


class SavedWordPayload(BaseModel):
    word: str
    pinyin: str
    meaning: str
    hsk_level: int = 0


class BatchSavedWordsPayload(BaseModel):
    words: list[SavedWordPayload]



def user_to_dict(user: models.User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "is_admin": bool(user.is_admin),
        "is_active": bool(user.is_active),
    }


def ensure_schema_columns():
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    
    with engine.begin() as conn:
        # 1. Kiểm tra bảng users
        if "users" in tables:
            cols = {c["name"] for c in inspector.get_columns("users")}
            if "password_hash" not in cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN password_hash TEXT"))
            if "is_admin" not in cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE"))
            if "is_active" not in cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE"))

        # 2. Kiểm tra bảng saved_words (Đảm bảo có HSK và Pinyin)
        if "saved_words" in tables:
            cols = {c["name"] for c in inspector.get_columns("saved_words")}
            if "hsk_level" not in cols:
                conn.execute(text("ALTER TABLE saved_words ADD COLUMN hsk_level INTEGER DEFAULT 0"))
            if "pinyin" not in cols:
                conn.execute(text("ALTER TABLE saved_words ADD COLUMN pinyin TEXT"))

        # 3. Kiểm tra bảng user_progress (Cho tính năng SRS)
        if "user_progress" in tables:
            cols = {c["name"] for c in inspector.get_columns("user_progress")}
            if "interval_level" not in cols:
                conn.execute(text("ALTER TABLE user_progress ADD COLUMN interval_level INTEGER DEFAULT 0"))
            if "next_review" not in cols:
                conn.execute(text("ALTER TABLE user_progress ADD COLUMN next_review TIMESTAMP"))
            if "hsk_level" not in cols:
                conn.execute(text("ALTER TABLE user_progress ADD COLUMN hsk_level INTEGER DEFAULT 0"))
            if "correct_count" not in cols:
                conn.execute(text("ALTER TABLE user_progress ADD COLUMN correct_count INTEGER DEFAULT 0"))
            if "wrong_count" not in cols:
                conn.execute(text("ALTER TABLE user_progress ADD COLUMN wrong_count INTEGER DEFAULT 0"))

        # 4. Kiểm tra bảng user_sentences (Cho luyện nói cá nhân)
        if "user_sentences" in tables:
            cols = {c["name"] for c in inspector.get_columns("user_sentences")}
            if "hsk_level" not in cols:
                conn.execute(text("ALTER TABLE user_sentences ADD COLUMN hsk_level INTEGER DEFAULT 0"))
            if "pinyin" not in cols:
                conn.execute(text("ALTER TABLE user_sentences ADD COLUMN pinyin TEXT"))

    print("SUCCESS: Database schema synchronized.")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Tạo các bảng trong database (nếu chưa có)
    try:
        models.Base.metadata.create_all(bind=engine)
        ensure_schema_columns()
        bootstrap_result = cedict.bootstrap_static_data()
        db = next(get_db())
        try:
            ensure_admin_user(db)
        finally:
            db.close()
        print(f"SUCCESS: Static bootstrap ready {bootstrap_result}")
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


# Tự động dò tìm thư mục static để tương thích cả Local và Railway
_current_dir = os.path.dirname(os.path.abspath(__file__))
_parent_dir = os.path.dirname(_current_dir)

if os.path.exists(os.path.join(_parent_dir, "static")):
    STATIC_DIR = os.path.join(_parent_dir, "static")
else:
    # Fallback cho trường hợp Railway deploy bị lệch path
    STATIC_DIR = os.path.join(_current_dir, "static")

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


@app.get("/api/translate")
@limiter.limit("100/minute")
def translate_text(
    request: Request,
    text: str = Query(..., description="Text to translate"),
    from_lang: str = Query(..., description="Source language (vi, zh-CN, en)"),
    to_lang: str = Query(..., description="Target language (vi, zh-CN, en)"),
):
    if not text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    
    # Simple hardcoded translations for testing
    if from_lang == 'vi' and to_lang == 'zh-CN':
        if 'xin chào' in text.lower():
            return {"translated_text": "你好"}
        elif 'tôi thích' in text.lower():
            return {"translated_text": "我喜欢"}
        else:
            return {"translated_text": "测试翻译"}
    elif from_lang == 'zh-CN' and to_lang == 'vi':
        if '你好' in text:
            return {"translated_text": "Xin chào"}
        elif '我喜欢' in text:
            return {"translated_text": "Tôi thích"}
        else:
            return {"translated_text": "Dịch thử nghiệm"}
    else:
        return {"translated_text": f"[Translated from {from_lang} to {to_lang}]: {text}"}


@app.get("/api/search")
@limiter.limit("30/minute")
def search_words(
    request: Request,
    q: str = Query("", description="Tìm kiếm bằng chữ Hán, pinyin hoặc tiếng Anh"),
    limit: int = Query(40, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    q = q.strip()
    if not q:
        return {"query": q, "count": 0, "results": []}

    # 1. Kiểm tra nếu là câu chữ Hán dài (> 2 ký tự) mà không tìm thấy kết quả trực tiếp
    is_hanzi = any('\u4e00' <= c <= '\u9fff' for c in q)
    search_target = q

    # Nếu không có chữ Hán (có thể là tiếng Việt/Anh) và có dấu cách hoặc chuỗi dài
    if not is_hanzi and (" " in q or len(q) > 8):
        try:
            from vietnamese import translate_to_chinese
            translated = translate_to_chinese(q)
            if translated and any('\u4e00' <= c <= '\u9fff' for c in translated):
                search_target = translated
                is_hanzi = True # Chuỗi sau khi dịch là Hán tự
        except:
            pass
    
    # Thử tìm kiếm trực tiếp trước
    results = cedict.search(q, limit=limit, offset=offset)

    # 2. Nếu là chuỗi Hán tự (trực tiếp hoặc sau khi dịch) -> Thực hiện tách câu (Segmentation)
    if is_hanzi and (len(search_target) > 2 or search_target != q):
        segmented = []
        text_to_seg = search_target
        i = 0
        while i < len(text_to_seg):
            match_found = False
            # Tìm từ dài nhất có thể (tối đa 6 ký tự)
            for length in range(min(len(text_to_seg) - i, 7), 0, -1):
                sub = text_to_seg[i:i+length]
                entry = cedict.lookup(sub)
                if entry:
                    if sub in VI:
                        entry["vietnamese"] = VI[sub]
                    segmented.append(entry)
                    i += length
                    match_found = True
                    break
            if not match_found:
                i += 1 # Bỏ qua ký tự không hiểu
        
        if segmented:
            # Gộp kết quả tìm kiếm ban đầu và kết quả tách câu, tránh trùng lặp
            seen = {r['simplified'] for r in results}
            for item in segmented:
                if item['simplified'] not in seen:
                    results.append(item)
                    seen.add(item['simplified'])
            return {"query": q, "translated": search_target if search_target != q else None, "count": len(results), "results": results[:limit], "type": "segmentation"}

    # 3. Nếu kết quả ít, tìm kiếm bổ sung trong từ điển Tiếng Việt (VI)
    # Hỗ trợ tìm từ Hán bằng nghĩa tiếng Việt (ví dụ: gõ "yêu" ra từ "爱")
    if len(results) < 5:
        q_lower = q.lower()
        vi_matches = []
        for hanzi, meaning in VI.items():
            if q_lower in meaning.lower() or q_lower == hanzi:
                if any(r.get("simplified") == hanzi for r in results):
                    continue
                entry = cedict.lookup(hanzi)
                if entry:
                    entry["vietnamese"] = meaning
                    vi_matches.append(entry)
                else:
                    vi_matches.append({"simplified": hanzi, "pinyin": "", "english": [], "vietnamese": meaning})
        results = results + vi_matches

    # 4. Cập nhật/Bổ sung nghĩa tiếng Việt từ file viet_dict cho các kết quả CEDICT
    for r in results:
        simp = r.get("simplified")
        if simp in VI and not r.get("vietnamese"):
            r["vietnamese"] = VI[simp]

    return {"query": q, "count": len(results), "results": results[:limit]}


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
@limiter.limit("30/minute")
def save_word(
    request: Request,
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


@app.post("/api/saved_words/batch")
@limiter.limit("10/minute")
def save_words_batch(
    request: Request,
    payload: BatchSavedWordsPayload,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    """Lưu nhiều từ cùng lúc để giảm số lượng request và lag."""
    saved_count = 0
    skipped_count = 0
    
    for item in payload.words:
        existing = db.query(models.SavedWord).filter(
            models.SavedWord.user_id == user.id,
            models.SavedWord.word == item.word,
        ).first()
        
        if existing:
            skipped_count += 1
            continue
            
        new_word = models.SavedWord(
            user_id=user.id,
            word=item.word,
            pinyin=item.pinyin,
            meaning=item.meaning,
            hsk_level=item.hsk_level,
        )
        db.add(new_word)
        saved_count += 1
        
    if saved_count > 0:
        db.commit()
        
    return {
        "msg": f"Processed {len(payload.words)} words",
        "saved": saved_count,
        "skipped": skipped_count,
        "status": "success"
    }



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
        background_tasks.add_task(cedict.preload_hsk_words)
        return {"msg": "HSK and Vietnamese cache rebuilt from bundled data.", "status": "success"}
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


@app.post("/api/pronounce/user-sentences")
def save_user_sentence(
    payload: SavedWordPayload,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    new_sentence = models.UserSentence(
        user_id=user.id,
        word=payload.word,
        pinyin=payload.pinyin,
        meaning=payload.meaning,
        hsk_level=payload.hsk_level,
    )
    db.add(new_sentence)
    db.commit()
    db.refresh(new_sentence)
    return {"msg": "Saved", "status": "success", "id": new_sentence.id}


@app.get("/api/pronounce/user-sentences")
def get_user_sentences(
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    # 1. Lấy câu tự thêm từ bảng UserSentence
    custom_sents = db.query(models.UserSentence)\
        .filter(models.UserSentence.user_id == user.id)\
        .order_by(models.UserSentence.id.desc())\
        .all()
    
    # 2. Lấy từ đã lưu từ bảng SavedWord (những từ bạn bấm Save ở từ điển)
    saved_words = db.query(models.SavedWord)\
        .filter(models.SavedWord.user_id == user.id)\
        .order_by(models.SavedWord.id.desc())\
        .all()

    # 3. Gộp và format lại cho Frontend (zh, pinyin, vi)
    results = [
        {
            "id": s.id,
            "zh": s.word,
            "pinyin": s.pinyin,
            "vi": s.meaning,
            "level": 0,
            "type": "custom"
        } for s in custom_sents
    ] + [
        {
            "id": w.id,
            "zh": w.word,
            "pinyin": w.pinyin,
            "vi": w.meaning,
            "level": w.hsk_level,
            "type": "saved"
        } for w in saved_words
    ]

    return {"sentences": results, "count": len(results)}


@app.get("/api/lookup/{word}")
def lookup_word(word: str):
    word = word.strip()
    if not word:
        return {"error": "Empty input"}

    is_hanzi_input = any('\u4e00' <= c <= '\u9fff' for c in word)
    final_zh = ""

    if is_hanzi_input:
        final_zh = word
    else:
        # Kiểm tra xem có phải Pinyin không (có số hoặc chỉ chứa ký tự latin không dấu phổ biến)
        # Nếu có dấu cách hoặc số -> Thử convert pinyin trước
        if any(c.isdigit() for c in word) or (" " in word and not any(c in "àáạảãèéẹẻẽìíịỉĩòóọỏõùúụủũưứừựửữ" for c in word.lower())):
            conv = cedict.convert_pinyin_to_chinese(word)
            if conv and conv.get("output") and any('\u4e00' <= c <= '\u9fff' for c in conv["output"]):
                final_zh = conv["output"]
        
        # Nếu vẫn chưa có (không phải Pinyin hoặc là tiếng Việt) -> Dịch sang tiếng Trung
        if not final_zh:
            translated = translate_to_chinese(word)
            if translated and any('\u4e00' <= c <= '\u9fff' for c in translated):
                final_zh = translated
            else:
                # Nếu dịch xịt nhưng input là latin đơn giản, thử convert pinyin lần cuối
                conv = cedict.convert_pinyin_to_chinese(word)
                if conv and conv.get("output"):
                    final_zh = conv["output"]

    # Nếu không tìm thấy chữ Hán nào hợp lệ
    if not final_zh or not any('\u4e00' <= c <= '\u9fff' for c in final_zh):
        return {"error": "Not found", "word": word}

    if final_zh:
        pinyins = []
        i = 0
        while i < len(final_zh):
            found = False
            for length in range(min(len(final_zh) - i, 7), 0, -1):
                sub = final_zh[i:i+length]
                entry = cedict.lookup(sub)
                if entry:
                    pinyins.append(entry.get("pinyin", ""))
                    i += length
                    found = True
                    break
            if not found:
                pinyins.append(final_zh[i])
                i += 1
        
        return {
            "simplified": final_zh,
            "pinyin": " ".join(pinyins),
            "vietnamese": VI.get(final_zh) or translate_word(final_zh) or word # Trả lại chính input nếu không dịch được
        }

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


# ── SRS + PROGRESS TRACKING ──

class ProgressUpdate(BaseModel):
    word: str
    hsk_level: int
    is_correct: bool

@app.post("/api/progress")
def update_progress(payload: ProgressUpdate, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Update progress for a word (SRS + tracking)"""
    # Find or create progress record
    prog = db.query(models.UserProgress).filter(
        models.UserProgress.user_id == user.id,
        models.UserProgress.word == payload.word
    ).first()
    
    if not prog:
        prog = models.UserProgress(
            user_id=user.id,
            word=payload.word,
            hsk_level=payload.hsk_level
        )
        db.add(prog)
    
    # Update counts and SRS interval
    if payload.is_correct:
        prog.correct_count = (prog.correct_count or 0) + 1
        # Logic: Đúng -> 3 -> 7 -> 30 ngày (cấp độ 1, 2, 3)
        prog.interval_level = min(3, prog.interval_level + 1)
    else:
        prog.wrong_count = (prog.wrong_count or 0) + 1
        # Logic: Sai -> 1 ngày (reset về cấp độ 0)
        prog.interval_level = 0
    
    # Calculate next review date
    intervals = [1, 3, 7, 30] 
    days_delta = intervals[min(prog.interval_level, len(intervals) - 1)]
    prog.next_review = datetime.utcnow() + timedelta(days=days_delta)
    prog.last_reviewed = datetime.utcnow()
    
    db.commit()
    return {"status": "ok", "interval_level": prog.interval_level, "next_review": prog.next_review}

@app.get("/api/review-queue")
def get_review_queue(
    level: int = Query(0, ge=0, le=6, description="HSK level (0=all)"),
    limit: int = Query(20, ge=1, le=100),
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get words due for review (SRS queue)"""
    now = datetime.utcnow()
    query = db.query(models.UserProgress).filter(
        models.UserProgress.user_id == user.id,
        models.UserProgress.next_review <= now
    )
    
    if level > 0:
        query = query.filter(models.UserProgress.hsk_level == level)
    
    # Sắp xếp theo next_review tăng dần: Từ cũ nhất (quá hạn lâu nhất) lên trước
    words = query.order_by(models.UserProgress.next_review.asc()).limit(limit).all()
    
    result = []
    for w in words:
        entry = cedict.lookup(w.word)
        if entry:
            result.append({
                "word": w.word,
                "pinyin": entry.get("pinyin", ""),
                "english": entry.get("english", []),
                "vietnamese": entry.get("vietnamese", ""),
                "hsk_level": w.hsk_level,
                "correct_count": w.correct_count,
                "wrong_count": w.wrong_count,
                "interval_level": w.interval_level
            })
    
    return {"total": len(result), "words": result}

@app.get("/api/progress/stats")
def get_progress_stats(
    level: int = Query(0, ge=0, le=6, description="HSK level (0=all)"),
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get learning statistics"""
    base_query = db.query(models.UserProgress).filter(models.UserProgress.user_id == user.id)
    
    if level > 0:
        base_query = base_query.filter(models.UserProgress.hsk_level == level)
    
    progs = base_query.all()
    now = datetime.utcnow()
    
    # Đếm số lượng từ đã đến hạn hoặc quá hạn ôn tập
    due_count = db.query(models.UserProgress).filter(
        models.UserProgress.user_id == user.id,
        models.UserProgress.next_review <= now
    ).count()
    
    total_words = len(progs)
    learned = sum(1 for p in progs if p.interval_level >= 3)  # 7+ days = well-learned
    total_correct = sum(p.correct_count for p in progs)
    total_wrong = sum(p.wrong_count for p in progs)
    
    accuracy = 100.0 if total_correct + total_wrong == 0 else (total_correct * 100.0) / (total_correct + total_wrong)
    
    return {
        "due_count": due_count,
        "total_words": total_words,
        "learned": learned,
        "total_attempts": total_correct + total_wrong,
        "accuracy": round(accuracy, 2),
        "total_correct": total_correct,
        "total_wrong": total_wrong
    }
