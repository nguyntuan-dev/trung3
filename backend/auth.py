import base64
import hashlib
import hmac
import json
import os
import secrets
import time

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

try:
    import models
    from database import get_db
except ModuleNotFoundError:
    from . import models
    from .database import get_db


SECRET_KEY = os.getenv("SECRET_KEY") or os.getenv("JWT_SECRET") or "dev-change-this-secret"
TOKEN_TTL_SECONDS = int(os.getenv("TOKEN_TTL_SECONDS", str(60 * 60 * 24 * 7)))
ADMIN_USERNAME = "admin1811"
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin1811")


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return f"pbkdf2_sha256${salt}${digest.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        scheme, salt, expected = password_hash.split("$", 2)
    except ValueError:
        return False
    if scheme != "pbkdf2_sha256":
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return hmac.compare_digest(digest.hex(), expected)


def create_token(user: models.User) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "is_admin": bool(user.is_admin),
        "exp": int(time.time()) + TOKEN_TTL_SECONDS,
    }
    signing_input = ".".join([
        _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8")),
        _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")),
    ])
    signature = hmac.new(SECRET_KEY.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256).digest()
    return f"{signing_input}.{_b64url_encode(signature)}"


def decode_token(token: str) -> dict:
    try:
        header_b64, payload_b64, signature_b64 = token.split(".")
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc

    signing_input = f"{header_b64}.{payload_b64}"
    expected = hmac.new(SECRET_KEY.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256).digest()
    actual = _b64url_decode(signature_b64)
    if not hmac.compare_digest(actual, expected):
        raise HTTPException(status_code=401, detail="Invalid token")

    payload = json.loads(_b64url_decode(payload_b64))
    if int(payload.get("exp", 0)) < int(time.time()):
        raise HTTPException(status_code=401, detail="Token expired")
    return payload


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> models.User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Login required")
    payload = decode_token(authorization.split(" ", 1)[1].strip())
    user = db.query(models.User).filter(models.User.id == int(payload["sub"])).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


def get_optional_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> models.User | None:
    if not authorization:
        return None
    try:
        return get_current_user(authorization=authorization, db=db)
    except HTTPException:
        return None


def require_admin(user: models.User = Depends(get_current_user)) -> models.User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin only")
    return user


def ensure_admin_user(db: Session) -> None:
    admin = db.query(models.User).filter(models.User.username == ADMIN_USERNAME).first()
    if admin:
        changed = False
        if not admin.is_admin:
            admin.is_admin = True
            changed = True
        if not admin.is_active:
            admin.is_active = True
            changed = True
        if changed:
            db.commit()
        return

    db.add(models.User(
        username=ADMIN_USERNAME,
        password_hash=hash_password(ADMIN_PASSWORD),
        is_admin=True,
        is_active=True,
    ))
    db.commit()
