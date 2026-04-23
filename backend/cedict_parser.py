"""
CC-CEDICT Dictionary Parser
Downloads and parses the CC-CEDICT Chinese-English dictionary file.
License: CC BY-SA 3.0 – https://cc-cedict.org/wiki/
"""

import json
import gzip
import os
import re
import random
import urllib.request
from pathlib import Path

from vietnamese import get_translation, preload_hsk_words

CEDICT_URL = "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz"
HSK_DATA_URL = "https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/master/complete.json"
DATA_DIR = Path(__file__).parent.parent / "data"
CEDICT_GZ = DATA_DIR / "cedict.txt.gz"
CEDICT_TXT = DATA_DIR / "cedict.txt"
HSK_DATA_FILE = DATA_DIR / "hsk_data.json"

# HSK word lists (simplified Chinese) – curated subset
HSK_WORDS = {
    1: [
        "爱","八","爸爸","杯子","北京","本","不客气","不","菜","茶","吃","出租车",
        "打电话","大","的","点","电脑","电视","电影","东西","都","读","对不起","多",
        "多少","儿子","二","饭店","飞机","分钟","高兴","个","工作","狗","汉语",
        "好","喝","和","很","后面","回","会","火车站","几","家","叫","今天",
        "九","开","看","看见","块","来","老师","了","冷","里","零","六","妈妈",
        "吗","买","猫","没关系","没有","米饭","名字","明天","哪","那","呢","能",
        "你","年","女儿","朋友","漂亮","苹果","七","前面","钱","请","去","热",
        "人","认识","三","商店","上","上午","少","谁","什么","十","时候","是",
        "书","水","水果","睡觉","说","四","岁","他","她","太","天气","听","同学",
        "喂","我","我们","五","喜欢","下","下午","下雨","先生","现在","想","小",
        "小姐","些","写","谢谢","星期","学生","学习","学校","一","衣服","医生",
        "医院","椅子","有","月","再见","在","怎么","怎么样","这","中国","中午",
        "住","桌子","字","昨天","坐","做",
    ],
    2: [
        "吧","白","百","帮助","报纸","比","别","宾馆","长","唱歌","出","穿","船",
        "次","从","错","打篮球","大家","到","得","等","弟弟","第一","懂","对",
        "房间","非常","服务员","高","告诉","哥哥","给","公共汽车","公司","贵",
        "过","还","孩子","好吃","黑","红","欢迎","回答","机场","鸡蛋","件","教室",
        "姐姐","介绍","进","近","就","觉得","咖啡","开始","考试","可能","可以",
        "课","快","快乐","累","离","两","路","旅游","卖","慢","忙","每","妹妹",
        "门","面条","男","您","牛奶","女","旁边","跑步","便宜","票","妻子","起床",
        "千","铅笔","晴","去年","让","日","上班","身体","生病","生日","时间",
        "事情","手表","手机","说话","送","虽然","但是","它","题","踢足球",
        "跳舞","外","完","玩","晚上","往","为什么","问","问题","西瓜","希望",
        "洗","小时","笑","新","姓","休息","雪","颜色","眼睛","羊肉","药","要",
        "也","已经","一起","一下","因为","所以","阴","游泳","右边","鱼","远",
        "运动","再","早上","丈夫","找","着","真","正在","知道","准备","走","最",
        "左边",
    ],
    3: [
        "啊","矮","爱好","安静","把","班","搬","办法","办公室","半","帮忙","包",
        "饱","北方","被","鼻子","比较","比赛","笔记本","必须","变化","别人",
        "冰箱","不但","而且","不过","才","菜单","参加","草","层","差","超市",
        "衬衫","成绩","城市","迟到","除了","厨房","春","词语","聪明","打扫",
        "打算","带","担心","蛋糕","当然","地","地方","地铁","地图","電梯",
        "电子邮件","东","冬","动物","短","段","锻炼","多么","饿","耳朵","发",
        "发烧","发现","方便","放","放心","分","附近","复习","干净","敢","感冒",
        "感兴趣","刚才","根据","跟","更","公园","故事","刮风","关","关心",
        "关于","国家","果汁","过","过去","还是","害怕","黄河","护照","花",
        "花园","画","坏","换","环境","黄","回忆","会议","或者","几乎",
        "机会","极","记得","季节","检查","简单","健康","讲","教","角","脚",
        "接","街道","节目","节日","结婚","结束","解决","借","经常","经过",
        "经理","久","旧","句子","决定","渴",
    ],
    4: [
        "爱情","安排","安全","按时","按照","抱歉","保护","保证","报名","倍",
        "本来","笨","比如","毕业","遍","标准","表格","表示","表演","表扬",
        "饼干","并且","博士","不仅","不管","部分","擦","猜","材料","参观",
        "餐厅","厕所","差不多","尝","场","长城","长江","超过","吵","衬衫",
        "成功","成为","诚实","乘坐","程度","吃惊","重新","抽烟","出差","出发",
        "出生","出现","厨房","传真","窗户","词典","从来","粗心","存","错误",
        "答案","打扮","打扰","打印","打折","大概","大使馆","大约","代替","戴",
        "当","当时","导游","倒","到处","到底","道歉","得意","得","灯",
        "登机牌","底","地址","地球","调查","掉","丢","动作","堵车","肚子",
        "短信","对话","对面","对于","顿","多余","多云","而","儿童","发生",
        "发展","法律","翻译","烦恼","反对","反映","方法","方面","方向",
        "房东","放弃","放暑假","份","丰富","否则","符合","付款","复印",
        "复杂","负责","改变","干","感动","感觉","感情","感谢","赶","敢",
        "刚","钢琴","高速公路","各","工资","公里","功夫","共同",
        "够","购物","估计","鼓励","故意","顾客","挂","关键","观众",
        "管理","光","广播","广告","逛","规定","国际","国籍","果然",
    ],
    5: [
        "唉","爱护","爱惜","爱心","安慰","暗","熬夜","把握","摆","办理",
        "傍晚","包裹","包含","包括","保持","保存","保留","保险","报到","报道",
        "报告","报社","抱","抱怨","悲观","背","背景","被子","本科","本领",
        "本质","比例","彼此","必然","必要","避免","编辑","鞭炮","辩论","标点",
        "标志","表达","表面","表明","表情","表现","别扭","冰激凌","病毒","玻璃",
        "播放","脖子","博物馆","不安","不必","不断","不好意思","不见得",
        "不耐烦","不然","不如","不足","布","步骤","部门","财产","采访",
        "采取","彩虹","参考","参与","惭愧","操场","操心","册","测验","曾经",
        "插","差别","差距","拆","产品","产生","长途","常识","抄","超级",
        "朝","朝代","潮湿","吵架","炒","车库","车厢","彻底","沉默","趁",
        "称","称赞","成分","成果","成就","成立","成语","成长","承担",
        "承认","承受","程序","吃亏","冲","充电器","充分","充满","重复",
        "宠物","抽屉","抽象","丑","臭","出版","出口","出色","出席",
        "初级","除夕","处理","传播","传染","传说","传统","窗帘","闯",
        "创造","吹","词汇","辞职","此外","刺激","匆忙","从此","从而",
        "从前","从事","粗糙","促进","促使","醋","催","存在","措施",
    ],
    6: [
        "哀悼","爱不释手","碍","安居乐业","安宁","安详","暗示","案件","案例",
        "奥秘","巴不得","白搭","拜访","拜年","败坏","颁布","颁发","班主任",
        "搬迁","板","版本","办事处","半途 mà còn","扮演","帮忙","包庇","包袱",
        "包围","包装","宝贝","宝贵","保密","保姆","保守","保卫","保障",
        "报仇","报酬","报答","报复","报警","报销","抱负","暴力","暴露",
        "曝光","爆炸","悲哀","卑鄙","北极","备份","备忘录","背叛","背诵",
        "奔波","奔驰","本能","本人","本身","本事","笨拙","逼迫","鼻涕",
        "比方","比喻","比重","彼岸","必定","必经之路","闭塞","弊端",
        "边疆","边缘","编织","鞭策","贬低","贬义","便利","辨别","辨认",
        "辩护","辩解","辩证","标本","标记","标题","表决","表态","憋",
        "别墅","濒临","冰雹","并非","并列","波浪","波涛","驳斥","博大精深",
        "博览会","薄弱","补偿","补充","补救","补贴","不惜","不相上下",
        "不言 mà còn","不由得","不择手段","布局","布置","步伐","部署",
        "部位","裁缝","裁判","裁员","财富","采购","采集","采纳","彩票",
        "参照","惨","灿烂","仓促","仓库","舱","操劳","操练","操纵",
        "草案","草率","侧面","策划","策略","测量","层出不穷","层次",
        "差异","拆除","拆迁","搀","产业","颤抖","猖狂","尝试","常务",
    ],
}


class CedictEntry:
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


_LINE_RE = re.compile(
    r"^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+/(.+)/$"
)


class CedictDict:
    """In-memory CC-CEDICT dictionary with search capabilities."""

    def __init__(self):
        self.entries: list[CedictEntry] = []
        self._by_simplified: dict[str, CedictEntry] = {}
        self._by_traditional: dict[str, CedictEntry] = {}
        self._hsk_lookup: dict[str, int] = {}  # simplified -> hsk level
        self._loaded = False

    # ──── bootstrap ────
    def load(self):
        """Download (if needed) and parse the dictionary."""
        self._load_hsk_data()
        self._build_hsk_lookup()
        self._ensure_downloaded()
        self._parse()
        self._loaded = True
        # Pre-translate all HSK words
        preload_hsk_words(self.hsk_words)

    def _load_hsk_data(self):
        """Try to load HSK data from local JSON, fallback to hardcoded."""
        abs_hsk_path = os.path.abspath(HSK_DATA_FILE)
        if os.path.exists(abs_hsk_path):
            try:
                with open(abs_hsk_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.hsk_words = {int(k): v for k, v in data.items()}
                    lvl_counts = {k: len(v) for k, v in self.hsk_words.items()}
                    print(f"[hsk] Loaded data from {abs_hsk_path}. Levels: {lvl_counts}")
                    return
            except Exception as e:
                print(f"[hsk] Error loading JSON from {abs_hsk_path}: {e}")
        
        self.hsk_words = HSK_WORDS
        print(f"[hsk] Fallback: Using hardcoded subset. (File not found at {abs_hsk_path})")

    def download_hsk_data(self, preload: bool = True):
        """Download full HSK vocabulary from GitHub and update local JSON."""
        print("[hsk] Downloading full HSK vocabulary ...")
        try:
            response = urllib.request.urlopen(HSK_DATA_URL)
            data = json.loads(response.read().decode("utf-8"))
            
            new_hsk = {i: [] for i in range(1, 10)} # Support up to HSK 9
            for item in data:
                word = item.get("simplified")
                levels = item.get("level", [])
                for lvl_str in levels:
                    # Support multiple formats: "newest-1", "new-4", "old-3"
                    try:
                        # Extract the number from strings like "newest-1" or "old-6"
                        match = re.search(r'-(\d+)', lvl_str)
                        if match:
                            l = int(match.group(1))
                            if 1 <= l <= 9:
                                if word not in new_hsk[l]:
                                    new_hsk[l].append(word)
                    except:
                        pass
            
            # Remove empty levels
            new_hsk = {k: v for k, v in new_hsk.items() if v}
            
            # Use absolute path for writing to be safe
            abs_hsk_path = os.path.abspath(HSK_DATA_FILE)
            # Ensure directory exists
            os.makedirs(os.path.dirname(abs_hsk_path), exist_ok=True)
            
            with open(abs_hsk_path, "w", encoding="utf-8") as f:
                json.dump(new_hsk, f, ensure_ascii=False, indent=2)
            
            self.hsk_words = new_hsk
            self._build_hsk_lookup()
            lvl_counts = {k: len(v) for k, v in self.hsk_words.items()}
            print(f"[hsk] Successfully updated HSK data. Level counts: {lvl_counts}")
            
            # Optional: preload translations for new words
            if preload:
                preload_hsk_words(self.hsk_words)
            return True
        except Exception as e:
            print(f"[hsk] Update failed: {e}")
            return False

    def _build_hsk_lookup(self):
        self._hsk_lookup = {}
        for level, words in self.hsk_words.items():
            for w in words:
                if w not in self._hsk_lookup:
                    self._hsk_lookup[w] = level

    def _ensure_downloaded(self):
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        if CEDICT_TXT.exists():
            return
        print("[cedict] Downloading CC-CEDICT ...")
        urllib.request.urlretrieve(CEDICT_URL, str(CEDICT_GZ))
        with gzip.open(CEDICT_GZ, "rb") as f_in:
            CEDICT_TXT.write_bytes(f_in.read())
        print(f"[cedict] Saved to {CEDICT_TXT}")

    def _parse(self):
        print("[cedict] Parsing ...")
        count = 0
        with open(CEDICT_TXT, encoding="utf-8") as f:
            for line in f:
                if line.startswith("#"):
                    continue
                m = _LINE_RE.match(line.strip())
                if not m:
                    continue
                trad, simp, pinyin, defs = m.group(1), m.group(2), m.group(3), m.group(4)
                english = [d.strip() for d in defs.split("/") if d.strip()]
                entry = CedictEntry(trad, simp, pinyin, english)
                self.entries.append(entry)
                self._by_simplified[simp] = entry
                self._by_traditional[trad] = entry
                count += 1
        print(f"[cedict] Loaded {count} entries.")

    # ──── public API ────
    def search(self, q: str, limit: int = 40, offset: int = 0) -> list[dict]:
        """Search by Chinese characters, pinyin or English."""
        q_lower = q.lower().strip()
        if not q_lower:
            return []

        results = []
        for entry in self.entries:
            vi = get_translation(entry.simplified)
            if (q_lower in entry.simplified
                    or q_lower in entry.traditional
                    or q_lower in entry.pinyin.lower()
                    or any(q_lower in e.lower() for e in entry.english)
                    or (vi and q_lower in vi.lower())):
                hsk = self._hsk_lookup.get(entry.simplified, 0)
                results.append(entry.to_dict(hsk))
                if len(results) >= offset + limit:
                    break

        return results[offset:offset + limit]

    def get_hsk(self, level: int, limit: int = 50, offset: int = 0) -> dict:
        """Get words for a specific HSK level."""
        words_list = self.hsk_words.get(level, [])
        total = len(words_list)
        page_words = words_list[offset:offset + limit]
        results = []
        for w in page_words:
            entry = self._by_simplified.get(w)
            if entry:
                results.append(entry.to_dict(level))
            else:
                # Fallback if not in dict
                results.append({
                    "traditional": w, "simplified": w,
                    "pinyin": "", "english": [], "vietnamese": get_translation(w), "hsk": level,
                })
        return {"total": total, "words": results, "level": level}

    def random_words(self, level: int = 0, count: int = 20) -> list[dict]:
        """Get random words, optionally filtered by HSK level."""
        if level and level in self.hsk_words:
            pool = self.hsk_words[level]
            sample = random.sample(pool, min(count, len(pool)))
            results = []
            for w in sample:
                entry = self._by_simplified.get(w)
                if entry:
                    results.append(entry.to_dict(level))
            return results
        else:
            sample = random.sample(self.entries, min(count, len(self.entries)))
            return [e.to_dict(self._hsk_lookup.get(e.simplified, 0)) for e in sample]

    def lookup(self, word: str) -> dict | None:
        """Exact lookup by simplified or traditional."""
        entry = self._by_simplified.get(word) or self._by_traditional.get(word)
        if entry:
            return entry.to_dict(self._hsk_lookup.get(entry.simplified, 0))
        return None

    def convert_pinyin_to_chinese(self, pinyin_str: str) -> dict:
        """Convert pinyin string to Chinese characters.
        Input: 'wo3 hen3 gao1 xing4' -> 'wo3 hen3' + 'gao1 xing4'
        Returns: {'input': input_str, 'output': '我很高兴', 'items': [...]}
        """
        # Normalize pinyin: remove extra spaces, convert to lowercase
        pinyin_str = pinyin_str.strip().lower()
        if not pinyin_str:
            return {'input': '', 'output': '', 'items': []}
        
        # Split by spaces to get individual syllables
        syllables = [s.strip() for s in pinyin_str.split()]
        
        result_chars = []
        result_items = []
        
        i = 0
        while i < len(syllables):
            syl = syllables[i]
            if not syl:
                i += 1
                continue
            
            # Try to match multi-character words first (2-3 characters)
            matched = False
            for word_len in [3, 2]:  # Try 3-char, then 2-char words
                if i + word_len <= len(syllables):
                    pinyin_seq = ' '.join(syllables[i:i + word_len])
                    
                    # Find multi-char entry with matching pinyin
                    for entry in self.entries:
                        if (len(entry.simplified) == word_len and 
                            entry.pinyin.lower() == pinyin_seq):
                            # Found multi-char word, add each character
                            for j, char in enumerate(entry.simplified):
                                result_chars.append(char)
                                result_items.append({
                                    'pinyin': syllables[i + j],
                                    'character': char,
                                    'options': [char],
                                })
                            i += word_len
                            matched = True
                            break
                    
                    if matched:
                        break
            
            if matched:
                continue
            
            # No multi-char word found, match single character
            matches = []
            for entry in self.entries:
                # Match single-character entries only
                if len(entry.simplified) == 1 and entry.pinyin.lower() == syl:
                    matches.append(entry)
            
            # Sort matches: prioritize by HSK level (lower = more common)
            def priority_score(entry):
                hsk_level = self._hsk_lookup.get(entry.simplified, 999)
                return hsk_level
            
            matches.sort(key=priority_score)
            
            # Get unique simplified characters in priority order
            unique_chars = []
            seen = set()
            for entry in matches:
                if entry.simplified not in seen:
                    unique_chars.append(entry.simplified)
                    seen.add(entry.simplified)
                    if len(unique_chars) >= 5:
                        break
            
            # Add character
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

    def hsk_summary(self) -> list[dict]:
        """Return summary of all HSK levels."""
        summaries = []
        for level in sorted(self.hsk_words.keys()):
            words = self.hsk_words.get(level, [])
            summaries.append({
                "level": level,
                "total": len(words),
            })
        return summaries


# Singleton
cedict = CedictDict()
