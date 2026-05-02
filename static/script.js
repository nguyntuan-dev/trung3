/* ===================== */
/*  汉语Go – script.js   */
/* ===================== */
'use strict';

const API = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:8000'
  : ''; // Relative path when hosted together, or replace with your actual production API URL

// ── State ──
const S = {
  view: 'home',
  level: 1,
  learnPage: 0,
  learnPerPage: 50,
  learnData: null,
  fcDeck: [],
  fcIdx: 0,
  quiz: { qs: [], cur: 0, right: 0, wrong: 0, total: 10, allWords: [] },
  type: { qs: [], cur: 0, right: 0, total: 10 },
  typeMode: 'word', // 'word' or 'sentence'
  sentence: { qs: [], cur: 0, right: 0, total: 10 },
  pronounce: { level: 1, qs: [], cur: 0, total: 0 },
  match: { level: 1, mode: 'meaning', pairs: [], score: 0, combo: 0, timeLeft: 60, timer: null },
  listen: { level: 1, qs: [], cur: 0, right: 0, wrong: 0, total: 10, timer: null, timeLeft: 10 },
  learned: JSON.parse(localStorage.getItem('hg_learned') || '{}'),
};
let quizTimerInt = null;
let pronounceRecognizer = null;
let pronounceCurrentSentence = null;

// ── Fix 2: Helper Debounce (Trì hoãn thực thi) ──
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// ── API Cache: Tránh gọi API trùng lặp ──
const _apiCache = new Map();
async function apiCached(path, ttlMs = 60000) {
  const cached = _apiCache.get(path);
  if (cached && Date.now() - cached.ts < ttlMs) return cached.data;
  const data = await api(path);
  _apiCache.set(path, { data, ts: Date.now() });
  return data;
}

// Hàm xử lý tra cứu thông minh và tự động điền form
async function handleSmartLookup(inputEl) {
  const val = inputEl.value.trim();
  if (val.length < 1) return;

  // Hiệu ứng chờ tải
  inputEl.style.opacity = '0.6';
  const originalPlaceholder = inputEl.placeholder;
  inputEl.placeholder = 'Đang dịch...';

  try {
    // Dùng cache 5 phút để tránh gọi API trùng lặp cho cùng 1 từ
    const data = await apiCached(`/api/lookup/${encodeURIComponent(val)}`, 300000);
    if (data.simplified) {
      const zhInp = document.getElementById('add-speech-zh');
      const pyInp = document.getElementById('add-speech-py');
      const viInp = document.getElementById('add-speech-vi');
      
      // Chỉ cập nhật nếu ô đó đang trống hoặc không phải ô đang nhập để tránh ghi đè người dùng
      if (zhInp && (zhInp !== inputEl)) zhInp.value = data.simplified;
      if (pyInp && (pyInp !== inputEl)) pyInp.value = data.pinyin || '';
      if (viInp && (viInp !== inputEl)) viInp.value = data.vietnamese || '';
    }
  } catch (e) {
    console.error("Smart lookup error:", e);
  } finally {
    inputEl.style.opacity = '1';
    inputEl.placeholder = originalPlaceholder;
  }
}

// Hàm gọi API dịch từ backend
async function translateText(text, fromLang, toLang) {
  try {
    const response = await api(`/api/translate?text=${encodeURIComponent(text)}&from_lang=${fromLang}&to_lang=${toLang}`);
    return response.translated_text;
  } catch (error) {
    console.error('Translation error:', error);
    return null;
  }
}

// Hàm tự động dịch câu dựa trên ngôn ngữ đầu vào
async function autoTranslateSentence(inputEl) {
  const val = inputEl.value.trim();
  if (val.length < 2) return; // Chỉ dịch khi có ít nhất 2 ký tự

  console.log('autoTranslateSentence called for input:', inputEl.id, 'value:', val);
  
  // Hiệu ứng chờ tải
  inputEl.style.opacity = '0.6';
  const originalPlaceholder = inputEl.placeholder;
  inputEl.placeholder = 'Đang dịch...';

  try {
    const zhInp = document.getElementById('add-speech-zh');
    const pyInp = document.getElementById('add-speech-py');
    const viInp = document.getElementById('add-speech-vi');

    let zh = zhInp?.value.trim() || '';
    let py = pyInp?.value.trim() || '';
    let vi = viInp?.value.trim() || '';

    // Xác định ngôn ngữ đầu vào và dịch sang 2 ngôn ngữ còn lại
    if (inputEl === zhInp && zh && !py && !vi) {
      // Đầu vào là tiếng Trung, dịch sang tiếng Việt và Pinyin
      const viTranslation = await translateText(zh, 'zh-CN', 'vi');
      if (viTranslation) viInp.value = viTranslation;
      
      // Tạo Pinyin từ tiếng Trung (có thể cần API riêng hoặc logic xử lý)
      // Hiện tại để trống, có thể thêm logic sau
      
    } else if (inputEl === viInp && vi && !zh && !py) {
      // Đầu vào là tiếng Việt, dịch sang tiếng Trung và Pinyin
      const zhTranslation = await translateText(vi, 'vi', 'zh-CN');
      if (zhTranslation) zhInp.value = zhTranslation;
      
      // Tạo Pinyin từ tiếng Trung dịch được
      if (zhTranslation) {
        // Có thể thêm logic tạo Pinyin từ tiếng Trung
      }
      
    } else if (inputEl === pyInp && py && !zh && !vi) {
      // Đầu vào là Pinyin, dịch sang tiếng Trung và tiếng Việt
      // Pinyin sang tiếng Trung có thể phức tạp, có thể bỏ qua hoặc dùng API khác
      // Hiện tại để trống
    }

  } catch (e) {
    console.error("Auto translation error:", e);
  } finally {
    inputEl.style.opacity = '1';
    inputEl.placeholder = originalPlaceholder;
  }
}

function loadPronounceLevel(level = 1) {
  S.pronounce.level = level;
  const list = document.getElementById('pronounce-list');
  if (!list) return;
  
  // Thêm giao diện nhập câu nếu chọn level 0 (Câu của tôi)
  let addHtml = '';
  if (level === 0) {
    addHtml = `
      <div id="add-speech-form" style="grid-column: 1 / -1; background: #fff; padding: 30px; border-radius: 20px; margin-bottom: 25px; border: 1px solid var(--border); box-shadow: 0 10px 25px rgba(0,0,0,0.05); width: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 15px; text-align: left;">
        <h3 style="margin-bottom:20px; font-size:1.5rem; color:var(--accent); text-align:center;">➕ Thêm câu luyện nói cá nhân</h3>
        
        <div style="width: 100%;">
          <div style="font-size: 0.9rem; color: var(--muted); margin-bottom: 6px; font-weight: 600;">📝 Nhập câu chữ Hán:</div>
          <input type="text" id="add-speech-zh" placeholder="Ví dụ: 我想学汉语..." class="auth-input" style="font-size:1.6rem; padding:15px; color:var(--zh-color); font-weight:bold; width: 100%; display: block;">
        </div>

        <div id="add-speech-conversion" style="padding: 15px; background: var(--accent-light); border-radius: 12px; display: none; border-left: 5px solid var(--accent); box-shadow: inset 0 2px 4px rgba(0,0,0,0.02); margin-top: -5px;">
          <div style="font-size: 0.9rem; color: var(--muted); margin-bottom: 10px;">✨ Gợi ý chữ Hán (từ Pinyin):</div>
          <div id="add-speech-conversion-result" style="font-size: 2.2rem; color: var(--zh-color); font-weight: bold; cursor: pointer;"></div>
          <div style="font-size: 0.85rem; color: #94a3b8; margin-top: 5px;">(Bấm vào kết quả trên để áp dụng vào ô nhập)</div>
        </div>

        <div style="display:flex; gap:15px; flex-wrap: wrap; width: 100%;">
          <div style="flex:1; min-width: 250px;">
            <div style="font-size: 0.85rem; color: var(--muted); margin-bottom: 6px; font-weight: 600;">📝 Pinyin:</div>
            <input type="text" id="add-speech-py" placeholder="wo3 xiang3 xue2..." class="auth-input" style="font-size:1.1rem; padding:12px; width: 100%; display: block;">
          </div>
          <div style="flex:1; min-width: 250px;">
            <div style="font-size: 0.85rem; color: var(--muted); margin-bottom: 6px; font-weight: 600;">📖 Nghĩa tiếng Việt:</div>
            <input type="text" id="add-speech-vi" placeholder="Ví dụ: Tôi muốn học..." class="auth-input" style="font-size:1.1rem; padding:12px; width: 100%; display: block;">
          </div>
        </div>
        <button id="btn-add-speech" class="btn-main" style="width:100%; font-size:1.2rem; padding:18px; margin-top: 10px; display: flex;">💾 Lưu câu này vào danh sách</button>
      </div>
    `;
  }

  list.innerHTML = addHtml + '<p class="muted">Đang tải câu luyện nói...</p>';
  
  const path = level === 0 ? '/api/pronounce/user-sentences' : `/api/pronounce/sentences?level=${level}&count=12`;

  api(path)
    .then(res => {
      S.pronounce.qs = res.sentences || [];
      S.pronounce.total = S.pronounce.qs.length;
      S.pronounce.cur = 0;
      if (!S.pronounce.qs.length && level !== 0) {
        list.innerHTML = addHtml + '<p class="muted">Chưa có câu luyện nói cho level này.</p>';
        return;
      }
      const itemsHtml = S.pronounce.qs.map((s, i) => `
        <button class="pronounce-item" data-idx="${i}" style="width:100%; text-align:left; padding:16px; border:1px solid #e5e7eb; border-radius:16px; background:#fff; margin-bottom:12px; cursor:pointer; box-shadow:0 8px 20px rgba(15,23,42,.04);">
          <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
            <div style="flex:1; min-width:0;">
              <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:6px;">
                <div style="font-size:1.05rem; font-weight:800; color:var(--zh-color);">${s.zh}</div>
                <span class="pill">${s.level === 0 ? '⭐ Cá nhân' : 'HSK ' + s.level}</span>
              </div>
              <div class="muted" style="margin-top:4px; line-height:1.5;">${s.pinyin}</div>
              <div style="margin-top:8px; color:#334155; line-height:1.6;">${s.vi}</div>
            </div>
            <div style="font-size:1.2rem; color:#64748b;">▶</div>
          </div>
        </button>
      `).join('');
      list.innerHTML = addHtml + (itemsHtml || '<p class="muted center">Danh sách trống. Hãy thêm câu đầu tiên của bạn!</p>');
      
      // Gán sự kiện sau khi đã render HTML vào list
      if (level === 0) {
        document.getElementById('btn-add-speech')?.addEventListener('click', submitUserSentence);
        
        const zhInput = document.getElementById('add-speech-zh');
        const convDisplay = document.getElementById('add-speech-conversion');
        const convResult = document.getElementById('add-speech-conversion-result');

        // ✔️ Fix 2: Debounce Pinyin conversion (300ms)
        const debouncedPinyinConv = debounce(async (val) => {
            if (!val) {
              convDisplay.style.display = 'none';
              return;
            }
            // Nếu người dùng đang nhập pinyin (không có chữ Hán)
            if (!/[\u3400-\u9FBF]/.test(val)) {
               try {
                  const data = await api(`/api/pinyin-to-chinese?pinyin=${encodeURIComponent(val)}`);
                  if (data.output && data.output !== val) {
                     convDisplay.style.display = 'block';
                     convResult.textContent = data.output;
                  } else {
                     convDisplay.style.display = 'none';
                  }
               } catch(e) {}
            } else {
               convDisplay.style.display = 'none';
            }
        }, 300);

        zhInput?.addEventListener('input', (e) => debouncedPinyinConv(e.target.value.trim()));

        convResult?.addEventListener('click', () => {
          zhInput.value = convResult.textContent;
          convDisplay.style.display = 'none';
          // Kích hoạt blur để tự động điền Pinyin và Nghĩa
          handleSmartLookup(zhInput);
        });

        // Gắn sự kiện blur cho cả 3 ô để tự động đồng bộ hóa
        const pyInput = document.getElementById('add-speech-py');
        const viInput = document.getElementById('add-speech-vi');

        // ✔️ Fix 2: Debounce Auto Translation (500ms)
        const debouncedAutoTranslate = debounce((el) => autoTranslateSentence(el), 500);

        [zhInput, pyInput, viInput].forEach(inp => {
          // Chỉ gọi lookup khi blur (rời ô), không gọi mỗi keystroke
          inp?.addEventListener('blur', (e) => handleSmartLookup(e.target));
          // Bỏ autoTranslate khi input để tiết kiệm API; chỉ dịch khi blur
          inp?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitUserSentence(); } });
        });
      }

      list.querySelectorAll('.pronounce-item').forEach(btn => {
        btn.addEventListener('click', () => startSentenceAssessment(S.pronounce.qs[+btn.dataset.idx]));
      });
      if (!pronounceCurrentSentence) pronounceCurrentSentence = S.pronounce.qs[0] || null;
    })
    .catch(e => {
      list.innerHTML = addHtml + `<p class="muted">Lỗi tải câu: ${e.message}</p>`;
      if (level === 0) document.getElementById('btn-add-speech')?.addEventListener('click', submitUserSentence);
    });
}

async function submitUserSentence() {
  let zh = document.getElementById('add-speech-zh').value.trim();
  let py = document.getElementById('add-speech-py').value.trim();
  let vi = document.getElementById('add-speech-vi').value.trim();
  
  // Nếu chỉ có 1 ngôn ngữ, tự động dịch sang 2 ngôn ngữ còn lại
  if (zh && !py && !vi) {
    // Có tiếng Trung, dịch sang tiếng Việt
    const viTranslation = await translateText(zh, 'zh-CN', 'vi');
    if (viTranslation) vi = viTranslation;
  } else if (vi && !zh && !py) {
    // Có tiếng Việt, dịch sang tiếng Trung
    const zhTranslation = await translateText(vi, 'vi', 'zh-CN');
    if (zhTranslation) zh = zhTranslation;
  } else if (py && !zh && !vi) {
    // Có Pinyin, có thể dịch sang tiếng Trung và tiếng Việt
    // Hiện tại để trống, có thể thêm logic sau
  }

  if (!zh) return alert('Vui lòng nhập câu (có thể bằng tiếng Trung, tiếng Việt, hoặc Pinyin)');
  
  try {
    await api('/api/pronounce/user-sentences', {
      method: 'POST',
      body: JSON.stringify({ word: zh, pinyin: py, meaning: vi, hsk_level: 0 })
    });
    document.getElementById('add-speech-zh').value = '';
    document.getElementById('add-speech-py').value = '';
    document.getElementById('add-speech-vi').value = '';
    loadPronounceLevel(0); // Tải lại danh sách
  } catch (e) {
    alert('Lỗi: ' + e.message);
  }
}

function playPronounceSample() {
  const sentence = pronounceCurrentSentence || (S.pronounce.qs && S.pronounce.qs[0]);
  if (!sentence) return;
  playAudio(sentence.zh);
}

function startPronounceRecording() {
  const sentence = pronounceCurrentSentence || (S.pronounce.qs && S.pronounce.qs[0]);
  if (sentence) startPronunciationAssessment(sentence);
}

function retryPronounceRecording() {
  stopPronunciationSession('Sẵn sàng ghi âm lại.');
  const sentence = pronounceCurrentSentence || (S.pronounce.qs && S.pronounce.qs[0]);
  if (sentence) startSentenceAssessment(sentence);
}

function startSentenceAssessment(s) {
  pronounceCurrentSentence = s;
  const panel = document.getElementById('pronounce-panel');
  if (panel) {
    panel.classList.remove('hidden');
    document.getElementById('pronounce-status').textContent = 'Sẵn sàng ghi âm câu: ' + s.zh;
    document.getElementById('pronounce-score').textContent = '0';
    document.getElementById('pronounce-word-list').innerHTML = '';
    // Tự động cuộn xuống phần bảng điều khiển để người dùng thấy rõ
    panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  playAudio(s.zh);
}

function startPronunciationAssessment(sentence) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Trình duyệt của bạn không hỗ trợ nhận diện giọng nói. Hãy dùng Chrome hoặc Edge.");
    return;
  }

  if (pronounceRecognizer) pronounceRecognizer.stop();
  pronounceRecognizer = new SpeechRecognition();
  pronounceRecognizer.lang = 'zh-CN';
  pronounceRecognizer.interimResults = false;

  document.getElementById('pronounce-status').textContent = 'Đang lắng nghe... Hãy đọc to câu trên.';
  document.getElementById('pronounce-start-record').classList.add('btn-danger');

  pronounceRecognizer.onresult = (event) => {
    const result = event.results[0][0].transcript;
    const confidence = event.results[0][0].confidence;
    
    const target = normalizeChinese(sentence.zh);
    const spoken = normalizeChinese(result);
    
    // Thuật toán chấm điểm chặt chẽ hơn dùng Levenshtein Distance (Khoảng cách chỉnh sửa)
    const calculateScore = (t, s, conf) => {
      if (t === s) return 100;
      if (!s) return 0;
      const n = t.length, m = s.length;
      const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
      for (let i = 0; i <= n; i++) dp[i][0] = i;
      for (let j = 0; j <= m; j++) dp[0][j] = j;
      for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
          const cost = t[i - 1] === s[j - 1] ? 0 : 1;
          dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
      }
      const sim = 1 - dp[n][m] / Math.max(n, m);
      return Math.round(sim * 100 * (0.8 + 0.2 * conf)); // Kết hợp với độ tin cậy của AI
    };

    const score = calculateScore(target, spoken, confidence);

    // Hiển thị trực quan các từ phát âm đúng/sai
    let feedbackChars = Array.from(target).map(c => 
      `<span style="color:${spoken.includes(c) ? 'var(--green)' : '#cbd5e1'}; font-size:1.8rem; margin:0 2px;">${c}</span>`
    ).join('');

    document.getElementById('pronounce-score').textContent = score;
    document.getElementById('pronounce-status').textContent = `Bạn đã nói: "${result}"`;
    document.getElementById('pronounce-word-list').innerHTML = `
      <div class="center" style="margin-bottom:15px;">${feedbackChars}</div>
      <p class="center" style="font-weight:bold; color:var(--primary); font-size:1.1rem;">${score >= 90 ? '🌟 Hoàn hảo!' : (score >= 70 ? '👍 Rất tốt, gần chính xác rồi.' : (score >= 40 ? '👌 Khá ổn, hãy chú ý hơn.' : '😅 Cần luyện tập thêm.'))}</p>
      <p class="center muted" style="font-size:0.75rem; margin-top:10px;">Độ tin cậy nhận diện: ${Math.round(confidence * 100)}%</p>
    `;
  };

  pronounceRecognizer.onerror = (e) => {
    document.getElementById('pronounce-status').textContent = 'Lỗi ghi âm: ' + e.error;
  };

  pronounceRecognizer.onend = () => {
    document.getElementById('pronounce-start-record').classList.remove('btn-danger');
  };

  pronounceRecognizer.start();
}

function stopPronunciationSession(msg) {
  if (pronounceRecognizer) pronounceRecognizer.stop();
  document.getElementById('pronounce-status').textContent = msg || 'Đã dừng.';
}

// ── Auth Manager Class ──
class AuthManager {
  constructor() {
    this.token = localStorage.getItem('hg_token') || '';
    this.user = null;
    try {
      this.user = JSON.parse(localStorage.getItem('hg_user') || 'null');
    } catch (e) {
      console.warn('Failed to parse user from localStorage:', e);
      this.user = null;
      localStorage.removeItem('hg_user');
    }
    this.authMode = 'login';
  }

  // Safe error message helper
  getSafeErrorMessage(errorData) {
    if (typeof errorData === 'string') return errorData;
    if (errorData?.message) return errorData.message;
    if (errorData?.detail) return errorData.detail;
    if (errorData?.error) return errorData.error;
    return 'Đã xảy ra lỗi không xác định.';
  }

  saveSession(token, user) {
    this.token = token || '';
    this.user = user || null;
    if (this.token) localStorage.setItem('hg_token', this.token);
    else localStorage.removeItem('hg_token');
    if (this.user) localStorage.setItem('hg_user', JSON.stringify(this.user));
    else localStorage.removeItem('hg_user');
    this.updateAuthUI();
  }

  updateAuthUI() {
    const authTab = document.getElementById('auth-tab');
    const adminTab = document.getElementById('admin-tab');
    const nav = document.getElementById('nav');
    const isAdminRoute = window.location.pathname.startsWith('/admin1811');
    if (authTab) {
      authTab.textContent = this.user ? this.user.username : 'Đăng nhập';
      authTab.classList.toggle('hidden', this.user && !isAdminRoute);
    }
    if (nav) nav.classList.toggle('hidden', false);
    if (adminTab) adminTab.classList.toggle('hidden', !this.user?.is_admin);
    if (authTab) authTab.classList.toggle('hidden', isAdminRoute);
    document.getElementById('auth-logout')?.classList.toggle('hidden', !this.user);
  }

  async submitAuth() {
    const userInp = document.getElementById('auth-username');
    const passInp = document.getElementById('auth-password');
    const username = userInp.value.trim();
    const password = passInp.value;
    const err = document.getElementById('auth-error');
    const btn = document.getElementById('auth-submit');

    err.classList.add('hidden');
    err.textContent = '';

    if (!username || !password) {
      err.textContent = 'Vui lòng nhập username và password.';
      err.classList.remove('hidden');
      if (!username) userInp.focus(); else passInp.focus();
      return;
    }

    try {
      btn.disabled = true;
      btn.textContent = 'Đang đăng nhập...';

      const res = await api(`/api/auth/login`, {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });

      this.saveSession(res.token, res.user);
      if (window.location.pathname === '/admin1811') {
        if (!res.user?.is_admin) {
          this.saveSession('', null);
          err.textContent = 'Tài khoản này không có quyền admin.';
          err.classList.remove('hidden');
          return;
        }
        showView('admin');
        loadAdmin();
      } else {
        closeAuth();
        if (window.requestedView) {
          const viewName = window.requestedView;
          window.requestedView = null;
          showView(viewName);
        }
      }
    } catch (error) {
      console.error('Login error:', error);
      err.textContent = this.getSafeErrorMessage(error);
      err.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Đăng nhập';
    }
  }

  async submitRegister() {
    const userInp = document.getElementById('auth-reg-username');
    const passInp = document.getElementById('auth-reg-password');
    const confirmInp = document.getElementById('auth-reg-password-confirm');
    
    const username = userInp.value.trim();
    const password = passInp.value;
    const passwordConfirm = confirmInp.value;
    const err = document.getElementById('auth-reg-error');
    const btn = document.getElementById('auth-register');

    err.classList.add('hidden');
    err.textContent = '';

    if (!username || !password || !passwordConfirm) {
      err.textContent = 'Vui lòng điền tất cả các trường.';
      err.classList.remove('hidden');
      if (!username) userInp.focus(); else if (!password) passInp.focus(); else confirmInp.focus();
      return;
    }

    if (username.length < 3 || username.length > 32) {
      err.textContent = 'Username phải có 3-32 ký tự.';
      err.classList.remove('hidden');
      return;
    }

    if (password.length < 6) {
      err.textContent = 'Mật khẩu phải có tối thiểu 6 ký tự.';
      err.classList.remove('hidden');
      return;
    }

    if (password !== passwordConfirm) {
      err.textContent = 'Mật khẩu xác nhận không trùng khớp.';
      err.classList.remove('hidden');
      return;
    }

    try {
      btn.disabled = true;
      btn.textContent = 'Đang tạo tài khoản...';

      const res = await api(`/api/auth/register`, {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      this.saveSession(res.token, res.user);
      alert('✅ Đăng ký thành công!');
      closeAuth();
      if (window.requestedView) {
        const viewName = window.requestedView;
        window.requestedView = null;
        showView(viewName);
      } else {
        showView('home');
        renderHome();
      }
    } catch (error) {
      console.error('Register error:', error);
      err.textContent = this.getSafeErrorMessage(error);
      err.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Đăng ký';
    }
  }

  switchAuthMode(mode) {
    this.authMode = mode;
    const loginForm = document.getElementById('auth-login-form');
    const registerForm = document.getElementById('auth-register-form');
    
    // Xóa lỗi cũ khi chuyển tab
    document.getElementById('auth-error').classList.add('hidden');
    document.getElementById('auth-reg-error').classList.add('hidden');

    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.mode === mode);
      if (tab.dataset.mode === mode) {
        tab.style.color = 'var(--primary)';
        tab.style.borderBottomColor = 'var(--primary)';
      } else {
        tab.style.color = '#999';
        tab.style.borderBottomColor = 'transparent';
      }
    });

    if (mode === 'login') {
      loginForm.classList.remove('hidden');
      registerForm.classList.add('hidden');
      document.getElementById('auth-username').focus();
    } else {
      loginForm.classList.add('hidden');
      registerForm.classList.remove('hidden');
      document.getElementById('auth-reg-username').focus();
    }
  }

  async logout() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      console.warn('Logout endpoint failed:', e);
    }
    this.saveSession('', null);
    if (window.location.pathname === '/admin1811') {
      this.showAdminEntry();
    } else {
      showView('home');
      renderHome();
    }
  }

  showAdminEntry() {
    this.authMode = 'login';
    this.updateAuthUI();
    document.getElementById('auth-title').textContent = 'Admin login';
    document.getElementById('auth-submit').textContent = 'Đăng nhập admin';
    const authSwitch = document.getElementById('auth-switch');
    if (authSwitch) authSwitch.classList.add('hidden');
    if (this.user?.is_admin) {
      showView('admin');
      loadAdmin();
    } else {
      showView('auth');
    }
  }
}

const authManager = new AuthManager();
function saveLearned() { localStorage.setItem('hg_learned', JSON.stringify(S.learned)); }
function isLearned(w) { return !!S.learned[w]; }
function toggleLearned(w) { S.learned[w] ? delete S.learned[w] : S.learned[w] = 1; saveLearned(); }

function playAudioFallback(text, slow = false) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-CN';
  utterance.rate = slow ? 0.6 : 0.95;
  const voices = window.speechSynthesis.getVoices();
  const chineseVoice = voices.find(v => /zh|Chinese|Mandarin/i.test(`${v.lang} ${v.name}`));
  if (chineseVoice) utterance.voice = chineseVoice;
  window.speechSynthesis.speak(utterance);
}

function playAudio(text, slow = false) {
  if (!text) return;
  // Use Google TTS if on HTTPS (production), otherwise use browser speech synthesis
  if (window.location.protocol === 'https:') {
    const url = `${API}/api/audio?text=${encodeURIComponent(text)}`;
    const audio = new Audio(url);
    if (slow) audio.playbackRate = 0.6;
    audio.addEventListener('error', () => playAudioFallback(text, slow), { once: true });
    audio.play().catch(e => {
      console.error("Audio error:", e);
      playAudioFallback(text, slow);
    });
  } else {
    playAudioFallback(text, slow);
  }
}

// ── API helpers ──
// Global AbortController: cancel tất cả request pending khi navigate sang view mới
let _navController = new AbortController();

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (authManager?.token) headers.Authorization = `Bearer ${authManager.token}`;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  // Dùng signal của nav controller để hủy request khi user chuyển view
  const signal = options.signal || _navController.signal;

  let r;
  try {
    r = await fetch(API + path, { ...options, headers, signal });
  } catch (err) {
    // Bỏ qua AbortError – đây là hủy cố ý, không phải lỗi thật
    if (err.name === 'AbortError') throw err;
    throw err;
  }

  if (!r.ok) {
    if (r.status === 401 && !path.startsWith('/api/auth/')) {
      // Session hết hạn – chỉ áp dụng với các API yêu cầu xác thực,
      // KHÔNG áp dụng cho chính endpoint login/register (tránh lỗi nhầm)
      if (authManager) {
        authManager.saveSession('', null);
      }
      showView('auth');
      throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    }
    let errorData = r.statusText;
    try {
      const jsonData = await r.json();
      errorData = jsonData;
    } catch {}
    throw new Error(authManager?.getSafeErrorMessage(errorData) || getSafeErrorMessage(errorData));
  }
  return r.json();
}

function getSafeErrorMessage(errorData) {
  if (typeof errorData === 'string') return errorData;
  if (errorData?.detail) return errorData.detail;
  if (errorData?.message) return errorData.message;
  if (errorData?.error) return errorData.error;
  return 'Đã xảy ra lỗi không xác định';
}

// ── HOME ──
const HSK_INFO = [
  { level: 1, name: 'HSK 1 · Nhập môn', desc: 'Giao tiếp cơ bản hàng ngày', color: '#16a34a' },
  { level: 2, name: 'HSK 2 · Sơ cấp', desc: 'Mở rộng từ vựng & ngữ pháp', color: '#2563eb' },
  { level: 3, name: 'HSK 3 · Trung sơ', desc: 'Diễn đạt ý kiến, kể chuyện', color: '#d97706' },
  { level: 4, name: 'HSK 4 · Trung cấp', desc: 'Đọc báo, hội thoại phức tạp', color: '#ea580c' },
  { level: 5, name: 'HSK 5 · Cao cấp', desc: 'Văn học, hội thảo chuyên sâu', color: '#7c3aed' },
  { level: 6, name: 'HSK 6 · Thành thạo', desc: 'Trình độ học thuật cao', color: '#dc2626' },
];

let _isRenderingHome = false;
async function renderHome() {
  if (_isRenderingHome) return;
  _isRenderingHome = true;
  let summary;
  try { summary = await api('/api/hsk'); } catch { summary = HSK_INFO.map(h => ({ level: h.level, total: 0 })); }

  const grid = document.getElementById('hsk-grid');
  grid.innerHTML = HSK_INFO.map(h => {
    const info = summary.find(s => s.level === h.level) || { total: 0 };
    const learnedCount = Object.keys(S.learned).filter(w => {
      // approximate: we don't know level per word here, but still show global progress
      return S.learned[w];
    }).length;
    return `
      <div class="hsk-card" data-level="${h.level}" onclick="openLearn(${h.level}, 0)">
        <div class="hsk-label" style="color:${h.color}">${h.name}</div>
        <div class="hsk-desc">${h.desc}</div>
        <div class="hsk-count">${info.total} từ</div>
        <div class="hsk-bar"><div class="hsk-bar-fill" style="width:0%;background:${h.color}"></div></div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.hsk-card').forEach(c => {
    c.addEventListener('click', () => { S.level = +c.dataset.level; openLearn(S.level, 0); });
  });

  // Hiển thị thông báo ôn tập nếu có từ quá hạn
  if (authManager.user) {
    try {
      const stats = await api('/api/progress/stats');
      const reviewTab = document.querySelector('.tab[data-view="review"]');
      if (stats.due_count > 0) {
        if (reviewTab) reviewTab.innerHTML = `Ôn tập <span class="badge-danger">${stats.due_count}</span>`;
        const homeDueMsg = document.createElement('div');
        homeDueMsg.className = 'alert-info center';
        homeDueMsg.style.margin = '20px 0';
        homeDueMsg.innerHTML = `🔔 Bạn có <strong>${stats.due_count}</strong> từ cần ôn tập ngay hôm nay! <button class="btn-primary-sm" onclick="showView('review'); loadReviewQueue(0);">Ôn ngay</button>`;
        grid.parentNode.insertBefore(homeDueMsg, grid);
      } else if (reviewTab) {
        reviewTab.innerHTML = `Ôn tập`;
      }
    } catch (e) {}
  }
  _isRenderingHome = false;
}

async function handleUpdateHSK() {
  const overlay = document.getElementById('loading-overlay');
  const text = document.getElementById('loading-text');
  overlay.classList.remove('hidden');
  text.textContent = 'Đang tải dữ liệu HSK mới và dịch sang tiếng Việt (có thể mất 1 phút)...';

  try {
    const res = await api('/api/hsk/update', { method: 'POST' });
    if (res.status === 'success') {
      alert('✅ Đã cập nhật thành công kho từ vựng HSK mới nhất!');
      // Refresh home and current view
      await renderHome();
      if (S.view === 'learn') openLearn(S.level, 0);
    } else {
      alert('❌ Lỗi cập nhật: ' + res.msg);
    }
  } catch (e) {
    alert('❌ Lỗi kết nối server khi cập nhật.');
  } finally {
    overlay.classList.add('hidden');
  }
}

// ── LEARN ──

async function loadAdmin() {
  if (!authManager.user?.is_admin) return;
  const userList = document.getElementById('admin-users');
  const logList = document.getElementById('admin-logs');
  if (!userList || !logList) return;

  userList.innerHTML = '<p class="muted center">Đang tải...</p>';
  try {
    const [users, logs] = await Promise.all([
      api('/api/admin/users'),
      api('/api/admin/logs'),
    ]);
    userList.innerHTML = users.map(u => `
      <div class="admin-row admin-user-row">
        <div class="admin-user-meta">
          <strong>${u.username}</strong>
          <div class="admin-badges">
            ${u.is_admin ? '<span class="pill">Admin</span>' : '<span class="pill pill-muted">User</span>'}
            <span class="pill ${u.is_active ? 'pill-ok' : 'pill-danger'}">${u.is_active ? 'Active' : 'Disabled'}</span>
          </div>
        </div>
        <div class="admin-user-actions">
          ${u.username === 'admin1811' ? '<span class="admin-locked">Khóa</span>' : `<button class="btn-ghost-sm" data-user-active="${u.id}" data-active="${!u.is_active}">${u.is_active ? 'Disable' : 'Enable'}</button>`}
        </div>
      </div>
    `).join('') || '<p class="muted">Chưa có người dùng.</p>';

    logList.innerHTML = logs.map(l => `
      <div class="admin-row admin-log-row">
        <div>
          <strong>${l.ip}</strong>
          <div class="muted admin-log-meta">${l.time} · ${l.device}</div>
        </div>
        <code class="admin-log-path">${l.path}</code>
      </div>
    `).reverse().join('') || '<p class="muted">Chưa có log truy cập.</p>';

    document.querySelectorAll('[data-user-active]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api(`/api/admin/users/${btn.dataset.userActive}/active?is_active=${btn.dataset.active}`, { method: 'PATCH' });
        loadAdmin();
      });
    });
  } catch (e) {
    userList.innerHTML = `<p class="muted">Lỗi tải dữ liệu: ${e.message}</p>`;
  }
}

/** Personal Saved Vocabulary */
let isSavedWordsLoading = false;
let _savedWordsLastCall = 0; // timestamp guard – ngăn gọi lại trong vòng 3s
async function openSavedWords() {
  const el = document.getElementById('saved-words-list');
  const now = Date.now();
  if (!el || isSavedWordsLoading || now - _savedWordsLastCall < 3000) return;

  isSavedWordsLoading = true;
  _savedWordsLastCall = now;

  el.innerHTML = '<p class="muted center">Đang tải danh sách từ vựng...</p>';
  try {
    const data = await api('/api/saved_words');
    if (!data || data.length === 0) {
      el.innerHTML = '<p class="muted center">Bạn chưa lưu từ vựng nào.</p>';
      return;
    }
    const words = data.map(w => ({
      id: w.id,
      simplified: w.word,
      pinyin: w.pinyin,
      vietnamese: w.meaning,
      english: [], // Backend saved meaning is stored in vietnamese field for display
      hsk: w.hsk_level,
      traditional: w.word,
      isSaved: true
    }));
    renderWordList(words, 'saved-words-list', true);
  } catch (e) {
    el.innerHTML = `<p class="muted center">Lỗi: ${e.message}</p>`;
  } finally {
    isSavedWordsLoading = false;
  }
}

let isLearnLoading = false;
async function openLearn(level, page) {
  if (isLearnLoading) return;
  isLearnLoading = true;

  if (S.view !== 'learn') {
    showView('learn');
  }

  S.level = level;
  S.learnPage = page;
  const offset = page * S.learnPerPage;
  const info = HSK_INFO.find(h => h.level === level);
  document.getElementById('learn-title').textContent = info?.name || `HSK ${level}`;
  const levelSelect = document.getElementById('learn-level');
  if (levelSelect) levelSelect.value = String(level);

  try {
    const data = await api(`/api/hsk/${level}?limit=${S.learnPerPage}&offset=${offset}`);
    S.learnData = data;
    document.getElementById('learn-info').textContent = `${data.total} từ`;
    document.getElementById('learn-progress').textContent = `Trang ${page + 1} / ${Math.ceil(data.total / S.learnPerPage)}`;
    renderWordList(data.words, 'word-list');
    renderPagination(data.total, page, 'learn-pagination', (p) => openLearn(level, p));
  } catch (e) {
    document.getElementById('word-list').innerHTML = `<p class="muted center">Lỗi tải dữ liệu. Hãy kiểm tra backend đã chạy chưa.</p>`;
  } finally {
    isLearnLoading = false;
  }
}

window.openLearn = openLearn;

function renderWordList(words, containerId, isSavedView = false) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!words || !words.length) { el.innerHTML = '<p class="muted center">Không tìm thấy từ nào.</p>'; return; }

  el.innerHTML = words.map(w => {
    const en = (w.english || []).slice(0, 2).join('; ') || '–';
    const vi = w.vietnamese || '';
    const done = isLearned(w.simplified) ? ' done' : '';
    return `
      <div class="word-item${done}" data-word="${w.simplified}" tabindex="0">
        <div class="wi-main">
          <div class="wi-zh">${w.simplified}</div>
          <div class="wi-py">${w.pinyin}</div>
          ${vi ? `<div class="wi-vi">${vi}</div>` : ''}
          <div class="wi-en">${en}</div>
        </div>
        <div class="wi-actions">
           ${isSavedView ? `<button class="btn-ghost-sm" style="color:var(--red)" title="Xóa" onclick="event.stopPropagation(); deleteSavedWord(${w.id})">🗑️</button>` : ''}
           <button class="btn-audio-sm" title="Nghe phát âm" onclick="event.stopPropagation(); playAudio('${w.simplified}')">🔊</button>

           <button class="btn-audio-sm slow" title="Nghe chậm" onclick="event.stopPropagation(); playAudio('${w.simplified}', true)">🐌</button>
        </div>
      </div>`;
  }).join('');
  el.querySelectorAll('.word-item').forEach((item, idx) => {
    item.dataset.full = JSON.stringify(words[idx]);
    item.addEventListener('click', (e) => {
      // If clicking directly on actions, don't open modal
      if (e.target.closest('.wi-actions')) return;
      openModal(words[idx]);
    });
  });
}

/** Xóa từ vựng đã lưu */
async function deleteSavedWord(id) {
  if (!confirm('Bạn có chắc muốn xóa từ này khỏi danh sách đã lưu?')) return;
  try {
    const res = await api(`/api/saved_words/${id}`, { method: 'DELETE' });
    if (res.status === 'success') {
      openSavedWords(); // Tải lại danh sách
    } else {
      alert('Lỗi: ' + res.msg);
    }
  } catch (e) {
    alert('Lỗi khi xóa: ' + e.message);
  }
}

function renderPagination(total, current, containerId, onClick) {
  const pages = Math.ceil(total / S.learnPerPage);
  if (pages <= 1) { document.getElementById(containerId).innerHTML = ''; return; }
  const el = document.getElementById(containerId);
  let html = '';
  for (let i = 0; i < pages; i++) {
    html += `<button class="pg-btn${i === current ? ' active' : ''}" data-p="${i}">${i + 1}</button>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('.pg-btn').forEach(b => b.addEventListener('click', () => onClick(+b.dataset.p)));
}

// ── VIEW MANAGEMENT ──
function showView(viewName) {
  // ✔️ Chặn Loop: Nếu đang ở đúng view đó rồi thì không làm gì cả
  if (S.view === viewName && viewName !== 'auth') return;

  // Kiểm tra quyền truy cập (Auth Check)
  if (viewName !== 'auth' && !authManager.user && !['home', 'search', 'pronounce', 'learn'].includes(viewName)) {
    if (viewName !== 'auth') window.requestedView = viewName;
    showView('auth');
    return;
  }

  S.view = viewName;

  if (viewName === 'auth') {
    document.getElementById('view-auth')?.classList.remove('hidden');
    document.getElementById('nav')?.classList.add('hidden');
    return;
  }

  // Cancel tất cả request pending từ view trước – tránh pile-up khi Railway chậm
  _navController.abort();
  _navController = new AbortController();
  // Reset home guard để cho phép render lại khi cần
  if (viewName !== 'home') _isRenderingHome = false;
  
  // 2. Ẩn/Hiện các màn hình
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById('view-auth')?.classList.add('hidden');
  
  const targetView = document.getElementById(`view-${viewName}`);
  if (targetView) targetView.classList.remove('hidden');
  document.getElementById('nav')?.classList.remove('hidden');

  // 3. Cập nhật trạng thái Active trên Menu
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === viewName));
  window.scrollTo(0, 0);

  // 4. Tải dữ liệu đặc thù cho từng màn hình (Single Source of Truth)
  if (viewName === 'home') renderHome();
  else if (viewName === 'learn') openLearn(S.level, 0);
  else if (viewName === 'saved') openSavedWords();
  else if (viewName === 'review') loadReviewQueue(0);
  else if (viewName === 'admin') loadAdmin();
  else if (viewName === 'pronounce') loadPronounceLevel(S.pronounce.level || 1);
  else if (viewName === 'flashcard') initFC(+document.getElementById('fc-level').value);
}

// ── SRS REVIEW ──
let reviewData = { level: 0, words: [], idx: 0, correct: 0, wrong: 0 };
let isReviewLoading = false;

async function loadReviewQueue(level = 0) {
  if (isReviewLoading) return;
  isReviewLoading = true;

  reviewData.level = level;
  reviewData.idx = 0;
  reviewData.correct = 0;
  reviewData.wrong = 0;
  
  document.getElementById('review-queue-display').innerHTML = '<p class="muted center">Đang tải...</p>';
  document.getElementById('review-card').classList.add('hidden');
  document.getElementById('review-stats').classList.add('hidden');
  
  try {
    const data = await api(`/api/review-queue?level=${level}&limit=20`);
    reviewData.words = data.words || [];
    
    if (!reviewData.words.length) {
      document.getElementById('review-queue-display').innerHTML = '<p class="muted center">🎉 Bạn đã hoàn thành tất cả bài học! Quay lại sau để ôn tập thêm.</p>';
      return;
    }
    
    document.getElementById('review-queue-display').innerHTML = '';
    document.getElementById('review-card').classList.remove('hidden');
    showReviewCard(0);
  } catch (e) {
    document.getElementById('review-queue-display').innerHTML = `<p class="muted center">Lỗi: ${e.message}</p>`;
  } finally {
    isReviewLoading = false;
  }
}

function showReviewCard(idx) {
  if (idx >= reviewData.words.length) {
    endReviewSession();
    return;
  }
  
  const word = reviewData.words[idx];
  document.getElementById('review-word-char').textContent = word.word;
  
  // Ẩn Pinyin và Nghĩa lúc mới hiện thẻ
  const pinyinEl = document.getElementById('review-word-pinyin');
  const viEl = document.getElementById('review-word-vi');
  pinyinEl.textContent = word.pinyin || '–';
  viEl.textContent = word.vietnamese || '–';
  pinyinEl.classList.add('hidden');
  viEl.classList.add('hidden');

  // Quản lý hiển thị nút
  document.getElementById('review-show-answer')?.classList.remove('hidden');
  document.getElementById('review-actions')?.classList.add('hidden');

  document.getElementById('review-counter').textContent = `${idx + 1} / ${reviewData.words.length}`;
  document.getElementById('review-correct').textContent = reviewData.correct;
  document.getElementById('review-wrong').textContent = reviewData.wrong;
  document.getElementById('review-feedback').textContent = '';
  
  reviewData.idx = idx;
}

function revealReviewAnswer() {
  document.getElementById('review-word-pinyin')?.classList.remove('hidden');
  document.getElementById('review-word-vi')?.classList.remove('hidden');
  document.getElementById('review-show-answer')?.classList.add('hidden');
  document.getElementById('review-actions')?.classList.remove('hidden');
}

async function submitReviewAnswer(is_correct) {
  const word = reviewData.words[reviewData.idx];
  // Vô hiệu hóa nút để tránh bấm nhiều lần
  document.querySelectorAll('#review-actions button').forEach(b => b.disabled = true);
  
  try {
    const res = await api('/api/progress', {
      method: 'POST',
      body: JSON.stringify({
        word: word.word,
        hsk_level: word.hsk_level,
        is_correct: is_correct
      })
    });
    
    if (is_correct) {
      reviewData.correct++;
      document.getElementById('review-feedback').textContent = '✓ Đúng! Tốt lắm!';
      document.getElementById('review-feedback').style.color = 'var(--green)';
    } else {
      reviewData.wrong++;
      document.getElementById('review-feedback').textContent = `✗ Sai! Đáp án: ${word.word} (${word.pinyin})`;
      document.getElementById('review-feedback').style.color = 'var(--red)';
    }
    
    // Auto advance after 1.5s
    setTimeout(() => {
      document.querySelectorAll('#review-actions button').forEach(b => b.disabled = false);
      showReviewCard(reviewData.idx + 1);
    }, 1500);
  } catch (e) {
    alert('Lỗi: ' + e.message);
  }
}

function endReviewSession() {
  document.getElementById('review-card').classList.add('hidden');
  document.getElementById('review-stats').classList.remove('hidden');
  
  const total = reviewData.correct + reviewData.wrong;
  const accuracy = total === 0 ? 0 : Math.round((reviewData.correct / total) * 100);
  
  document.getElementById('review-final-correct').textContent = reviewData.correct;
  document.getElementById('review-final-wrong').textContent = reviewData.wrong;
  document.getElementById('review-accuracy').textContent = accuracy + '%';
}

// ── SEARCH ──
// ✔️ Fix 2: Áp dụng debounce cho tìm kiếm từ điển
const doSearch = debounce(async (q) => {
  if (!q.trim()) {
    document.getElementById('search-results').innerHTML = '<p class="muted center">Nhập từ khóa để tìm kiếm bằng chữ Hán, pinyin, tiếng Anh hoặc tiếng Việt.</p>';
    return;
  }
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(q)}&limit=60`);
    renderWordList(data.results, 'search-results');
  } catch {
    document.getElementById('search-results').innerHTML = '<p class="muted center">Lỗi tìm kiếm.</p>';
  }
}, 400);

// ── MODAL ──
let currentWord = null;
let writers = [];

function openModal(w) {
  if (!w) return;
  currentWord = w;
  document.getElementById('m-char').textContent = w.simplified;
  document.getElementById('m-trad').textContent = w.traditional !== w.simplified ? `Phồn thể: ${w.traditional}` : '';
  document.getElementById('m-pinyin').textContent = w.pinyin;
  document.getElementById('m-vi').textContent = w.vietnamese ? `${w.vietnamese}` : '';
  document.getElementById('m-en').textContent = (w.english || []).join(' · ') || '–';
  document.getElementById('m-hsk').innerHTML = w.hsk ? `<span class="pill">HSK ${w.hsk}</span>` : '';

  // Fix bị khuất: Đảm bảo Modal cuộn lên đầu khi mở
  const modalEl = document.getElementById('modal');
  modalEl.classList.remove('hidden');
  const modalContent = modalEl.querySelector('.modal-content');
  if (modalContent) modalContent.scrollTop = 0;

  // Audio buttons in modal
  const audioContainer = document.getElementById('m-audio-ctrl');
  if (audioContainer) {
    audioContainer.innerHTML = `
      <button class="btn-audio" onclick="playAudio('${w.simplified}')">🔊 Phát âm</button>
      <button class="btn-audio slow" onclick="playAudio('${w.simplified}', true)">🐌 Đọc chậm</button>
    `;
  }

  const charEl = document.getElementById('m-char');
  const writerEl = document.getElementById('m-writer');
  const writerCtrl = document.getElementById('m-writer-ctrl');

  if (typeof HanziWriter !== 'undefined') {
    charEl.style.display = 'none';
    writerEl.style.display = 'flex';
    writerEl.style.justifyContent = 'center';
    writerEl.style.flexWrap = 'wrap';
    writerEl.style.gap = '10px';
    writerEl.style.alignItems = 'center';
    writerCtrl.style.display = 'block';
    writerEl.innerHTML = '';
    writers = [];

    // Auto scale down character size if the word is long
    const charSize = w.simplified.length > 4 ? 60 : (w.simplified.length > 2 ? 80 : 120);

    for (let i = 0; i < w.simplified.length; i++) {
      // Chỉ hiển thị HanziWriter cho chữ Hán, bỏ qua các ký tự đặc biệt (nếu có)
      if (!/[\u3400-\u9FBF]/.test(w.simplified[i])) continue;

      const div = document.createElement('div');
      div.id = `m-writer-char-${i}`;
      div.style.width = `${charSize}px`;
      div.style.height = `${charSize}px`;
      div.style.margin = '2px';
      writerEl.appendChild(div);

      const wr = HanziWriter.create(div.id, w.simplified[i], {
        width: charSize, height: charSize, padding: 5,
        strokeAnimationSpeed: 1.5, delayBetweenStrokes: 50, showOutline: true
      });
      writers.push(wr);
    }

    // Nếu không có chữ Hán nào hợp lệ, hiển thị lại dạng văn bản
    if (writers.length === 0) {
      charEl.style.display = 'block';
      writerEl.style.display = 'none';
      writerCtrl.style.display = 'none';
    }
  } else {
    charEl.style.display = 'block';
    writerEl.style.display = 'none';
    writerCtrl.style.display = 'none';
  }
}
function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  if (writers && writers.length > 0) {
    writers.forEach(wr => wr.cancelQuiz());
  }
}

function closeAuth() {
  document.getElementById('view-auth').classList.add('hidden');
  document.getElementById('nav').classList.remove('hidden');
  if (S.view === 'auth') {
    S.view = '';
    showView('home');
  }
}

// ── FLASHCARD ──
async function initFC(level) {
  const mode = document.getElementById('fc-mode')?.value || 'hsk';
  try {
    if (mode === 'saved') {
      const data = await api('/api/flashcard/saved');
      S.fcDeck = data.words || [];
    } else {
      const data = await api(`/api/random?level=${level}&count=30`);
      S.fcDeck = data;
    }
    S.fcIdx = 0;
    updateFC();
  } catch {
    S.fcDeck = [];
    updateFC();
  }
}

function updateFC() {
  const d = S.fcDeck;
  if (!d.length) {
    document.getElementById('card-char').textContent = '–';
    document.getElementById('cb-char').textContent = '';
    document.getElementById('cb-pinyin').textContent = '';
    document.getElementById('cb-vi').textContent = '';
    document.getElementById('cb-en').textContent = '';
    document.getElementById('fc-front-audio').innerHTML = '';
    document.getElementById('fc-back-audio').innerHTML = '';
    document.getElementById('fc-idx').textContent = '0';
    document.getElementById('fc-total').textContent = '0';
    return;
  }
  const w = d[S.fcIdx];
  document.getElementById('card-char').textContent = w.simplified;
  document.getElementById('cb-char').textContent = w.simplified;
  document.getElementById('cb-pinyin').textContent = w.pinyin;
  document.getElementById('cb-vi').textContent = w.vietnamese ? `${w.vietnamese}` : '';
  document.getElementById('cb-en').textContent = (w.english || []).slice(0, 3).join('; ');

  // Add audio buttons to flashcard
  const frontAudio = document.getElementById('fc-front-audio');
  const backAudio = document.getElementById('fc-back-audio');
  if (frontAudio) frontAudio.innerHTML = `<button class="btn-audio-sm" onclick="event.stopPropagation(); playAudio('${w.simplified}')">🔊</button>`;
  if (backAudio) backAudio.innerHTML = `<button class="btn-audio-sm" onclick="event.stopPropagation(); playAudio('${w.simplified}')">🔊</button>`;

  document.getElementById('fc-idx').textContent = S.fcIdx + 1;
  document.getElementById('fc-total').textContent = d.length;
  document.getElementById('card').classList.remove('flipped');
}
function flipFC() { document.getElementById('card').classList.toggle('flipped'); }
function nextFC(d) { S.fcIdx = (S.fcIdx + d + S.fcDeck.length) % S.fcDeck.length; updateFC(); }
function shuffleFC() {
  for (let i = S.fcDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [S.fcDeck[i], S.fcDeck[j]] = [S.fcDeck[j], S.fcDeck[i]];
  }
  S.fcIdx = 0; updateFC();
}

function resetQuizUI() {
  stopQuizTimer();
  document.getElementById('quiz-setup').classList.remove('hidden');
  document.getElementById('quiz-play').classList.add('hidden');
  document.getElementById('quiz-result').classList.add('hidden');
}

// ── QUIZ ──
async function startQuiz() {
  const level = +document.getElementById('quiz-level').value;
  const count = +document.getElementById('quiz-count').value;
  resetQuizUI();
  try {
    const all = await api(`/api/random?level=${level}&count=80`);
    if (all.length < 4) { alert('Không đủ từ để tạo quiz.'); return; }
    const shuffled = [...all].sort(() => Math.random() - 0.5);
    S.quiz = { qs: shuffled.slice(0, Math.min(count, shuffled.length)), cur: 0, right: 0, wrong: 0, total: Math.min(count, shuffled.length), allWords: all };
    document.getElementById('quiz-setup').classList.add('hidden');
    document.getElementById('quiz-result').classList.add('hidden');
    document.getElementById('quiz-play').classList.remove('hidden');
    renderQ();
  } catch { alert('Lỗi tải dữ liệu quiz.'); }
}

function renderQ() {
  const q = S.quiz;
  if (q.cur >= q.total) { showQuizResult(); return; }
  const w = q.qs[q.cur];
  document.getElementById('qbar-fill').style.width = (q.cur / q.total * 100) + '%';
  document.getElementById('q-progress').textContent = `${q.cur + 1}/${q.total}`;
  document.getElementById('q-right').textContent = `✓ ${q.right}`;
  document.getElementById('q-wrong').textContent = `✗ ${q.wrong}`;
  document.getElementById('q-word').textContent = w.simplified;
  document.getElementById('q-sub').textContent = w.pinyin;
  document.getElementById('q-label').textContent = 'Nghĩa của từ:';

  // Play audio automatically in quiz? Let's add a button instead for now
  document.getElementById('q-word').innerHTML = `${w.simplified} <button class="btn-audio-sm" style="font-size:1.5rem" onclick="playAudio('${w.simplified}')">🔊</button>`;

  startQuizTimer(15);

  // Use Vietnamese for quiz answers if available, fallback to English
  const getAnswer = (word) => word.vietnamese || (word.english || []).slice(0, 2).join('; ');
  const correctAns = getAnswer(w);
  const pool = q.allWords.filter(x => x.simplified !== w.simplified);
  const wrongs = pool.sort(() => Math.random() - 0.5).slice(0, 3);
  const opts = [...wrongs.map(x => getAnswer(x)), correctAns].sort(() => Math.random() - 0.5);

  const container = document.getElementById('q-opts');
  container.innerHTML = opts.map((o, i) => `<button class="q-opt" data-a="${o}">${o}</button>`).join('');
  document.getElementById('q-fb').classList.add('hidden');

  container.querySelectorAll('.q-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      stopQuizTimer();
      const isRight = btn.dataset.a === correctAns;
      container.querySelectorAll('.q-opt').forEach(b => {
        b.disabled = true;
        if (b.dataset.a === correctAns) b.classList.add('correct');
        else if (b === btn && !isRight) b.classList.add('wrong');
      });
      if (isRight) q.right++; else q.wrong++;
      const fb = document.getElementById('q-fb');
      fb.classList.remove('hidden');
      document.getElementById('q-fb-text').innerHTML = isRight
        ? `<strong style="color:var(--green)">Đúng!</strong> ${w.simplified} = ${correctAns}`
        : `<strong style="color:var(--red)">Sai!</strong> Đáp án: ${correctAns}`;
    });
  });
}

function startQuizTimer(sec) {
  stopQuizTimer();
  let time = sec;
  const el = document.getElementById('q-timer');
  el.textContent = `${time}s`;
  el.classList.remove('urgent');

  quizTimerInt = setInterval(() => {
    time--;
    el.textContent = `${time}s`;
    if (time <= 5) el.classList.add('urgent');
    if (time <= 0) {
      stopQuizTimer();
      handleQuizTimeout();
    }
  }, 1000);
}

function stopQuizTimer() {
  if (quizTimerInt) clearInterval(quizTimerInt);
  quizTimerInt = null;
}

function handleQuizTimeout() {
  const q = S.quiz;
  const w = q.qs[q.cur];
  const correctAns = w.vietnamese || (w.english || []).slice(0, 2).join('; ');

  const container = document.getElementById('q-opts');
  container.querySelectorAll('.q-opt').forEach(b => {
    b.disabled = true;
    if (b.dataset.a === correctAns) b.classList.add('correct');
  });

  q.wrong++;
  const fb = document.getElementById('q-fb');
  fb.classList.remove('hidden');
  document.getElementById('q-fb-text').innerHTML = `<strong style="color:var(--red)">Hết giờ!</strong> Đáp án: ${correctAns}`;
}

function showQuizResult() {
  stopQuizTimer();
  const q = S.quiz;
  const pct = Math.round(q.right / q.total * 100);
  document.getElementById('quiz-play').classList.add('hidden');
  document.getElementById('quiz-result').classList.remove('hidden');
  document.getElementById('qr-score').textContent = pct + '%';
  document.getElementById('qr-score').style.color = pct >= 70 ? 'var(--green)' : 'var(--red)';
  document.getElementById('qr-detail').textContent = `Đúng ${q.right} / Sai ${q.wrong} / Tổng ${q.total}`;
  document.getElementById('qr-title').textContent = pct >= 70 ? '🎉 Tốt lắm!' : '😅 Cố gắng thêm!';
}

function endQuiz() {
  stopQuizTimer();
  const q = S.quiz;
  q.total = q.cur;
  showQuizResult();
}

// ── TYPING ──
async function startTyping() {
  const level = +document.getElementById('type-level').value;
  const count = +document.getElementById('type-count').value;
  try {
    const all = await api(`/api/random?level=${level}&count=${count}`);
    if (all.length < 1) { alert('Không đủ từ để bắt đầu.'); return; }
    S.type = { qs: all, cur: 0, right: 0, total: all.length };
    document.getElementById('type-setup').classList.add('hidden');
    document.getElementById('type-result').classList.add('hidden');
    document.getElementById('type-play').classList.remove('hidden');
    renderType();
  } catch { alert('Lỗi tải dữ liệu.'); }
}

function renderType() {
  const t = S.type;
  if (t.cur >= t.total) { showTypeResult(); return; }
  const w = t.qs[t.cur];

  document.getElementById('type-progress').textContent = `${t.cur + 1}/${t.total}`;
  document.getElementById('type-right').textContent = `✓ ${t.right}`;

  document.getElementById('type-pinyin').style.visibility = 'hidden';
  document.getElementById('type-vi').style.visibility = 'hidden';

  document.getElementById('type-word').textContent = w.simplified;
  document.getElementById('type-pinyin').textContent = w.pinyin;
  document.getElementById('type-vi').textContent = w.vietnamese ? w.vietnamese : (w.english || []).slice(0, 2).join('; ');

  const inputEl = document.getElementById('type-input');
  inputEl.value = '';
  inputEl.style.borderColor = '#ccc';
  inputEl.focus();

  // Create new input to wipe old event listeners
  const newEl = inputEl.cloneNode(true);
  inputEl.parentNode.replaceChild(newEl, inputEl);

  newEl.focus();
  newEl.addEventListener('input', e => {
    const inputVal = e.target.value.trim().toLowerCase();
    const targetHanziSimp = w.simplified;
    const targetHanziTrad = w.traditional;

    // Chuẩn hóa pinyin: bỏ dấu cách, bỏ dấu ngoặc, chuyển về chữ thường
    const targetPyRaw = w.pinyin.toLowerCase().replace(/[^a-z0-9]/g, ''); // Ví dụ: yi1sheng1
    const targetPyNoTones = w.pinyin.toLowerCase().replace(/[^a-z]/g, ''); // Ví dụ: yisheng

    const inputNormalized = inputVal.replace(/\s/g, '');

    if (e.target.value === targetHanziSimp ||
      e.target.value === targetHanziTrad ||
      inputNormalized === targetPyRaw ||
      inputNormalized === targetPyNoTones) {

      // Tự động chuyển đổi text trong ô nhập sang chữ Hán để "wow" người dùng
      e.target.value = targetHanziSimp;

      e.target.style.borderColor = 'var(--green)';
      e.target.style.backgroundColor = '#e6fffa';
      t.right++;
      setTimeout(() => {
        e.target.style.backgroundColor = '';
        t.cur++;
        renderType();
      }, 350);
    }
  });
}

function showTypeResult() {
  const t = S.type;
  document.getElementById('type-play').classList.add('hidden');
  document.getElementById('type-result').classList.remove('hidden');
  document.getElementById('type-detail').textContent = `Hoàn thành: ${t.right}/${t.total} từ.`;
}

function endType() {
  const t = S.type;
  t.total = t.cur;
  showTypeResult();
}

// ── TYPING SENTENCES ──
function normalizePinyin(text) {
  return (text || '').toLowerCase().replace(/[0-9\s\-]/g, '').replace(/Ă¼/g, 'v').replace(/ü/g, 'v');
}

function normalizeChinese(text) {
  return (text || '').replace(/[\s，。！？,.!?]/g, '');
}

function cleanChineseText(text) {
  return (text || '').replace(/[\s，。！？,.!?]/g, '');
}

function getSentencePreview(sent, rawInput) {
  const converted = convertCompletedSentenceInput(sent, rawInput, true);
  const chinese = cleanChineseText(converted);
  if (chinese) return chinese;

  const inputParts = rawInput.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!inputParts.length) return '';

  const targetParts = sent.pinyin.toLowerCase().split(/\s+/).filter(Boolean);
  const chars = Array.from(sent.zh).filter(ch => /[\u3400-\u9FBF]/.test(ch));
  const preview = [];

  inputParts.forEach((part, idx) => {
    const target = targetParts[idx];
    const char = chars[idx];
    if (!target || !char) return;

    const partNoTone = part.replace(/[0-9]/g, '');
    const targetNoTone = target.replace(/[0-9]/g, '');
    if (target.startsWith(part) || targetNoTone.startsWith(partNoTone)) {
      preview.push(char);
    }
  });

  return preview.join('');
}

function convertCompletedSentenceInput(sent, rawInput, force = false) {
  const targetParts = sent.pinyin.toLowerCase().split(/\s+/).filter(Boolean);
  const chars = Array.from(sent.zh).filter(ch => /[\u3400-\u9FBF]/.test(ch));
  const tokens = rawInput.trim().split(/\s+/).filter(Boolean);
  const converted = [];
  let charIndex = 0;

  tokens.forEach(token => {
    const hanzi = Array.from(token).filter(ch => /[\u3400-\u9FBF]/.test(ch)).join('');
    if (hanzi) {
      converted.push(hanzi);
      charIndex += hanzi.length;
      return;
    }

    const target = targetParts[charIndex];
    const char = chars[charIndex];
    if (!target || !char) {
      converted.push(token);
      return;
    }

    const tokenNorm = normalizePinyin(token);
    const targetNorm = normalizePinyin(target);
    const isComplete = token.toLowerCase() === target || tokenNorm === targetNorm;
    const isPartial = force && targetNorm.startsWith(tokenNorm);

    if (isComplete || isPartial) {
      converted.push(char);
      charIndex++;
    } else {
      converted.push(token);
    }
  });

  return converted.join(' ');
}

async function startTypingSentences() {
  const level = +document.getElementById('type-level').value;
  const count = +document.getElementById('type-count').value;
  try {
    const res = await api(`/api/sentences?level=${level}&count=${count}`);
    const all = res.sentences || [];
    if (all.length < 1) { alert('Không có câu để bắt đầu.'); return; }
    S.sentence = { qs: all, cur: 0, right: 0, total: all.length };
    document.getElementById('type-setup').classList.add('hidden');
    document.getElementById('sentence-result').classList.add('hidden');
    document.getElementById('sentence-play').classList.remove('hidden');
    renderSentence();
  } catch (e) {
    console.error(e);
    alert('Lỗi tải dữ liệu câu.');
  }
}

function renderSentence() {
  const s = S.sentence;
  if (s.cur >= s.total) { showSentenceResult(); return; }
  const sent = s.qs[s.cur];

  document.getElementById('sentence-progress').textContent = `${s.cur + 1}/${s.total}`;
  document.getElementById('sentence-right').textContent = `✓ ${s.right}`;

  document.getElementById('sentence-vi').style.visibility = 'hidden';
  document.getElementById('sentence-pinyin').textContent = sent.pinyin;
  document.getElementById('sentence-pinyin-hint').style.visibility = 'hidden';
  document.getElementById('sentence-conversion').style.display = 'none';
  document.getElementById('sentence-conversion-result').textContent = '';

  document.getElementById('sentence-zh').textContent = sent.zh;
  document.getElementById('sentence-vi').textContent = sent.vi;

  const inputEl = document.getElementById('sentence-input');
  inputEl.disabled = false;
  inputEl.value = '';
  inputEl.style.borderColor = '#ccc';
  inputEl.focus();

  // Hide feedback
  document.getElementById('sentence-feedback').style.display = 'none';

  // Create new input to wipe old event listeners
  const newEl = inputEl.cloneNode(true);
  inputEl.parentNode.replaceChild(newEl, inputEl);

  const targetSyllables = sent.pinyin.split(' ');

  newEl.focus();
  newEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      checkSentenceAnswer(sent, newEl);
    }
  });

  // Real-time pinyin to Chinese conversion and auto-completion
  // Debounced API call (350ms) + cache để tránh gọi API liên tục mỗi keystroke
  const debouncedPinyinConvert = debounce(async (pinyinText) => {
    if (!pinyinText || /[\u3400-\u9FBF]/.test(pinyinText)) return;
    const display = document.getElementById('sentence-conversion');
    const result = document.getElementById('sentence-conversion-result');
    try {
      const cacheKey = `/api/pinyin-to-chinese?pinyin=${encodeURIComponent(pinyinText)}`;
      const data = await apiCached(cacheKey, 300000); // cache 5 phút
      if (data.output && /[\u3400-\u9FBF]/.test(data.output)) {
        newEl.dataset.converted = data.output;
        result.textContent = data.output;
        display.style.display = 'block';
      } else {
        const localPreview = getSentencePreview(sent, pinyinText);
        if (!localPreview) display.style.display = 'none';
      }
    } catch (e) {
      console.error('Conversion error:', e);
    }
  }, 350);

  newEl.addEventListener('input', () => {
    const current = newEl.value;
    if (current.endsWith(' ')) {
      const convertedInput = convertCompletedSentenceInput(sent, current);
      if (convertedInput !== current.trim()) {
        const convertedChinese = cleanChineseText(convertedInput);
        const targetChinese = cleanChineseText(sent.zh);
        newEl.value = convertedChinese === targetChinese ? sent.zh : `${convertedInput} `;
      }
    }

    const pinyinText = newEl.value.trim();
    const display = document.getElementById('sentence-conversion');
    const result = document.getElementById('sentence-conversion-result');
    if (!pinyinText) {
      newEl.dataset.converted = '';
      result.textContent = '';
      display.style.display = 'none';
      return;
    }

    // Ưu tiên local preview trước (không tốn API)
    const localPreview = getSentencePreview(sent, pinyinText);
    if (localPreview) {
      newEl.dataset.converted = localPreview;
      result.textContent = localPreview;
      display.style.display = 'block';
    }

    const typedChinese = cleanChineseText(pinyinText);
    if (normalizePinyin(pinyinText) === normalizePinyin(sent.pinyin) || typedChinese === cleanChineseText(sent.zh)) {
      newEl.value = sent.zh;
      newEl.dataset.converted = sent.zh;
      result.textContent = sent.zh;
      display.style.display = 'block';
      return;
    }

    // Chỉ gọi API nếu local preview không đủ (có debounce + cache)
    if (!localPreview && !/[\u3400-\u9FBF]/.test(pinyinText)) {
      debouncedPinyinConvert(pinyinText);
    }
  });
}

function checkSentenceAnswer(sent, inputEl) {
  const input = inputEl.value.trim().toLowerCase();
  const target = sent.pinyin.toLowerCase();

  // Normalize: remove spaces, dashes, and tone numbers for comparison
  const normalize = (text) => text.replace(/[0-9\s\-]/g, '').replace(/ü/g, 'v');

  const inputNorm = normalize(input);
  const targetNorm = normalize(target);

  // Also check the original with spaces
  const inputSpaces = input.replace(/\s+/g, ' ').trim();
  const targetSpaces = target.replace(/\s+/g, ' ').trim();
  const converted = inputEl.dataset.converted || '';

  const isCorrect = inputNorm === targetNorm
    || inputSpaces === targetSpaces
    || cleanChineseText(input) === cleanChineseText(sent.zh)
    || cleanChineseText(converted) === cleanChineseText(sent.zh);

  const fb = document.getElementById('sentence-feedback');
  const fbText = document.getElementById('sentence-fb-text');

  if (isCorrect) {
    const display = document.getElementById('sentence-conversion');
    const result = document.getElementById('sentence-conversion-result');
    inputEl.value = sent.zh;
    inputEl.dataset.converted = sent.zh;
    result.textContent = sent.zh;
    display.style.display = 'block';
    inputEl.style.borderColor = 'var(--green)';
    inputEl.style.backgroundColor = '#e6fffa';
    fbText.innerHTML = `<strong style="color: var(--green)">✓ Chính xác!</strong>`;
    S.sentence.right++;
  } else {
    inputEl.style.borderColor = 'var(--red)';
    inputEl.style.backgroundColor = '#ffe6e6';
    fbText.innerHTML = `<strong style="color: var(--red)">✗ Sai rồi!</strong><br/>Đáp án: <code style="background: #f0f0f0; padding: 4px 8px; border-radius: 4px;">${sent.pinyin}</code>`;
  }

  fb.style.display = 'block';
  inputEl.disabled = true;
}

function showSentenceResult() {
  const s = S.sentence;
  document.getElementById('sentence-play').classList.add('hidden');
  document.getElementById('sentence-result').classList.remove('hidden');
  document.getElementById('sentence-detail').textContent = `Hoàn thành: ${s.right}/${s.total} câu.`;
}

function endSentence() {
  const s = S.sentence;
  s.total = s.cur;
  showSentenceResult();
}

// ── TYPE MODE SWITCHING ──
function updateTypeSetupUI() {
  const mode = S.typeMode;
  const label = document.getElementById('type-count-label');

  if (mode === 'word') {
    label.innerHTML = `Số từ luyện gõ
      <select id="type-count" class="sel">
        <option value="10">10 từ</option>
        <option value="20">20 từ</option>
        <option value="50">50 từ</option>
      </select>
    `;
  } else {
    label.innerHTML = `Số câu luyện gõ
      <select id="type-count" class="sel">
        <option value="5">5 câu</option>
        <option value="10">10 câu</option>
        <option value="15">15 câu</option>
      </select>
    `;
  }
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  // Initialize auth manager and update UI
  if (typeof authManager !== 'undefined') {
    authManager.updateAuthUI();
  }

  // tabs
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', e => {
    e.preventDefault();
    showView(t.dataset.view);
  }));

  document.getElementById('logo-home')?.addEventListener('click', e => { e.preventDefault(); showView('home'); });
  document.getElementById('btn-go')?.addEventListener('click', () => { S.level = 1; openLearn(1, 0); });

  // back buttons
  document.getElementById('learn-back')?.addEventListener('click', () => showView('home'));
  document.getElementById('fc-back')?.addEventListener('click', () => showView('home'));
  document.getElementById('quiz-back')?.addEventListener('click', () => { resetQuizUI(); showView('home'); });
  document.getElementById('auth-back')?.addEventListener('click', () => showView('home'));
  document.getElementById('admin-back')?.addEventListener('click', () => showView('home'));
  document.getElementById('saved-back')?.addEventListener('click', () => showView('home'));
  document.getElementById('type-back')?.addEventListener('click', () => {
    // Reset typing state
    S.type = { qs: [], cur: 0, right: 0, total: 10 };
    S.sentence = { qs: [], cur: 0, right: 0, total: 10 };
    // Hide play and result views
    document.getElementById('type-play').classList.add('hidden');
    document.getElementById('sentence-play').classList.add('hidden');
    document.getElementById('type-result').classList.add('hidden');
    document.getElementById('sentence-result').classList.add('hidden');
    // Show setup
    document.getElementById('type-setup').classList.remove('hidden');
    // Reset to word mode
    S.typeMode = 'word';
    document.querySelectorAll('.type-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.mode === 'word');
      t.style.color = t.dataset.mode === 'word' ? 'var(--primary)' : '#999';
      t.style.borderBottomColor = t.dataset.mode === 'word' ? 'var(--primary)' : 'transparent';
    });
    updateTypeSetupUI();
  });

  document.getElementById('btn-type-hint')?.addEventListener('click', () => {
    document.getElementById('type-pinyin').style.visibility = 'visible';
    document.getElementById('type-vi').style.visibility = 'visible';
  });

  // updates
  document.getElementById('btn-update-learn')?.addEventListener('click', handleUpdateHSK);
  document.getElementById('learn-level')?.addEventListener('change', e => openLearn(+e.target.value, 0));
  document.getElementById('review-back')?.addEventListener('click', () => showView('home'));
  document.getElementById('review-level')?.addEventListener('change', e => loadReviewQueue(+e.target.value));

  // SRS Review actions
  document.getElementById('review-show-answer')?.addEventListener('click', revealReviewAnswer);
  document.getElementById('review-btn-correct')?.addEventListener('click', () => submitReviewAnswer(true));
  document.getElementById('review-btn-wrong')?.addEventListener('click', () => submitReviewAnswer(false));

  document.getElementById('auth-submit')?.addEventListener('click', () => authManager.submitAuth());
  document.getElementById('auth-register')?.addEventListener('click', () => authManager.submitRegister());
  document.getElementById('auth-logout')?.addEventListener('click', () => authManager.logout());
  document.getElementById('auth-password')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') authManager.submitAuth();
  });
  document.getElementById('auth-reg-password-confirm')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') authManager.submitRegister();
  });

  document.getElementById('toggle-password')?.addEventListener('click', function() {
    const passInput = document.getElementById('auth-password');
    if (!passInput) return;
    const isPass = passInput.type === 'password';
    passInput.type = isPass ? 'text' : 'password';
    this.textContent = isPass ? '🙈' : '👁️';
  });

  document.getElementById('toggle-password-reg')?.addEventListener('click', function() {
    const passInput = document.getElementById('auth-reg-password');
    if (!passInput) return;
    const isPass = passInput.type === 'password';
    passInput.type = isPass ? 'text' : 'password';
    this.textContent = isPass ? '🙈' : '👁️';
  });

  document.getElementById('toggle-password-confirm')?.addEventListener('click', function() {
    const passInput = document.getElementById('auth-reg-password-confirm');
    if (!passInput) return;
    const isPass = passInput.type === 'password';
    passInput.type = isPass ? 'text' : 'password';
    this.textContent = isPass ? '🙈' : '👁️';
  });

  // Auth mode switching
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      authManager.switchAuthMode(tab.dataset.mode);
    });
  });

  // search
  document.getElementById('search-input')?.addEventListener('input', e => {
    doSearch(e.target.value);
  });

  // modal & writer
  document.getElementById('modal-x')?.addEventListener('click', closeModal);
  document.getElementById('modal')?.addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // auth modal
  document.getElementById('auth-back')?.addEventListener('click', closeAuth);
  document.getElementById('view-auth')?.addEventListener('click', e => { if (e.target.id === 'view-auth') closeAuth(); });
  document.getElementById('pronounce-back')?.addEventListener('click', () => showView('home'));
  document.getElementById('match-back')?.addEventListener('click', () => {
    const playArea = document.getElementById('match-play');
    const resultArea = document.getElementById('match-result');
    const setupArea = document.getElementById('match-setup');
    
    if (!playArea.classList.contains('hidden') || !resultArea.classList.contains('hidden')) {
      // Nếu đang chơi hoặc đang xem kết quả, quay về màn hình setup của game
      playArea.classList.add('hidden');
      resultArea.classList.add('hidden');
      setupArea.classList.remove('hidden');
      if (S.match.timer) {
        clearInterval(S.match.timer);
        S.match.timer = null;
      }
    } else {
      // Nếu đang ở màn hình setup, quay về trang chủ
      showView('home');
    }
  });

  document.getElementById('listen-back')?.addEventListener('click', () => {
    const playVisible = !document.getElementById('listen-play')?.classList.contains('hidden');
    const resultVisible = !document.getElementById('listen-result')?.classList.contains('hidden');
    if (playVisible || resultVisible) {
      resetListenToSetup();
    } else {
      showView('home');
    }
  });
  document.getElementById('pronounce-level')?.addEventListener('change', e => loadPronounceLevel(+e.target.value));
  document.getElementById('pronounce-sample')?.addEventListener('click', playPronounceSample);
  document.getElementById('pronounce-start-record')?.addEventListener('click', startPronounceRecording);
  document.getElementById('pronounce-stop-record')?.addEventListener('click', () => stopPronunciationSession('Đã dừng ghi âm.'));
  document.getElementById('pronounce-retry-record')?.addEventListener('click', retryPronounceRecording);

  document.getElementById('btn-draw')?.addEventListener('click', async () => {
    if (writers && writers.length > 0) {
      for (const wr of writers) {
        await wr.animateCharacter();
      }
    }
  });
  document.getElementById('btn-practice')?.addEventListener('click', () => {
    if (writers && writers.length > 0) {
      writers.forEach(wr => wr.quiz());
    }
  });
  document.getElementById('btn-save-word')?.addEventListener('click', async () => {
    if (!currentWord) return;
    if (!authManager.user) {
      showView('auth');
      return;
    }
    try {
      const hskLevel = currentWord.hsk || 0;
      const res = await api('/api/saved_words', {
        method: 'POST',
        body: JSON.stringify({
          word: currentWord.simplified,
          pinyin: currentWord.pinyin,
          meaning: currentWord.vietnamese || (currentWord.english || []).join(', '),
          hsk_level: hskLevel
        })
      });
      if (res.status === 'success' && S.view === 'saved') {
        await openSavedWords();
      }
    } catch (e) {
      console.error(e);
    }
  });

  // flashcard
  document.getElementById('card')?.addEventListener('click', flipFC);
  document.getElementById('fc-next')?.addEventListener('click', () => nextFC(1));
  document.getElementById('fc-prev')?.addEventListener('click', () => nextFC(-1));
  document.getElementById('fc-shuffle')?.addEventListener('click', shuffleFC);
  document.getElementById('fc-easy')?.addEventListener('click', async () => {
    const w = S.fcDeck[S.fcIdx];
    if (w) { 
      toggleLearned(w.simplified); 
      // Lưu trạng thái đúng vào SRS
      try {
        await api('/api/progress', {
          method: 'POST',
          body: JSON.stringify({ word: w.simplified, hsk_level: w.hsk || 0, is_correct: true })
        });
      } catch(e) {}
    }
    nextFC(1);
  });
  document.getElementById('fc-hard')?.addEventListener('click', async () => {
    const w = S.fcDeck[S.fcIdx];
    if (w) {
      // Lưu trạng thái sai vào SRS
      try {
        await api('/api/progress', {
          method: 'POST',
          body: JSON.stringify({ word: w.simplified, hsk_level: w.hsk || 0, is_correct: false })
        });
      } catch(e) {}
    }
    nextFC(1);
  });
  document.getElementById('fc-level')?.addEventListener('change', e => initFC(+e.target.value));
  document.getElementById('fc-mode')?.addEventListener('change', () => initFC(+document.getElementById('fc-level').value));

  // keyboard
  document.addEventListener('keydown', e => {
    if (S.view === 'flashcard') {
      if (e.key === 'ArrowRight') nextFC(1);
      if (e.key === 'ArrowLeft') nextFC(-1);
      if (e.key === ' ') { e.preventDefault(); flipFC(); }
    }
    if (S.view === 'type') {
      if (e.key.toLowerCase() === 'h') {
        document.getElementById('type-pinyin').style.visibility = 'visible';
        document.getElementById('type-vi').style.visibility = 'visible';
      }
    }
  });

  // quiz
  document.getElementById('quiz-start')?.addEventListener('click', startQuiz);
  document.getElementById('q-next')?.addEventListener('click', () => { stopQuizTimer(); S.quiz.cur++; renderQ(); });
  document.getElementById('quiz-end')?.addEventListener('click', endQuiz);
  document.getElementById('qr-again')?.addEventListener('click', () => {
    document.getElementById('quiz-result').classList.add('hidden');
    document.getElementById('quiz-setup').classList.remove('hidden');
  });

  // match game
  document.getElementById('match-start')?.addEventListener('click', startMatchGame);
  document.getElementById('match-end')?.addEventListener('click', endMatchGame);
  document.getElementById('match-again')?.addEventListener('click', () => {
    // Restart game immediately
    startMatchGame();
  });
  document.getElementById('match-exit')?.addEventListener('click', () => {
    document.getElementById('match-result').classList.add('hidden');
    document.getElementById('match-setup').classList.remove('hidden');
  });
  document.getElementById('match-cancel')?.addEventListener('click', () => {
    if (S.match.timer) clearInterval(S.match.timer);
    document.getElementById('match-play').classList.add('hidden');
    document.getElementById('match-setup').classList.remove('hidden');
  });




  // listen game
  document.getElementById('listen-start')?.addEventListener('click', startListenGame);
  document.getElementById('listen-play-audio')?.addEventListener('click', playListenAudio);
  document.getElementById('listen-end')?.addEventListener('click', endListenGame);
  document.getElementById('listen-setup')?.addEventListener('click', resetListenToSetup);
  document.getElementById('listen-result-setup')?.addEventListener('click', resetListenToSetup);
  document.getElementById('listen-again')?.addEventListener('click', resetListenToSetup);

  // typing
  document.getElementById('type-start')?.addEventListener('click', () => {
    if (S.typeMode === 'word') {
      startTyping();
    } else {
      startTypingSentences();
    }
  });
  document.getElementById('type-again')?.addEventListener('click', () => {
    document.getElementById('type-result').classList.add('hidden');
    document.getElementById('type-setup').classList.remove('hidden');
  });
  document.getElementById('sentence-again')?.addEventListener('click', () => {
    document.getElementById('sentence-result').classList.add('hidden');
    document.getElementById('type-setup').classList.remove('hidden');
  });

  document.getElementById('btn-type-end')?.addEventListener('click', endType);
  document.getElementById('btn-sentence-end')?.addEventListener('click', endSentence);

  // type mode tabs
  document.querySelectorAll('.type-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const newMode = tab.dataset.mode;
      const wasPlaying = !document.getElementById('type-play').classList.contains('hidden') || !document.getElementById('sentence-play').classList.contains('hidden');

      S.typeMode = newMode;
      document.querySelectorAll('.type-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Update tab styling
      document.querySelectorAll('.type-tab').forEach(t => {
        if (t.dataset.mode === S.typeMode) {
          t.style.color = 'var(--primary)';
          t.style.borderBottomColor = 'var(--primary)';
        } else {
          t.style.color = '#999';
          t.style.borderBottomColor = 'transparent';
        }
      });

      if (wasPlaying) {
        // Switch mode while playing
        if (newMode === 'word') {
          document.getElementById('sentence-play').classList.add('hidden');
          document.getElementById('type-play').classList.remove('hidden');
          startTyping();
        } else {
          document.getElementById('type-play').classList.add('hidden');
          document.getElementById('sentence-play').classList.remove('hidden');
          startTypingSentences();
        }
      } else {
        // Update setup UI
        updateTypeSetupUI();
      }
    });
  });

  // hint buttons
  document.getElementById('btn-type-hint')?.addEventListener('click', () => {
    document.getElementById('type-pinyin').style.visibility = 'visible';
    document.getElementById('type-vi').style.visibility = 'visible';
  });

  document.getElementById('btn-sentence-hint')?.addEventListener('click', () => {
    const el = document.getElementById('sentence-vi');
    el.style.visibility = el.style.visibility === 'visible' ? 'hidden' : 'visible';
  });

  document.getElementById('btn-sentence-pinyin-hint')?.addEventListener('click', () => {
    const el = document.getElementById('sentence-pinyin-hint');
    el.style.visibility = el.style.visibility === 'visible' ? 'hidden' : 'visible';
  });

  document.getElementById('btn-sentence-next')?.addEventListener('click', () => {
    S.sentence.cur++;
    renderSentence();
  });

  // ── NAVIGATION (tab listeners đã được gán ở đầu DOMContentLoaded, không cần lặp lại) ──

  // (review listeners đã được đăng ký ở trên)

  // boot
  authManager.updateAuthUI();
  
  // Thêm option "Câu của tôi" vào selector nếu chưa có
  const pLevel = document.getElementById('pronounce-level');
  if (pLevel && !pLevel.querySelector('option[value="0"]')) {
    pLevel.insertAdjacentHTML('afterbegin', '<option value="0">⭐ Câu của tôi</option>');
  }

  if (window.location.pathname === '/admin1811') {
    authManager.showAdminEntry();
  } else {
    showView('home');
    renderHome();
  }
});

// ── MATCH GAME ──
function initMatchGame() {
  // This will be called when the page loads
}

async function startMatchGame() {
  const level = +document.getElementById('match-level').value;
  const mode = document.querySelector('input[name="match-mode"]:checked').value;
  const source = document.getElementById('match-source').value;
  
  try {
    let words = [];
    if (source === 'saved') {
      const res = await api('/api/saved_words');
      // Normalize saved word format to match HSK word format
      words = res.map(w => ({ 
        simplified: w.word, 
        pinyin: w.pinyin, 
        vietnamese: w.meaning,
        hsk: w.hsk_level 
      }));
    } else {
      // Use random endpoint for diversity
      words = await api(`/api/random?level=${level}&count=40`);
    }
    
    if (!words || words.length < 6) {
      alert(source === 'saved' ? 'Bạn cần lưu ít nhất 6 từ để chơi chế độ này.' : 'Không đủ dữ liệu từ vựng.');
      return;
    }
    
    // Create pairs (6 pairs = 12 items) - ensure unique words
    const uniqueWords = [];
    const seen = new Set();
    for (const word of words) {
      if (!seen.has(word.simplified) && uniqueWords.length < 6) {
        uniqueWords.push(word);
        seen.add(word.simplified);
      }
    }
    
    if (uniqueWords.length < 6) {
      alert('Không đủ từ duy nhất để chơi game ghép.');
      return;
    }

    // Reset game state
    S.match = {
      level: level,
      mode: mode,
      pairs: [],
      score: 0,
      combo: 0,
      timeLeft: 60,
      timer: null,
      matched: new Set(),
      selectedHanzi: null,
      totalPairs: 6,
      currentProgress: 0,
      originalWords: uniqueWords // Store original words for wrong words display
    };
    
    const selectedWords = uniqueWords;
    const pairs = [];
    
    selectedWords.forEach(word => {
      pairs.push({
        id: word.simplified,
        type: 'hanzi',
        content: word.simplified,
        matchId: word.simplified
      });
      pairs.push({
        id: word.simplified + '_target',
        type: 'target',
        content: mode === 'meaning' ? word.vietnamese : word.pinyin,
        matchId: word.simplified
      });
    });
    
    // Shuffle pairs
    S.match.pairs = pairs.sort(() => Math.random() - 0.5);
    
    // Hide setup, show game
    document.getElementById('match-setup').classList.add('hidden');

    document.getElementById('match-result').classList.add('hidden');
    document.getElementById('match-play').classList.remove('hidden');
    
    // Update UI
    const targetLabel = document.getElementById('match-target-label');
    const scoreEl = document.getElementById('match-score');
    const comboEl = document.getElementById('match-combo');
    const progressEl = document.getElementById('match-progress');
    const timerEl = document.getElementById('match-timer');
    
    if (targetLabel) targetLabel.textContent = mode === 'meaning' ? 'Nghĩa' : 'Pinyin';
    if (scoreEl) scoreEl.textContent = '0';
    if (comboEl) comboEl.textContent = '🔥 0';
    if (progressEl) progressEl.textContent = '0 / 6';
    if (timerEl) timerEl.textContent = '60s';
    
    renderMatchGame();
    startMatchTimer();
    
  } catch (e) {
    alert('Lỗi tải dữ liệu game: ' + e.message);
  }
}

function renderMatchGame() {
  const leftCol = document.getElementById('match-left');
  const rightCol = document.getElementById('match-right');
  
  if (!leftCol || !rightCol) {
    console.error('Match game columns not found');
    return;
  }
  
  // Clear columns and add headers
  leftCol.innerHTML = '<h3 style="text-align:center; margin-bottom:15px; color:#374151;">📝 Chữ Hán</h3>';
  rightCol.innerHTML = `<h3 style="text-align:center; margin-bottom:15px; color:#374151;">🎯 ${S.match.mode === 'meaning' ? 'Nghĩa' : 'Pinyin'}</h3>`;
  
  // Separate hanzi and targets from remaining pairs
  const hanziItems = S.match.pairs.filter(p => p.type === 'hanzi');
  const targetItems = S.match.pairs.filter(p => p.type === 'target');
  
  // Shuffle for display
  const shuffledHanzi = hanziItems.sort(() => Math.random() - 0.5);
  const shuffledTargets = targetItems.sort(() => Math.random() - 0.5);
  
  // Add clickable hanzi items
  shuffledHanzi.forEach(item => {
    const div = document.createElement('div');
    div.className = 'match-item match-hanzi';
    div.dataset.id = item.id;
    div.dataset.matchId = item.matchId;
    div.innerHTML = `<div style="font-size:1.5rem; font-weight:bold; color:var(--zh-color);">${item.content}</div>`;
    div.addEventListener('click', () => selectHanziItem(div, item));
    leftCol.appendChild(div);
  });
  
  // Add clickable target items
  shuffledTargets.forEach(item => {
    const div = document.createElement('div');
    div.className = 'match-item match-target';
    div.dataset.id = item.id;
    div.dataset.matchId = item.matchId;
    div.innerHTML = `<div style="font-size:1.2rem; color:#374151;">${item.content}</div>`;
    div.addEventListener('click', () => selectTargetItem(div, item));
    rightCol.appendChild(div);
  });
}

let draggedElement = null;

function selectHanziItem(element, item) {
  // Clear previous selection
  document.querySelectorAll('.match-hanzi.selected').forEach(el => {
    el.classList.remove('selected');
  });
  
  // Select this item
  element.classList.add('selected');
  S.match.selectedHanzi = item;
}

function selectTargetItem(element, item) {
  if (!S.match.selectedHanzi) {
    // Show hint that user needs to select hanzi first
    element.style.animation = 'shake 0.3s ease';
    setTimeout(() => element.style.animation = '', 300);
    return;
  }
  
  const hanziItem = S.match.selectedHanzi;
  const isCorrect = hanziItem.matchId === item.matchId;
  
  // Clear selection
  document.querySelectorAll('.match-hanzi.selected').forEach(el => {
    el.classList.remove('selected');
  });
  
  if (isCorrect) {
    // Correct match
    S.match.score += 10 + (S.match.combo * 5);
    S.match.combo += 1;
    S.match.matched.add(hanziItem.matchId);
    S.match.currentProgress++;
    
    // Update SRS progress
    updateWordProgress(hanziItem.matchId, S.match.level, true);
    
    // Update UI
    const scorePercent = Math.round((S.match.matched.size / S.match.totalPairs) * 100);
    document.getElementById('match-score').textContent = `${scorePercent}%`;
    document.getElementById('match-combo').textContent = `🔥 ${S.match.combo}`;
    document.getElementById('match-progress').textContent = `${S.match.currentProgress} / ${S.match.totalPairs}`;

    
    // Visual feedback
    const hanziElement = document.querySelector(`[data-match-id="${hanziItem.matchId}"].match-hanzi`);
    const targetElement = element;
    
    hanziElement.classList.add('correct');
    targetElement.classList.add('correct');
    
    setTimeout(() => {
      hanziElement.classList.add('fade-out');
      targetElement.classList.add('fade-out');
      
      // Remove matched items from pairs array
      S.match.pairs = S.match.pairs.filter(p => p.matchId !== hanziItem.matchId);
      
      // Check if round is complete
      if (S.match.currentProgress >= S.match.totalPairs) {
        // Start next round or end game
        setTimeout(() => nextMatchRound(), 1000);
      } else {
        // Re-render remaining items
        setTimeout(renderMatchGame, 600);
      }
    }, 600);
    
  } else {
    // Wrong match
    S.match.combo = 0;
    document.getElementById('match-combo').textContent = '🔥 0';
    
    // Update SRS progress for wrong answer
    updateWordProgress(hanziItem.matchId, S.match.level, false);
    
    // Visual feedback
    const hanziElement = document.querySelector(`[data-match-id="${hanziItem.matchId}"].match-hanzi`);
    hanziElement.classList.add('incorrect');
    element.classList.add('incorrect');
    
    setTimeout(() => {
      hanziElement.classList.remove('incorrect');
      element.classList.remove('incorrect');
    }, 500);
  }
  
  S.match.selectedHanzi = null;
}

function nextMatchRound() {
  S.match.currentProgress = 0;
  // For now, just end the game. Could add more rounds later
  endMatchGame();
}

function startMatchTimer() {
  S.match.timer = setInterval(() => {
    S.match.timeLeft--;
    const timerElement = document.getElementById('match-timer');
    if (timerElement) {
      timerElement.textContent = `${S.match.timeLeft}s`;
      
      // Change color when time is low
      if (S.match.timeLeft <= 10) {
        timerElement.style.color = 'var(--error)';
        timerElement.style.fontWeight = 'bold';
      } else {
        timerElement.style.color = 'var(--text)';
        timerElement.style.fontWeight = 'normal';
      }
    }
    
    if (S.match.timeLeft <= 0) {
      endMatchGame();
    }
  }, 1000);
}

function endMatchGame() {
  if (S.match.timer) {
    clearInterval(S.match.timer);
    S.match.timer = null;
  }
  
  document.getElementById('match-play').classList.add('hidden');
  document.getElementById('match-result').classList.remove('hidden');
  
  // Calculate score 0-100
  const scorePercent = Math.round((S.match.matched.size / S.match.totalPairs) * 100);
  
  document.getElementById('match-final-score').textContent = `${scorePercent}%`;
  document.getElementById('match-detail').textContent = `Ghép đúng: ${S.match.matched.size}/${S.match.totalPairs} | Combo cao nhất: ${S.match.combo} | Thời gian còn lại: ${S.match.timeLeft}s`;

  
  // Show wrong words for review
  const wrongWords = S.match.originalWords.filter(word => !S.match.matched.has(word.simplified));
  if (wrongWords.length > 0) {
    const wrongWordsHtml = wrongWords.map(word => 
      `<div class="wrong-word-item">
        <span class="wrong-hanzi">${word.simplified}</span> → <span class="wrong-meaning">${S.match.mode === 'meaning' ? word.vietnamese : word.pinyin}</span>
        <button onclick="reviewWord('${word.simplified}')" class="review-btn">🔄 Ôn lại</button>
      </div>`
    ).join('');
    
    document.getElementById('match-wrong-words').innerHTML = `
      <h4>📚 Từ cần ôn lại:</h4>
      ${wrongWordsHtml}
    `;
    document.getElementById('match-wrong-words').classList.remove('hidden');
  } else {
    document.getElementById('match-wrong-words').classList.add('hidden');
  }
}

// ── LISTEN GAME ──
async function startListenGame() {
  const level = +document.getElementById('listen-level').value;
  const source = document.getElementById('listen-source').value;
  
  try {
    let words = [];
    if (source === 'saved') {
      const res = await api('/api/saved_words');
      words = res.map(w => ({ 
        simplified: w.word, 
        pinyin: w.pinyin, 
        vietnamese: w.meaning,
        hsk: w.hsk_level 
      }));
      // Shuffle saved words for randomness
      words = words.sort(() => Math.random() - 0.5);
    } else {
      // Get diverse random words from HSK level
      words = await api(`/api/random?level=${level}&count=30`);
    }
    
    if (!words || words.length < 4) {
      alert(source === 'saved' ? 'Bạn cần lưu ít nhất 4 từ để chơi chế độ này.' : 'Không đủ dữ liệu.');
      return;
    }
    
    // Reset game state
    const shuffledPool = words.sort(() => Math.random() - 0.5);
    S.listen = {
      level: level,
      pool: shuffledPool, // Lưu toàn bộ kho từ để lấy đáp án sai phong phú hơn
      qs: shuffledPool.slice(0, Math.min(10, shuffledPool.length)), // 10 câu hỏi
      cur: 0,
      right: 0,
      wrong: 0,
      total: Math.min(10, shuffledPool.length),
      timer: null,
      timeLeft: 10,
      currentAudio: null
    };
    
    // Hide setup, show game
    document.querySelector('#view-listen .quiz-setup').classList.add('hidden');
    document.getElementById('listen-result').classList.add('hidden');
    document.getElementById('listen-play').classList.remove('hidden');
    
    renderListenQuestion();
    
  } catch (e) {
    alert('Lỗi tải dữ liệu game: ' + e.message);
  }
}

function renderListenQuestion() {
  const q = S.listen.qs[S.listen.cur];
  if (!q) return;
  
  // Reset timer
  S.listen.timeLeft = 10;
  document.getElementById('listen-timer').textContent = '10';
  
  // Clear previous timer
  if (S.listen.timer) {
    clearInterval(S.listen.timer);
  }
  
  // Start countdown
  S.listen.timer = setInterval(() => {
    S.listen.timeLeft--;
    document.getElementById('listen-timer').textContent = S.listen.timeLeft;
    
    if (S.listen.timeLeft <= 0) {
      // Time's up - count as wrong
      S.listen.wrong++;
      nextListenQuestion();
    }
  }, 1000);
  
  // Generate options (1 correct + 3 wrong)
  const correctOption = q;
  // Lấy 3 đáp án sai từ toàn bộ pool (kho 30-40 từ) thay vì chỉ trong 10 câu hỏi
  const wrongOptions = S.listen.pool
    .filter(w => w.simplified !== q.simplified)
    .sort(() => Math.random() - 0.5)
    .slice(0, 3);
    
  const options = [correctOption, ...wrongOptions].sort(() => Math.random() - 0.5);
  
  const optionsContainer = document.getElementById('listen-options');
  optionsContainer.innerHTML = '';
  
  options.forEach((option, index) => {
    const button = document.createElement('button');
    button.className = 'listen-option btn-main';
    button.dataset.correct = option.simplified === q.simplified;
    button.innerHTML = `
      <div style="font-size:1.2rem; font-weight:bold; color:var(--zh-color); margin-bottom:5px;">${option.simplified}</div>
      <div style="font-size:0.9rem; color:#64748b;">${option.pinyin}</div>
      <div style="font-size:0.9rem; color:#374151;">${option.vietnamese}</div>
    `;
    button.addEventListener('click', () => selectListenOption(button, option.simplified === q.simplified));
    optionsContainer.appendChild(button);
  });
  
  // Store current question for audio
  S.listen.currentAudio = q;
}

function playListenAudio() {
  if (S.listen.currentAudio) {
    playAudio(S.listen.currentAudio.simplified);
  }
}

function resetListenToSetup() {
  if (S.listen.timer) {
    clearInterval(S.listen.timer);
    S.listen.timer = null;
  }
  document.getElementById('listen-result').classList.add('hidden');
  document.getElementById('listen-play').classList.add('hidden');
  document.querySelector('#view-listen .quiz-setup')?.classList.remove('hidden');
}

function selectListenOption(button, isCorrect) {
  // Clear timer
  if (S.listen.timer) {
    clearInterval(S.listen.timer);
    S.listen.timer = null;
  }
  
  // Disable all options and show correct/incorrect colors
  document.querySelectorAll('.listen-option').forEach(btn => {
    btn.disabled = true;
    const isThisCorrect = btn.dataset.correct === 'true';
    
    if (isThisCorrect) {
      // Đáp án đúng luôn hiện xanh
      btn.style.background = 'var(--success)';
      btn.style.border = '2px solid var(--green)';
    } else if (btn === button && !isCorrect) {
      // Đáp án sai được chọn hiện đỏ
      btn.style.background = 'var(--error)';
      btn.style.border = '2px solid var(--red)';
    }
  });
  
  // Update score
  if (isCorrect) {
    S.listen.right++;
    // Update SRS progress
    updateWordProgress(S.listen.currentAudio.simplified, S.listen.level, true);
  } else {
    S.listen.wrong++;
    // Update SRS progress
    updateWordProgress(S.listen.currentAudio.simplified, S.listen.level, false);
  }
  
  // Wait 2 seconds then next question
  setTimeout(nextListenQuestion, 2000);
}

function nextListenQuestion() {
  S.listen.cur++;
  
  if (S.listen.cur >= S.listen.total) {
    endListenGame();
  } else {
    renderListenQuestion();
  }
}

function endListenGame() {
  if (S.listen.timer) {
    clearInterval(S.listen.timer);
    S.listen.timer = null;
  }
  
  document.getElementById('listen-play').classList.add('hidden');
  document.getElementById('listen-result').classList.remove('hidden');
  
  const score = `${S.listen.right}/${S.listen.total}`;
  document.getElementById('listen-final-score').textContent = score;
  document.getElementById('listen-detail').textContent = `Đúng: ${S.listen.right} | Sai: ${S.listen.wrong}`;
}

// ── SRS INTEGRATION ──
async function updateWordProgress(word, level, isCorrect) {
  try {
    await api('/api/progress', {
      method: 'POST',
      body: JSON.stringify({
        word: word,
        hsk_level: level,
        is_correct: isCorrect
      })
    });
  } catch (e) {
    // Silently fail if not logged in or API error
    console.log('Progress update failed:', e.message);
  }
}
const style = document.createElement('style');
style.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-5px); }
    75% { transform: translateX(5px); }
  }
  
  .match-item {
    padding: 20px;
    margin: 12px 0;
    border: 3px solid #e5e7eb;
    border-radius: 16px;
    background: white;
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: center;
    min-height: 70px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    position: relative;
    overflow: hidden;
  }
  
  .match-item:hover {
    border-color: var(--primary);
    box-shadow: 0 8px 20px rgba(0,0,0,0.12);
    transform: translateY(-2px);
  }
  
  .match-item.selected {
    border-color: var(--primary);
    background: var(--accent-light);
    box-shadow: 0 8px 25px rgba(59, 130, 246, 0.3);
  }
  
  .match-item.correct {
    border-color: var(--success);
    background: var(--green-bg);
    animation: correctPulse 0.6s ease;
  }
  
  .match-item.incorrect {
    border-color: var(--error);
    background: var(--red-bg);
    animation: shake 0.5s ease;
  }
  
  .match-item.fade-out {
    opacity: 0.3;
    pointer-events: none;
    transform: scale(0.95);
  }
  
  .match-hanzi {
    cursor: pointer;
  }
  
  .match-target {
    min-height: 70px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  @keyframes correctPulse {
    0% { transform: scale(1); }
    50% { transform: scale(1.05); }
    100% { transform: scale(1); }
  }
  
  .listen-option {
    padding: 20px;
    border-radius: 12px;
    border: none;
    background: #f8fafc;
    cursor: pointer;
    transition: all 0.2s;
    text-align: center;
  }
  
  .listen-option:hover {
    background: #e2e8f0;
  }
  
  .listen-option:disabled {
    cursor: not-allowed;
    opacity: 0.7;
  }
  
  .wrong-word-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    margin: 8px 0;
    background: var(--red-bg);
    border: 1px solid var(--error);
    border-radius: 8px;
  }
  
  .wrong-hanzi {
    font-size: 1.2rem;
    font-weight: bold;
    color: var(--zh-color);
  }
  
  .wrong-meaning {
    color: #374151;
  }
  
  .review-btn {
    background: var(--primary);
    color: white;
    border: none;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9rem;
    transition: all 0.2s;
  }
  
  .review-btn:hover {
    background: #1d4ed8;
    transform: scale(1.05);
  }
`;

function reviewWord(wordId) {
  // For now, just show a toast message. Could implement more sophisticated review later
  showToast(`Đang ôn lại từ: ${wordId}`, 'info');
  // Could add to a review queue or start a focused practice session
}

document.head.appendChild(style);
