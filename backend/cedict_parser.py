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
    from viet_dict import VI, get_hsk_words_by_level
except ImportError:
    from .database import engine
    from . import models
    from .vietnamese import get_translation
    from .viet_dict import VI, get_hsk_words_by_level

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
        self._bootstrap_seed_path = Path(__file__).resolve().parent.parent / "data" / "hsk_bootstrap.json"

    def load(self):
        """Initial check to ensure database is ready."""
        # Database should already be initialized by main.py
        self._loaded = True

    def bootstrap_static_data(self) -> dict[str, int]:
        """
        Seed HSK and Vietnamese cache data from the bundled static dictionary.
        This keeps Railway/Postgres deployments usable even when the old SQLite
        file is not present.
        """
        if self._bootstrap_seed_path.exists():
            return self._bootstrap_from_seed_file()

        db = self._get_db()
        added_hsk = 0
        added_translations = 0
        try:
            hsk_words_by_level = get_hsk_words_by_level()

            existing_hsk = {
                (word, level)
                for word, level in db.query(models.HSKWord.word, models.HSKWord.level).all()
            }
            for level, words in hsk_words_by_level.items():
                for word in words:
                    key = (word, level)
                    if key in existing_hsk:
                        continue
                    db.add(models.HSKWord(word=word, level=level))
                    existing_hsk.add(key)
                    added_hsk += 1

            existing_translations = {
                word
                for (word,) in db.query(models.TranslationCache.word).all()
            }
            for word, meaning in VI.items():
                if word in existing_translations:
                    continue
                db.add(models.TranslationCache(word=word, vietnamese=meaning))
                existing_translations.add(word)
                added_translations += 1

            if added_hsk or added_translations:
                db.commit()

            return {
                "hsk_words_added": added_hsk,
                "translations_added": added_translations,
            }
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def _bootstrap_from_seed_file(self) -> dict[str, int]:
        db = self._get_db()
        added_hsk = 0
        added_translations = 0
        added_entries = 0
        try:
            seed_rows = json.loads(self._bootstrap_seed_path.read_text(encoding="utf-8"))
            existing_hsk = {
                (word, level)
                for word, level in db.query(models.HSKWord.word, models.HSKWord.level).all()
            }
            existing_translations = {
                word
                for (word,) in db.query(models.TranslationCache.word).all()
            }
            existing_entries = {
                simplified
                for (simplified,) in db.query(models.DictionaryEntry.simplified).all()
            }

            for row in seed_rows:
                word = row["word"]
                level = int(row["level"])
                hsk_key = (word, level)
                if hsk_key not in existing_hsk:
                    db.add(models.HSKWord(word=word, level=level))
                    existing_hsk.add(hsk_key)
                    added_hsk += 1

                if word not in existing_entries:
                    db.add(
                        models.DictionaryEntry(
                            traditional=row.get("traditional") or word,
                            simplified=row.get("simplified") or word,
                            pinyin=row.get("pinyin", ""),
                            english=json.dumps(row.get("english", []), ensure_ascii=False),
                        )
                    )
                    existing_entries.add(word)
                    added_entries += 1

                meaning = row.get("vietnamese") or VI.get(word, "")
                if meaning and word not in existing_translations:
                    db.add(models.TranslationCache(word=word, vietnamese=meaning))
                    existing_translations.add(word)
                    added_translations += 1

            if added_hsk or added_entries or added_translations:
                db.commit()

            return {
                "hsk_words_added": added_hsk,
                "dictionary_entries_added": added_entries,
                "translations_added": added_translations,
            }
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def download_hsk_data(self, preload: bool = False) -> bool:
        """
        Keep the existing update endpoint alive by rebuilding static HSK data
        from the bundled dictionary instead of relying on removed download code.
        """
        self.bootstrap_static_data()
        return True

    def preload_hsk_words(self, hsk_words: dict[int, list[str]] | None = None):
        if hsk_words is None:
            hsk_words = get_hsk_words_by_level()
        db = self._get_db()
        try:
            existing = {
                word
                for (word,) in db.query(models.TranslationCache.word).all()
            }
            added = 0
            for words in hsk_words.values():
                for word in words:
                    meaning = VI.get(word)
                    if not meaning or word in existing:
                        continue
                    db.add(models.TranslationCache(word=word, vietnamese=meaning))
                    existing.add(word)
                    added += 1
            if added:
                db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def _get_db(self):
        return Session(engine)

    def _get_hsk_level(self, db: Session, word: str) -> int:
        res = db.query(models.HSKWord.level).filter_by(word=word).first()
        return res[0] if res else 0

    @staticmethod
    def _normalize_pinyin_query(q: str) -> str:
        tone_map = {
            "ā": ("a", "1"), "á": ("a", "2"), "ǎ": ("a", "3"), "à": ("a", "4"),
            "ē": ("e", "1"), "é": ("e", "2"), "ě": ("e", "3"), "è": ("e", "4"),
            "ī": ("i", "1"), "í": ("i", "2"), "ǐ": ("i", "3"), "ì": ("i", "4"),
            "ō": ("o", "1"), "ó": ("o", "2"), "ǒ": ("o", "3"), "ò": ("o", "4"),
            "ū": ("u", "1"), "ú": ("u", "2"), "ǔ": ("u", "3"), "ù": ("u", "4"),
            "ǖ": ("u:", "1"), "ǘ": ("u:", "2"), "ǚ": ("u:", "3"), "ǜ": ("u:", "4"),
            "ü": ("u:", ""), "Ü": ("u:", ""),
        }
        syllables = []
        for raw_syllable in re.split(r"\s+", q.strip()):
            chars = []
            tone = ""
            for ch in raw_syllable:
                mapped = tone_map.get(ch)
                if mapped:
                    chars.append(mapped[0])
                    tone = mapped[1] or tone
                else:
                    chars.append(ch.lower())
            syllables.append("".join(chars) + tone)
        return " ".join(s for s in syllables if s)

    def _row_to_dict(self, db: Session, row: models.DictionaryEntry) -> dict:
        hsk = self._get_hsk_level(db, row.simplified)
        return CedictEntry(
            row.traditional,
            row.simplified,
            row.pinyin,
            json.loads(row.english),
        ).to_dict(hsk)

    def search_translations(self, q: str, limit: int = 40, offset: int = 0) -> list[dict]:
        """Search Vietnamese cache and hydrate matching Chinese entries when possible."""
        q_lower = q.lower().strip()
        if not q_lower:
            return []

        db = self._get_db()
        try:
            rows = (
                db.query(models.TranslationCache)
                .filter(func.lower(models.TranslationCache.vietnamese).contains(q_lower))
                .offset(offset)
                .limit(limit)
                .all()
            )
            results = []
            for row in rows:
                entry_row = (
                    db.query(models.DictionaryEntry)
                    .filter(
                        or_(
                            models.DictionaryEntry.simplified == row.word,
                            models.DictionaryEntry.traditional == row.word,
                        )
                    )
                    .first()
                )
                if entry_row:
                    item = self._row_to_dict(db, entry_row)
                else:
                    item = {
                        "traditional": row.word,
                        "simplified": row.word,
                        "pinyin": "",
                        "english": [],
                        "vietnamese": row.vietnamese,
                        "hsk": self._get_hsk_level(db, row.word),
                    }
                item["vietnamese"] = row.vietnamese
                results.append(item)
            return results
        finally:
            db.close()

    def search(self, q: str, limit: int = 40, offset: int = 0) -> list[dict]:
        """Search by Chinese characters, pinyin or English via SQL."""
        q_lower = q.lower().strip()
        if not q_lower:
            return []
        pinyin_query = self._normalize_pinyin_query(q)

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
                    models.DictionaryEntry.pinyin.contains(pinyin_query),
                    models.DictionaryEntry.english.contains(q_lower)
                )
            )
            
            rows = query.offset(offset).limit(limit).all()
            
            results = []
            for row in rows:
                results.append(self._row_to_dict(db, row))
            
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
        word = word.strip()
        if not word:
            return None

        db = self._get_db()
        try:
            row = db.query(models.DictionaryEntry).filter(
                or_(models.DictionaryEntry.simplified == word, models.DictionaryEntry.traditional == word)
            ).first()
            
            if row:
                return self._row_to_dict(db, row)
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
