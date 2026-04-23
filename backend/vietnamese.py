"""
Vietnamese translation module using Google Translate.
Translates Chinese → Vietnamese and caches results in a local JSON file.
"""

import json
import os
import time
from pathlib import Path

CACHE_FILE = Path(__file__).parent.parent / "data" / "viet_cache.json"

from viet_dict import VI

# In-memory cache
_cache: dict[str, str] = {}
_translator = None


def _get_translator():
    """Lazy-init translator to avoid import cost if not needed."""
    global _translator
    if _translator is None:
        from deep_translator import GoogleTranslator
        _translator = GoogleTranslator(source='zh-CN', target='vi')
    return _translator


def _load_cache():
    """Load cached translations from disk."""
    global _cache
    if CACHE_FILE.exists():
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                _cache = json.load(f)
            print(f"[viet] Loaded {len(_cache)} cached translations.")
        except Exception as e:
            print(f"[viet] Warning: Could not load cache: {e}")
            _cache = {}
    else:
        _cache = {}


def _save_cache():
    """Save cache to disk."""
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(_cache, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[viet] Warning: Could not save cache: {e}")


def translate_word(word: str) -> str:
    """Translate a single Chinese word to Vietnamese, using cache."""
    if word in _cache:
        return _cache[word]

    try:
        t = _get_translator()
        result = t.translate(word)
        if result:
            _cache[word] = result
            return result
    except Exception as e:
        print(f"[viet] Translate error for '{word}': {e}")
    return ""


def translate_batch(words: list[str]) -> dict[str, str]:
    """
    Translate a batch of Chinese words to Vietnamese.
    Only translates words not already in cache.
    Returns dict mapping word -> translation.
    """
    # Find words that need translating
    to_translate = [w for w in words if w not in _cache]

    if to_translate:
        print(f"[viet] Translating {len(to_translate)} new words via Google Translate...")
        t = _get_translator()

        # Translate in small batches to avoid rate limits
        batch_size = 50
        for i in range(0, len(to_translate), batch_size):
            batch = to_translate[i:i + batch_size]
            try:
                # Use newline-separated text for batch translation
                combined = "\n".join(batch)
                result = t.translate(combined)
                if result:
                    translations = result.split("\n")
                    for word, trans in zip(batch, translations):
                        _cache[word] = trans.strip()
            except Exception as e:
                print(f"[viet] Batch translate error: {e}")
                # Fallback: translate one by one
                for word in batch:
                    try:
                        single = t.translate(word)
                        if single:
                            _cache[word] = single.strip()
                    except Exception:
                        pass
            # Small delay to avoid rate limiting
            if i + batch_size < len(to_translate):
                time.sleep(0.3)

        _save_cache()
        print(f"[viet] Done. Total cached: {len(_cache)}")

    return {w: _cache.get(w, "") for w in words}


def get_translation(word: str) -> str:
    """Get Vietnamese translation for a word (checks cache and static VI dict)."""
    return VI.get(word) or _cache.get(word, "")


def preload_hsk_words(hsk_words: dict[int, list[str]]):
    """Pre-translate all HSK words at startup."""
    all_words = []
    for level, words in hsk_words.items():
        all_words.extend(words)

    # Deduplicate
    all_words = list(dict.fromkeys(all_words))

    uncached = [w for w in all_words if w not in _cache and w not in VI]
    if uncached:
        print(f"[viet] Pre-translating {len(uncached)} HSK words...")
        translate_batch(uncached)
    else:
        print(f"[viet] All {len(all_words)} HSK words already cached.")


# Load cache on import
_load_cache()
