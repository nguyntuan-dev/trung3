from .schemas import BattlePrompt, Lesson, VocabularyItem


LESSONS = [
    Lesson(id=1, title="Chào hỏi cơ bản", level="HSK 1", focus="Pinyin và giao tiếp mở đầu"),
    Lesson(id=2, title="Mô tả con người", level="HSK 2", focus="Tính từ và cấu trúc 很"),
    Lesson(id=3, title="Hội thoại thực chiến", level="HSK 3", focus="Phản xạ nghe và trả lời"),
]


VOCABULARY = [
    VocabularyItem(hanzi="聪明", pinyin="cong ming", meaning="thông minh", hsk_level=2),
    VocabularyItem(hanzi="老师", pinyin="lao shi", meaning="giáo viên", hsk_level=1),
    VocabularyItem(hanzi="学习", pinyin="xue xi", meaning="học tập", hsk_level=1),
]


BATTLE_SAMPLE = BattlePrompt(
    sentence_vi="Anh ấy rất thông minh",
    correct_answer="聪明",
    options=["漂亮", "聪明", "懒惰", "安静"],
)
