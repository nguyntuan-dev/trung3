"""
CC-CEDICT Dictionary Service (SQLite Version)
Uses SQLite for storage to reduce RAM usage and eliminate large JSON/TXT files.
"""

import json
import os
import re
import random
from pathlib import Path
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

# Local imports
try:
    from database import engine
    import models
    from vietnamese import get_translation
except ImportError:
    from .database import engine
    from . import models
    from .vietnamese import get_translation

class CedictEntry:
    """DTO for dictionary entries."""
    __slots__ = ("traditional", "simplified", "pinyin", "english")

    def __init__(self, traditional: str, simplified: str, pinyin: str, english: list[str]):
        self.traditional = traditional
        self.simplified = simplified
        self.pinyin = pinyin
        self.english = english

    def to_dict(self, hsk: int = 0) -> dict:
        return {
            "traditional": self.traditional,
            "simplified": self.simplified,
            "pinyin": self.pinyin,
            "english": self.english,
            "vietnamese": get_translation(self.simplified),
            "hsk": hsk,
        }

class CedictDict:
    """Database-backed CC-CEDICT dictionary."""

    def __init__(self):
        self._loaded = False

    def load(self):
        """Initial check to ensure database is ready."""
        # Database should already be initialized by main.py
        self._loaded = True

    def _get_db(self):
        return Session(engine)

    def _get_hsk_level(self, db: Session, word: str) -> int:
        res = db.query(models.HSKWord.level).filter_by(word=word).first()
        return res[0] if res else 0

    def search(self, q: str, limit: int = 40, offset: int = 0) -> list[dict]:
        """Search by Chinese characters, pinyin or English via SQL."""
        q_lower = q.lower().strip()
        if not q_lower:
            return []

        db = self._get_db()
        try:
            # Query dictionary_entries
            # Note: We also search in Vietnamese meanings if possible, 
            # but since Vietnamese is in a separate table, we'll join or do a subquery if needed.
            # For now, let's keep it simple: search zh, pinyin, english.
            
            query = db.query(models.DictionaryEntry).filter(
                or_(
                    models.DictionaryEntry.simplified.contains(q_lower),
                    models.DictionaryEntry.traditional.contains(q_lower),
                    models.DictionaryEntry.pinyin.contains(q_lower),
                    models.DictionaryEntry.english.contains(q_lower)
                )
            )
            
            rows = query.offset(offset).limit(limit).all()
            
            results = []
            for row in rows:
                hsk = self._get_hsk_level(db, row.simplified)
                entry = CedictEntry(row.traditional, row.simplified, row.pinyin, json.loads(row.english))
                results.append(entry.to_dict(hsk))
            
            return results
        finally:
            db.close()

    def get_hsk(self, level: int, limit: int = 50, offset: int = 0) -> dict:
        """Get words for a specific HSK level from database."""
        db = self._get_db()
        try:
            total = db.query(models.HSKWord).filter_by(level=level).count()
            hsk_rows = db.query(models.HSKWord).filter_by(level=level).offset(offset).limit(limit).all()
            
            results = []
            for h in hsk_rows:
                # Lookup full entry
                entry_row = db.query(models.DictionaryEntry).filter_by(simplified=h.word).first()
                if entry_row:
                    entry = CedictEntry(entry_row.traditional, entry_row.simplified, entry_row.pinyin, json.loads(entry_row.english))
                    results.append(entry.to_dict(level))
                else:
                    results.append({
                        "traditional": h.word, "simplified": h.word,
                        "pinyin": "", "english": [], "vietnamese": get_translation(h.word), "hsk": level,
                    })
            return {"total": total, "words": results, "level": level}
        finally:
            db.close()

    def random_words(self, level: int = 0, count: int = 20) -> list[dict]:
        """Get random words from database."""
        db = self._get_db()
        try:
            if level:
                hsk_rows = db.query(models.HSKWord).filter_by(level=level).order_by(func.random()).limit(count).all()
                results = []
                for h in hsk_rows:
                    entry_row = db.query(models.DictionaryEntry).filter_by(simplified=h.word).first()
                    if entry_row:
                        entry = CedictEntry(entry_row.traditional, entry_row.simplified, entry_row.pinyin, json.loads(entry_row.english))
                        results.append(entry.to_dict(level))
                return results
            else:
                rows = db.query(models.DictionaryEntry).order_by(func.random()).limit(count).all()
                return [CedictEntry(r.traditional, r.simplified, r.pinyin, json.loads(r.english)).to_dict(self._get_hsk_level(db, r.simplified)) for r in rows]
        finally:
            db.close()

    def lookup(self, word: str) -> dict | None:
        """Exact lookup by simplified or traditional."""
        db = self._get_db()
        try:
            row = db.query(models.DictionaryEntry).filter(
                or_(models.DictionaryEntry.simplified == word, models.DictionaryEntry.traditional == word)
            ).first()
            
            if row:
                hsk = self._get_hsk_level(db, row.simplified)
                return CedictEntry(row.traditional, row.simplified, row.pinyin, json.loads(row.english)).to_dict(hsk)
            return None
        finally:
            db.close()

    def convert_pinyin_to_chinese(self, pinyin_str: str) -> dict:
        """Convert pinyin string to Chinese characters using database."""
        pinyin_str = pinyin_str.strip().lower()
        if not pinyin_str:
            return {'input': '', 'output': '', 'items': []}
        
        syllables = [s.strip() for s in pinyin_str.split()]
        result_chars = []
        result_items = []
        
        db = self._get_db()
        try:
            i = 0
            while i < len(syllables):
                syl = syllables[i]
                if not syl:
                    i += 1
                    continue
                
                matched = False
                for word_len in [3, 2]:
                    if i + word_len <= len(syllables):
                        pinyin_seq = ' '.join(syllables[i:i + word_len])
                        # Search multi-char word in DB
                        # We use exact match on pinyin and length
                        row = db.query(models.DictionaryEntry).filter(
                            func.length(models.DictionaryEntry.simplified) == word_len,
                            models.DictionaryEntry.pinyin == pinyin_seq
                        ).first()
                        
                        if row:
                            for j, char in enumerate(row.simplified):
                                result_chars.append(char)
                                result_items.append({
                                    'pinyin': syllables[i + j],
                                    'character': char,
                                    'options': [char],
                                })
                            i += word_len
                            matched = True
                            break
                
                if matched: continue
                
                # Single character match
                # Get matches sorted by HSK level (joined or subquery)
                matches = db.query(models.DictionaryEntry).filter(
                    func.length(models.DictionaryEntry.simplified) == 1,
                    models.DictionaryEntry.pinyin == syl
                ).all()
                
                # Sort by HSK level manually or via join
                # Let's do a simple sort
                unique_chars = []
                seen = set()
                
                # We need to check HSK level for each match
                matches_with_hsk = []
                for m in matches:
                    hsk = self._get_hsk_level(db, m.simplified)
                    matches_with_hsk.append((m, hsk or 999))
                
                matches_with_hsk.sort(key=lambda x: x[1])
                
                for m, hsk in matches_with_hsk:
                    if m.simplified not in seen:
                        unique_chars.append(m.simplified)
                        seen.add(m.simplified)
                        if len(unique_chars) >= 5: break
                
                if unique_chars:
                    chosen_char = unique_chars[0]
                    result_chars.append(chosen_char)
                    result_items.append({
                        'pinyin': syl,
                        'character': chosen_char,
                        'options': unique_chars,
                    })
                else:
                    result_chars.append('?')
                    result_items.append({
                        'pinyin': syl,
                        'character': '?',
                        'options': [],
                    })
                i += 1
            
            return {
                'input': pinyin_str,
                'output': ''.join(result_chars),
                'items': result_items,
            }
        finally:
            db.close()

    def hsk_summary(self) -> list[dict]:
        """Return summary of all HSK levels from database."""
        db = self._get_db()
        try:
            # Group by level
            results = db.query(models.HSKWord.level, func.count(models.HSKWord.id)).group_by(models.HSKWord.level).all()
            summaries = []
            for level, count in sorted(results):
                summaries.append({
                    "level": level,
                    "total": count,
                })
            return summaries
        finally:
            db.close()

# Singleton
cedict = CedictDict()
