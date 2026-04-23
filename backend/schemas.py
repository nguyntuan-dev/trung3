from pydantic import BaseModel


class Lesson(BaseModel):
    id: int
    title: str
    level: str
    focus: str


class VocabularyItem(BaseModel):
    hanzi: str
    pinyin: str
    meaning: str
    hsk_level: int


class BattlePrompt(BaseModel):
    sentence_vi: str
    correct_answer: str
    options: list[str]
