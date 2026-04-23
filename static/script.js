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
  learned: JSON.parse(localStorage.getItem('hg_learned') || '{}'),
};
let quizTimerInt = null;
let pronounceRecognizer = null;
let pronounceCurrentSentence = null;

function loadPronounceLevel(level = 1) {
  S.pronounce.level = level;
  const list = document.getElementById('pronounce-list');
  if (!list) return;
  list.innerHTML = '<p class="muted">Đang tải câu luyện nói...</p>';
  api(`/api/pronounce/sentences?level=${level}&count=12`)
    .then(res => {
      S.pronounce.qs = res.sentences || [];
      S.pronounce.total = S.pronounce.qs.length;
      S.pronounce.cur = 0;
      if (!S.pronounce.qs.length) {
        list.innerHTML = '<p class="muted">Chưa có câu luyện nói cho level này.</p>';
        return;
      }
      list.innerHTML = S.pronounce.qs.map((s, i) => `
        <button class="pronounce-item" data-idx="${i}" style="width:100%; text-align:left; padding:16px; border:1px solid #e5e7eb; border-radius:16px; background:#fff; margin-bottom:12px; cursor:pointer; box-shadow:0 8px 20px rgba(15,23,42,.04);">
          <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
            <div style="flex:1; min-width:0;">
              <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:6px;">
                <div style="font-size:1.05rem; font-weight:800; color:var(--zh-color);">${s.zh}</div>
                <span class="pill">HSK ${s.level}</span>
              </div>
              <div class="muted" style="margin-top:4px; line-height:1.5;">${s.pinyin}</div>
              <div style="margin-top:8px; color:#334155; line-height:1.6;">${s.vi}</div>
            </div>
            <div style="font-size:1.2rem; color:#64748b;">▶</div>
          </div>
        </button>
      `).join('');
      list.querySelectorAll('.pronounce-item').forEach(btn => {
        btn.addEventListener('click', () => startSentenceAssessment(S.pronounce.qs[+btn.dataset.idx]));
      });
      if (!pronounceCurrentSentence) pronounceCurrentSentence = S.pronounce.qs[0] || null;
    })
    .catch(e => {
      list.innerHTML = `<p class="muted">Lỗi tải câu: ${e.message}</p>`;
    });
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
    
    // Logic so khớp đơn giản (Normalize trước khi so sánh)
    const target = normalizeChinese(sentence.zh);
    const spoken = normalizeChinese(result);
    
    let score = 0;
    if (spoken === target) score = 100;
    else {
      let matchCount = 0;
      const targetChars = Array.from(target);
      targetChars.forEach(c => { if(spoken.includes(c)) matchCount++; });
      score = Math.round((matchCount / targetChars.length) * 100);
    }

    document.getElementById('pronounce-score').textContent = score;
    document.getElementById('pronounce-status').textContent = `Bạn đã nói: "${result}"`;
    document.getElementById('pronounce-word-list').innerHTML = `<p class="center">${score >= 80 ? '🌟 Phát âm rất tốt!' : (score >= 50 ? '👍 Khá ổn, hãy cố gắng hơn.' : '😅 Bạn cần luyện tập thêm câu này.')}</p>`;
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
    this.user = JSON.parse(localStorage.getItem('hg_user') || 'null');
    this.authMode = 'login';
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
    const isAdminRoute = window.location.pathname === '/admin1811';
    if (authTab) {
      authTab.textContent = this.user ? this.user.username : 'Đăng nhập';
      authTab.classList.toggle('hidden', this.user && !isAdminRoute);
    }
    if (nav) nav.classList.toggle('hidden', !this.user);
    if (adminTab) adminTab.classList.add('hidden');
    if (authTab) authTab.classList.toggle('hidden', isAdminRoute);
    document.getElementById('auth-logout')?.classList.toggle('hidden', !this.user);
  }

  async submitAuth() {
    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value;
    const err = document.getElementById('auth-error');
    err.classList.add('hidden');
    err.textContent = '';

    if (!username || !password) {
      err.textContent = 'Vui lòng nhập username và password.';
      err.classList.remove('hidden');
      return;
    }

    try {
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
          if (viewName === 'saved') openSavedWords();
        }
      }
    } catch (error) {
      err.textContent = error.message;
      err.classList.remove('hidden');
    }
  }

  async submitRegister() {
    const username = document.getElementById('auth-reg-username').value.trim();
    const password = document.getElementById('auth-reg-password').value;
    const passwordConfirm = document.getElementById('auth-reg-password-confirm').value;
    const err = document.getElementById('auth-reg-error');
    err.classList.add('hidden');
    err.textContent = '';

    if (!username || !password || !passwordConfirm) {
      err.textContent = 'Vui lòng điền tất cả các trường.';
      err.classList.remove('hidden');
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
        if (viewName === 'saved') openSavedWords();
      } else {
        showView('home');
        renderHome();
      }
    } catch (error) {
      err.textContent = error.message;
      err.classList.remove('hidden');
    }
  }

  switchAuthMode(mode) {
    this.authMode = mode;
    const loginForm = document.getElementById('auth-login-form');
    const registerForm = document.getElementById('auth-register-form');
    
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
    } else {
      loginForm.classList.add('hidden');
      registerForm.classList.remove('hidden');
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

// ── Navigation ──
function showView(name) {
  if (name !== 'auth' && !authManager.user && !['home', 'search', 'pronounce'].includes(name)) {
    window.requestedView = name;
    showView('auth');
    return;
  }
  document.getElementById('view-auth')?.classList.add('hidden');
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  if (name === 'auth') {
    document.getElementById('view-auth')?.classList.remove('hidden');
    document.getElementById('nav')?.classList.add('hidden');
  } else {
    document.getElementById('view-' + name)?.classList.remove('hidden');
    document.getElementById('nav')?.classList.remove('hidden');
  }
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  S.view = name;
  window.scrollTo(0, 0);
  if (name === 'pronounce') loadPronounceLevel(S.pronounce.level || 1);
}

// ── API helpers ──
async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (authManager?.token) headers.Authorization = `Bearer ${authManager.token}`;
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const r = await fetch(API + path, { ...options, headers });
  if (!r.ok) {
    if (r.status === 401) {
      authManager?.saveSession('', null);
      showView('auth');
    }
    let errorMessage = r.statusText;
    try {
      const errorData = await r.json();
      errorMessage = errorData.detail || errorMessage;
    } catch {}
    throw new Error(errorMessage);
  }
  return r.json();
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

async function renderHome() {
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
      <div class="hsk-card" data-level="${h.level}">
        <div class="hsk-label" style="color:${h.color}">${h.name}</div>
        <div class="hsk-desc">${h.desc}</div>
        <div class="hsk-count">${info.total} từ</div>
        <div class="hsk-bar"><div class="hsk-bar-fill" style="width:0%;background:${h.color}"></div></div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.hsk-card').forEach(c => {
    c.addEventListener('click', () => { S.level = +c.dataset.level; openLearn(S.level, 0); });
  });
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
  try {
    const [users, logs] = await Promise.all([
      api('/api/admin/users'),
      api('/api/admin/logs'),
    ]);
    document.getElementById('admin-users').innerHTML = users.map(u => `
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

    document.getElementById('admin-logs').innerHTML = logs.map(l => `
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
  } catch {
    document.getElementById('admin-users').innerHTML = '<p class="muted">Khong tai duoc du lieu admin.</p>';
  }
}

/** Personal Saved Vocabulary */
async function openSavedWords() {
  showView('saved');
  const el = document.getElementById('saved-words-list');
  if (!el) return;

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
  }
}

async function openLearn(level, page) {
  showView('learn');
  S.level = level;
  S.learnPage = page;
  const offset = page * S.learnPerPage;
  const info = HSK_INFO.find(h => h.level === level);
  document.getElementById('learn-title').textContent = info?.name || `HSK ${level}`;

  try {
    const data = await api(`/api/hsk/${level}?limit=${S.learnPerPage}&offset=${offset}`);
    S.learnData = data;
    document.getElementById('learn-info').textContent = `${data.total} từ`;
    document.getElementById('learn-progress').textContent = `Trang ${page + 1} / ${Math.ceil(data.total / S.learnPerPage)}`;
    renderWordList(data.words, 'word-list');
    renderPagination(data.total, page, 'learn-pagination', (p) => openLearn(level, p));
  } catch (e) {
    document.getElementById('word-list').innerHTML = `<p class="muted center">Lỗi tải dữ liệu. Hãy kiểm tra backend đã chạy chưa.</p>`;
  }
}

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

// ── SEARCH ──
let searchTimer;
async function doSearch(q) {
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
}

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
  if (authManager.user) {
    document.getElementById('nav').classList.remove('hidden');
  }
}

// ── FLASHCARD ──
async function initFC(level) {
  try {
    const data = await api(`/api/random?level=${level}&count=30`);
    S.fcDeck = data;
    S.fcIdx = 0;
    updateFC();
  } catch { S.fcDeck = []; }
}

function updateFC() {
  const d = S.fcDeck;
  if (!d.length) return;
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
  newEl.addEventListener('input', async () => {
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

    if (/[\u3400-\u9FBF]/.test(pinyinText)) {
      return;
    }

    try {
      const res = await fetch(`${API}/api/pinyin-to-chinese?pinyin=${encodeURIComponent(pinyinText)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.output && /[\u3400-\u9FBF]/.test(data.output)) {
          newEl.dataset.converted = data.output;
          result.textContent = data.output;
          display.style.display = 'block';
        } else if (!localPreview) {
          display.style.display = 'none';
        }
      }
    } catch (e) {
      console.error('Conversion error:', e);
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
  // tabs
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', e => {
    e.preventDefault();
    const v = t.dataset.view;
    showView(v);
    if (v === 'flashcard') initFC(+document.getElementById('fc-level').value);
    if (v === 'quiz') resetQuizUI();
    if (v === 'admin') loadAdmin();
    if (v === 'saved') openSavedWords();
    if (v === 'pronounce') loadPronounceLevel(+document.getElementById('pronounce-level').value);
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
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => doSearch(e.target.value), 350);
  });

  // modal & writer
  document.getElementById('modal-x')?.addEventListener('click', closeModal);
  document.getElementById('modal')?.addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // auth modal
  document.getElementById('auth-back')?.addEventListener('click', closeAuth);
  document.getElementById('view-auth')?.addEventListener('click', e => { if (e.target.id === 'view-auth') closeAuth(); });
  document.getElementById('pronounce-back')?.addEventListener('click', () => showView('home'));
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
  document.getElementById('fc-easy')?.addEventListener('click', () => {
    const w = S.fcDeck[S.fcIdx];
    if (w) { toggleLearned(w.simplified); }
    nextFC(1);
  });
  document.getElementById('fc-hard')?.addEventListener('click', () => nextFC(1));
  document.getElementById('fc-level')?.addEventListener('change', e => initFC(+e.target.value));

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

  // boot
  authManager.updateAuthUI();
  if (!authManager.user) {
    showView('auth');
  } else {
    if (window.location.pathname === '/admin1811') {
      authManager.showAdminEntry();
    } else {
      showView('home');
      renderHome();
    }
  }
});
