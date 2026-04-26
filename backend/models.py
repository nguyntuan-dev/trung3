from sqlalchemy import Column, Integer, String, Boolean, Float, DateTime, ForeignKey
from datetime import datetime
try:
    from database import Base
except ModuleNotFoundError:
    from .database import Base

# Dưới đây là các bảng ví dụ sẽ được tạo tự động trong PostgreSQL
class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    password_hash = Column(String)
    is_admin = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)

class SavedWord(Base):
    __tablename__ = "saved_words"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    word = Column(String, index=True)
    pinyin = Column(String)
    meaning = Column(String)
    hsk_level = Column(Integer, default=0)

class UserSentence(Base):
    __tablename__ = "user_sentences"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    word = Column(String)  # Chinese text
    pinyin = Column(String)
    meaning = Column(String)  # Vietnamese meaning
    hsk_level = Column(Integer, default=0)

class UserAPI(Base):
    __tablename__ = "user_apis"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    api_name = Column(String, nullable=False)
    created_at = Column(String, nullable=False)

# ── SRS + Progress Tracking ──

class UserProgress(Base):
    __tablename__ = "user_progress"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    word = Column(String, index=True)  # simplified form
    hsk_level = Column(Integer, default=0)
    correct_count = Column(Integer, default=0)
    wrong_count = Column(Integer, default=0)
    last_reviewed = Column(DateTime, default=datetime.utcnow)
    next_review = Column(DateTime, default=datetime.utcnow)
    interval_level = Column(Integer, default=0)  # 0=new, 1=1day, 2=3days, 3=7days, 4=30days

class ReviewQueue(Base):
    __tablename__ = "review_queue"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    word = Column(String, index=True)
    hsk_level = Column(Integer, default=0)
    next_review_date = Column(DateTime, index=True)
    interval_level = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

class GameScore(Base):
    __tablename__ = "game_scores"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    game_type = Column(String)  # "matching", "listen", "sort_sentence"
    hsk_level = Column(Integer)
    score = Column(Integer)  # 0-100
    combo = Column(Integer, default=0)
    played_at = Column(DateTime, default=datetime.utcnow)

class ContextExample(Base):
    __tablename__ = "context_examples"
    
    id = Column(Integer, primary_key=True, index=True)
    word = Column(String, index=True)  # simplified form
    hsk_level = Column(Integer)
    example_type = Column(String)  # "example", "dialogue", "situation"
    zh_text = Column(String)
    pinyin = Column(String)
    vi_meaning = Column(String)
    audio_url = Column(String, nullable=True)
