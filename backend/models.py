from sqlalchemy import Column, Integer, String, Boolean
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

class UserAPI(Base):
    __tablename__ = "user_apis"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, index=True)
    api_name = Column(String, nullable=False)
    created_at = Column(String, nullable=False)
