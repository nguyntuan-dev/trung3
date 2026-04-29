"""
Vietnamese translation module using Google Translate.
Caches results in SQLite database to avoid re-translating and eliminate large JSON files.
"""

import json
import os
import time
from pathlib import Path
from sqlalchemy.orm import Session
from sqlalchemy import or_

# Local imports
try:
    from database import engine
    import models
    from viet_dict import VI
except ImportError:
    from .database import engine
    from . import models
    from .viet_dict import VI

_translator = None

def _get_translator():
    """Lazy-init translator to avoid import cost if not needed."""
    global _translator
    if _translator is None:
        from deep_translator import GoogleTranslator
        _translator = GoogleTranslator(source='zh-CN', target='vi')
    return _translator

def get_translation(word: str) -> str:
    """Get Vietnamese translation for a word from database cache."""
    db = Session(engine)
    try:
        row = db.query(models.TranslationCache).filter_by(word=word).first()
        if row and row.vietnamese:
            return row.vietnamese
        return VI.get(word, "")
    finally:
        db.close()

def translate_word(word: str) -> str:
    """Translate a single Chinese word to Vietnamese, using database cache."""
    existing = get_translation(word)
    if existing:
        return existing

    if word in VI:
        db = Session(engine)
        try:
            db.add(models.TranslationCache(word=word, vietnamese=VI[word]))
            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()
        return VI[word]

    try:
        t = _get_translator()
        result = t.translate(word)
        if result:
            db = Session(engine)
            try:
                # Save to DB
                new_trans = models.TranslationCache(word=word, vietnamese=result)
                db.add(new_trans)
                db.commit()
            except Exception:
                db.rollback()
            finally:
                db.close()
            return result
    except Exception as e:
        print(f"[viet] Translate error for '{word}': {e}")
    return ""

def translate_batch(words: list[str]) -> dict[str, str]:
    """
    Translate a batch of Chinese words to Vietnamese.
    Uses database cache and updates it with new translations.
    """
    db = Session(engine)
    results = {}
    to_translate = []
    
    try:
        for w in words:
            if w in VI:
                results[w] = VI[w]
                continue

            row = db.query(models.TranslationCache).filter_by(word=w).first()
            if row:
                results[w] = row.vietnamese
            else:
                to_translate.append(w)
        
        if to_translate:
            print(f"[viet] Translating {len(to_translate)} new words via Google Translate...")
            t = _get_translator()
            
            batch_size = 50
            for i in range(0, len(to_translate), batch_size):
                batch = to_translate[i:i + batch_size]
                try:
                    combined = "\n".join(batch)
                    translated_str = t.translate(combined)
                    if translated_str:
                        translations = translated_str.split("\n")
                        for word, trans in zip(batch, translations):
                            trans = trans.strip()
                            results[word] = trans
                            # Save to DB
                            db.add(models.TranslationCache(word=word, vietnamese=trans))
                        db.commit()
                except Exception as e:
                    print(f"[viet] Batch translate error: {e}")
                    db.rollback()
                    # Fallback single
                    for word in batch:
                        try:
                            single = t.translate(word)
                            if single:
                                results[word] = single.strip()
                                db.add(models.TranslationCache(word=word, vietnamese=single.strip()))
                                db.commit()
                        except:
                            db.rollback()
                
                if i + batch_size < len(to_translate):
                    time.sleep(0.3)
                    
        return results
    finally:
        db.close()

def translate_to_chinese(text: str) -> str:
    """Translate Vietnamese/English text to Chinese for searching."""
    try:
        from deep_translator import GoogleTranslator
        return GoogleTranslator(source='auto', target='zh-CN').translate(text)
    except Exception as e:
        print(f"[viet] Search translate error: {e}")
        return ""

def preload_hsk_words(hsk_words: dict[int, list[str]]):
    """Pre-translate all HSK words at startup (if not already in DB)."""
    # This logic is now mostly handled by the initial migration
    # and on-demand translation in translate_batch.
    pass
