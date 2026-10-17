// ==UserScript==
// @name         Memrise TTS Vocabulary Reader
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  Đọc từ vựng bằng TTS trên Memrise - Tự động nhận diện từ vựng (Auto-detect), chọn giọng đọc chất lượng cao, fix triệt để Chrome GC bug & tối ưu DOM
// @author       TTS Reader & Claude
// @match        https://community-courses.memrise.com/*
// @match        https://*.memrise.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/ngxuanhai123/MemTTS/refs/heads/main/TTS%20Vocabulary.js
// @downloadURL  https://raw.githubusercontent.com/ngxuanhai123/MemTTS/refs/heads/main/TTS%20Vocabulary.js
// ==/UserScript==

(function () {
  'use strict';

  // ─── CONFIG & PERSISTENCE ──────────────────────────────────────────
  const STORAGE_KEY = 'memrise_tts_config';

  const defaultConfig = {
    enabled: true,
    lang: 'en-US',
    voiceName: '', // rỗng = tự động chọn giọng tốt nhất
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    autoRead: true,
    savedSelectors: [],
    repeatCount: 0,
    repeatInterval: 3.0,
    panelWidth: 320,
    panelHeight: 560,
  };

  let config = Object.assign({}, defaultConfig, GM_getValue(STORAGE_KEY, {}));

  // Đảm bảo các trường luôn hợp lệ
  if (!config.panelWidth  || config.panelWidth < 260)  config.panelWidth  = 320;
  if (!config.panelHeight || config.panelHeight < 300) config.panelHeight = 560;
  if (typeof config.voiceName !== 'string') config.voiceName = '';

  function saveConfig() {
    GM_setValue(STORAGE_KEY, config);
  }

  // ─── STATE VARIABLES ───────────────────────────────────────────────
  let isPickingMode = false;
  let highlightEl   = null;
  let autoReadTimer = null;
  let panelOpen     = false;

  // Trạng thái lặp lại
  let repeatRemaining   = 0;
  let repeatCurrentText = '';
  let repeatTimer       = null;
  let progressAnimFrame = null;
  let repeatStartTime   = 0;
  let repeatTotalMs     = 0;

  // Voices Cache & Engine
  let allVoicesCache = null;
  let engineWarmedUp = false;
  let speakGen = 0;
  let lastSpokenText = '';
  let watchedText = '';

  // Khắc phục Chromium GC bug 799003: Giữ tham chiếu toàn cục để V8 không thu hồi Utterance
  const activeUtterances = new Set();

  // ─── MEMRISE DEFAULT SELECTORS & SCORING ────────────────────────────
  const MEMRISE_AUTO_SELECTORS = [
    // === Modern Memrise (app.memrise.com / memrise.com) ===
    { sel: '[data-testid="presentation-prompt"]', prio: 130 },
    { sel: '[data-testid="test-prompt"]', prio: 125 },
    { sel: '[data-testid*="prompt"]', prio: 120 },
    { sel: 'h1[class*="lrnLearn_turnPromptWord"]', prio: 115 },
    { sel: 'h2[class*="lrnLearn_turnPromptWord"]', prio: 115 },
    { sel: 'div[class*="lrnLearn_turnWordBox"]', prio: 110 },
    { sel: 'div[class*="lrnLearn_turnSideMainBox"]', prio: 105 },
    { sel: 'div[class*="SpeedReview_turnWord"], div[class*="speedReview_turnWord"]', prio: 105 },
    { sel: 'div[class*="turnPromptWord"]', prio: 100 },
    { sel: '[data-testid*="word"]', prio: 95 },
    { sel: 'div[class*="lrnPrompt"]', prio: 90 },

    // === Classic Memrise (community-courses.memrise.com) ===
    { sel: '.thing .text', prio: 110 },
    { sel: '.prompt .text', prio: 105 },
    { sel: '.col_a .text, .col-a .text', prio: 100 },
    { sel: '.qquestion .text, .qtext', prio: 95 },
    { sel: '.question-prompt .text', prio: 90 },
    { sel: '.level-questions .question', prio: 85 },
    { sel: '.speed-entry .cipher', prio: 85 },
    { sel: '.presentation-card .text', prio: 80 },
  ];

  // ─── CSS STYLES ───────────────────────────────────────────────────
  GM_addStyle(`
    #mtr-fab {
      position:fixed; bottom:28px; right:28px; z-index:2147483647;
      width:52px; height:52px; border-radius:50%;
      background:linear-gradient(135deg,#6366f1,#8b5cf6);
      box-shadow:0 4px 20px rgba(99,102,241,0.5);
      border:none; cursor:pointer;
      display:flex; align-items:center; justify-content:center;
      transition:transform 0.2s,box-shadow 0.2s;
      font-size:22px; color:#fff; user-select:none;
    }
    #mtr-fab:hover { transform:scale(1.08); box-shadow:0 6px 28px rgba(99,102,241,0.7); }
    #mtr-fab.disabled {
      background:linear-gradient(135deg,#64748b,#94a3b8);
      box-shadow:0 4px 16px rgba(100,116,139,0.4);
    }
    #mtr-fab .mtr-badge {
      position:absolute; top:-3px; right:-3px;
      width:14px; height:14px; background:#ef4444;
      border-radius:50%; border:2px solid #fff; display:none;
    }
    #mtr-fab.picking .mtr-badge { display:block; background:#f59e0b; }
    #mtr-fab .mtr-repeat-badge {
      position:absolute; top:-6px; left:-6px;
      min-width:18px; height:18px; background:#10b981;
      border-radius:9px; border:2px solid #fff; display:none;
      align-items:center; justify-content:center;
      font-size:9px; font-weight:700; color:#fff; padding:0 4px;
    }
    #mtr-fab.repeating .mtr-repeat-badge { display:flex; }
    @keyframes mtr-changed-flash {
      0%   { box-shadow:0 0 0 0 rgba(245,158,11,0.8); }
      60%  { box-shadow:0 0 0 14px rgba(245,158,11,0); }
      100% { box-shadow:0 0 0 0 rgba(245,158,11,0); }
    }
    #mtr-fab.changed { animation:mtr-changed-flash 0.5s ease-out; }

    /* ── PANEL ── */
    #mtr-panel {
      position:fixed; bottom:92px; right:28px; z-index:2147483646;
      width:320px; max-height:560px;
      min-width:260px; max-width:680px;
      background:#0f172a;
      border:1px solid rgba(99,102,241,0.35); border-radius:16px;
      box-shadow:0 20px 60px rgba(0,0,0,0.65),0 0 0 1px rgba(255,255,255,0.05);
      font-family:'Segoe UI',system-ui,sans-serif; color:#e2e8f0;
      overflow:hidden;
      transform-origin:bottom right;
      transition:transform 0.22s cubic-bezier(.16,1,.3,1),opacity 0.2s;
      transform:scale(0.9); opacity:0; pointer-events:none;
      display:flex; flex-direction:column;
    }
    #mtr-panel.open { transform:scale(1); opacity:1; pointer-events:all; }

    /* ── RESIZE HANDLE (góc trên-trái) ── */
    #mtr-resize-handle {
      position:absolute; top:0; left:0; z-index:20;
      width:24px; height:24px; cursor:nw-resize;
      border-top-left-radius:16px;
      display:flex; align-items:flex-start; justify-content:flex-start;
    }
    #mtr-resize-handle::before {
      content:'';
      margin:5px 0 0 5px;
      width:10px; height:10px;
      border-left:2.5px solid rgba(99,102,241,0.5);
      border-top:2.5px solid rgba(99,102,241,0.5);
      border-radius:3px 0 0 0;
      transition:border-color 0.15s;
    }
    #mtr-resize-handle:hover::before { border-color:rgba(165,180,252,0.95); }

    #mtr-panel-header {
      display:flex; align-items:center; justify-content:space-between;
      padding:14px 18px 12px;
      background:linear-gradient(135deg,rgba(99,102,241,0.18),rgba(139,92,246,0.12));
      border-bottom:1px solid rgba(255,255,255,0.06);
      flex-shrink:0;
    }
    #mtr-panel-header .title {
      font-size:13px; font-weight:700; letter-spacing:0.05em;
      text-transform:uppercase; color:#a5b4fc;
    }
    #mtr-panel-header .subtitle { font-size:11px; color:#64748b; margin-top:2px; }

    #mtr-panel-body {
      padding:14px 16px;
      display:flex; flex-direction:column; gap:12px;
      overflow-y:auto; flex:1; min-height:0;
    }
    #mtr-panel-body::-webkit-scrollbar { width:4px; }
    #mtr-panel-body::-webkit-scrollbar-track { background:transparent; }
    #mtr-panel-body::-webkit-scrollbar-thumb { background:#334155; border-radius:4px; }

    .mtr-row { display:flex; align-items:center; gap:8px; }
    .mtr-label {
      font-size:11px; color:#94a3b8; font-weight:600;
      letter-spacing:0.04em; text-transform:uppercase; min-width:68px;
    }
    .mtr-switch { position:relative; width:38px; height:22px; flex-shrink:0; }
    .mtr-switch input { opacity:0; width:0; height:0; }
    .mtr-slider {
      position:absolute; cursor:pointer; inset:0; border-radius:22px;
      background:#1e293b; border:1px solid rgba(255,255,255,0.08); transition:0.2s;
    }
    .mtr-slider:before {
      content:''; position:absolute; width:16px; height:16px;
      left:2px; bottom:2px; border-radius:50%; background:#64748b; transition:0.2s;
    }
    .mtr-switch input:checked + .mtr-slider { background:rgba(99,102,241,0.45); border-color:#6366f1; }
    .mtr-switch input:checked + .mtr-slider:before { transform:translateX(16px); background:#a5b4fc; }
    .mtr-select {
      flex:1; background:#1e293b; border:1px solid rgba(255,255,255,0.1);
      border-radius:8px; color:#e2e8f0; font-size:12px; padding:6px 8px;
      outline:none; cursor:pointer; font-family:inherit; min-width:0;
    }
    .mtr-select:focus { border-color:#6366f1; }
    .mtr-range { flex:1; accent-color:#6366f1; cursor:pointer; }
    .mtr-range-val { font-size:11px; color:#a5b4fc; min-width:32px; text-align:right; }
    .mtr-number {
      width:54px; background:#1e293b; border:1px solid rgba(255,255,255,0.1);
      border-radius:8px; color:#e2e8f0; font-size:12px; padding:5px 8px;
      outline:none; text-align:center; -moz-appearance:textfield; font-family:inherit;
    }
    .mtr-number::-webkit-outer-spin-button,
    .mtr-number::-webkit-inner-spin-button { -webkit-appearance:none; }
    .mtr-number:focus { border-color:#6366f1; }

    .mtr-repeat-section {
      background:rgba(16,185,129,0.06); border:1px solid rgba(16,185,129,0.22);
      border-radius:10px; padding:10px 12px; display:flex; flex-direction:column; gap:8px;
    }
    .mtr-repeat-section .mtr-section-title {
      font-size:11px; color:#6ee7b7; font-weight:700; letter-spacing:0.05em;
      text-transform:uppercase; display:flex; align-items:center; gap:6px;
    }
    .mtr-change-section {
      background:rgba(245,158,11,0.06); border:1px solid rgba(245,158,11,0.22);
      border-radius:10px; padding:10px 12px; display:flex; flex-direction:column; gap:8px;
    }
    .mtr-change-section .mtr-section-title {
      font-size:11px; color:#fcd34d; font-weight:700; letter-spacing:0.05em;
      text-transform:uppercase; display:flex; align-items:center; gap:6px;
    }
    #mtr-current-word {
      font-size:11px; color:#64748b; font-style:italic;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap; transition:color 0.2s;
    }
    #mtr-current-word.active { color:#fbbf24; font-style:normal; font-weight:600; }
    #mtr-detected-tag {
      font-size:9px; background:rgba(99,102,241,0.2); color:#a5b4fc;
      padding:2px 6px; border-radius:4px; border:1px solid rgba(99,102,241,0.3);
      display:none;
    }

    #mtr-repeat-progress-wrap { display:none; flex-direction:column; gap:4px; }
    #mtr-repeat-progress-wrap.active { display:flex; }
    #mtr-repeat-progress-bar-bg {
      height:4px; background:rgba(16,185,129,0.15); border-radius:4px; overflow:hidden;
    }
    #mtr-repeat-progress-bar {
      height:100%; background:#10b981; border-radius:4px;
      transition:width 0.25s linear; width:0%;
    }
    #mtr-repeat-progress-text { font-size:10px; color:#6ee7b7; text-align:right; }
    #mtr-btn-stop-repeat { display:none; }
    #mtr-btn-stop-repeat.active { display:flex; }
    .mtr-divider { height:1px; background:rgba(255,255,255,0.06); margin:2px -4px; }

    #mtr-selector-list {
      display:flex; flex-direction:column; gap:6px;
      max-height:140px; overflow-y:auto; padding-right:2px;
    }
    #mtr-selector-list::-webkit-scrollbar { width:4px; }
    #mtr-selector-list::-webkit-scrollbar-track { background:transparent; }
    #mtr-selector-list::-webkit-scrollbar-thumb { background:#334155; border-radius:4px; }
    .mtr-selector-item {
      display:flex; align-items:center; gap:8px; background:#1e293b;
      border-radius:8px; padding:7px 10px; border:1px solid rgba(255,255,255,0.06); font-size:12px;
    }
    .mtr-selector-item .item-label { flex:1; color:#cbd5e1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .mtr-selector-item .item-selector {
      font-size:10px; color:#475569; font-family:monospace;
      max-width:90px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    }
    .mtr-selector-item .item-play {
      background:none; border:none; color:#6366f1; cursor:pointer;
      font-size:14px; padding:2px; border-radius:4px; transition:color 0.15s;
    }
    .mtr-selector-item .item-play:hover { color:#a5b4fc; }
    .mtr-selector-item .item-del {
      background:none; border:none; color:#475569; cursor:pointer;
      font-size:12px; padding:2px; border-radius:4px; transition:color 0.15s;
    }
    .mtr-selector-item .item-del:hover { color:#ef4444; }
    .mtr-empty { font-size:11px; color:#64748b; text-align:center; padding:10px 0; font-style:italic; }

    .mtr-btn {
      display:flex; align-items:center; gap:6px;
      background:rgba(99,102,241,0.15); border:1px solid rgba(99,102,241,0.35);
      color:#a5b4fc; border-radius:8px; padding:7px 12px;
      font-size:12px; font-weight:600; cursor:pointer;
      transition:background 0.15s,border-color 0.15s; user-select:none; font-family:inherit;
    }
    .mtr-btn:hover { background:rgba(99,102,241,0.25); border-color:rgba(99,102,241,0.55); }
    .mtr-btn.active { background:rgba(99,102,241,0.4); border-color:#6366f1; color:#c7d2fe; }
    .mtr-btn.danger { background:rgba(239,68,68,0.1); border-color:rgba(239,68,68,0.3); color:#f87171; }
    .mtr-btn.danger:hover { background:rgba(239,68,68,0.22); }
    .mtr-btn.green { background:rgba(16,185,129,0.15); border-color:rgba(16,185,129,0.3); color:#6ee7b7; }
    .mtr-btn.green:hover { background:rgba(16,185,129,0.25); }
    .mtr-btn-row { display:flex; gap:8px; flex-wrap:wrap; }

    #mtr-cache-status { font-size:10px; color:#475569; display:flex; align-items:center; gap:4px; }
    #mtr-cache-status .dot {
      width:6px; height:6px; border-radius:50%; background:#475569;
      flex-shrink:0; transition:background 0.3s;
    }
    #mtr-cache-status.ready .dot { background:#10b981; }
    #mtr-cache-status.ready { color:#6ee7b7; }

    #mtr-toast {
      position:fixed; bottom:96px; right:28px; z-index:2147483648;
      background:#1e293b; border:1px solid rgba(99,102,241,0.4); color:#a5b4fc;
      border-radius:10px; padding:8px 14px; font-size:12px;
      font-family:'Segoe UI',system-ui,sans-serif;
      box-shadow:0 8px 24px rgba(0,0,0,0.45);
      opacity:0; pointer-events:none; transform:translateY(8px);
      transition:opacity 0.2s,transform 0.2s;
    }
    #mtr-toast.show { opacity:1; transform:translateY(0); }

    .mtr-pick-highlight {
      outline:2px dashed #f59e0b !important;
      outline-offset:2px !important;
      background:rgba(245,158,11,0.1) !important;
      cursor:crosshair !important;
    }
    @keyframes mtr-pulse {
      0%,100% { box-shadow:0 4px 20px rgba(99,102,241,0.5); }
      50%     { box-shadow:0 4px 30px rgba(99,102,241,0.9),0 0 0 8px rgba(99,102,241,0.18); }
    }
    #mtr-fab.reading { animation:mtr-pulse 1s ease-in-out infinite; }
    @keyframes mtr-repeat-glow {
      0%,100% { box-shadow:0 4px 20px rgba(16,185,129,0.4); }
      50%     { box-shadow:0 4px 28px rgba(16,185,129,0.8),0 0 0 6px rgba(16,185,129,0.15); }
    }
    #mtr-fab.repeating:not(.reading) {
      animation:mtr-repeat-glow 2s ease-in-out infinite;
      background:linear-gradient(135deg,#059669,#10b981);
    }
  `);

  // ─── TEXT CLEANER & SANITIZER ───────────────────────────────────────
  function sanitizeText(raw) {
    if (!raw) return '';
    let text = typeof raw === 'string' ? raw : (raw.innerText || raw.textContent || '');
    text = text.replace(/\u00a0/g, ' ');

    // 1. Decode HTML entities
    text = text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');

    // 2. Bỏ các emoji, icon loa phát âm thanh
    text = text.replace(/[\u{1F50A}\u{1F50B}\u{1F508}\u{1F509}\u{1F507}\u{1F3A4}\u{1F3A7}\u{25B6}\u{25B8}\u{25C0}\u{23F5}]/gu, ' ');

    // 3. Bỏ phiên âm IPA trong [...] hoặc /.../
    text = text.replace(/\[[^\]]*\]/g, ' ');
    text = text.replace(/(^|[\s(])\/[^\n/]{1,40}\/(?=[\s).,!?]|$)/g, '$1 ');

    // 4. Bỏ các nhãn từ loại trong ngoặc đơn
    text = text.replace(/\s*\(\s*(?:noun|verb|adjective|adverb|pronoun|preposition|conjunction|interjection|phrase|idiom|n|v|adj|adv|prep|pron|conj|phr\s*v|vi|vt|slang|colloquial|formal|informal|uk|us|singular|plural)\.?\s*\)/gi, ' ');
    text = text.replace(/\b(?:n|v|adj|adv|prep|pron|conj)\.?\s*:\s*/gi, ' ');

    // 5. Bỏ số thứ tự đầu dòng / đầu text: "1. ", "2) ", "- ", "• "
    text = text.replace(/^\s*(?:\d+[\.\)]|[-*•–—])\s+/gm, '');

    // 6. Chuẩn hóa khoảng trắng và dấu câu thừa
    text = text.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ');
    text = text.replace(/\s*,\s*,+/g, ',').trim();

    return text;
  }

  // ─── SAFE EDITABLE FIELD DETECTION ──────────────────────────────────
  function isEditableTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    if (el.getAttribute('role') === 'textbox') return true;
    if (el.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return true;
    return false;
  }

  // ─── SMART AUTO-DETECT SELECTOR & BEST NODE ─────────────────────────
  function pickBestTextElement() {
    // Ưu tiên 1: Saved Selectors do người dùng tự ghim
    if (config.savedSelectors && config.savedSelectors.length > 0) {
      for (const s of config.savedSelectors) {
        try {
          const el = document.querySelector(s.cssPath);
          if (el) {
            const text = sanitizeText(el);
            if (text) return { el, text, isCustom: true, label: s.label };
          }
        } catch (_) {}
      }
    }

    // Ưu tiên 2: Tự động nhận diện theo danh sách selectors của Memrise
    let best = null;
    let bestScore = -1;
    let bestText = '';

    for (const item of MEMRISE_AUTO_SELECTORS) {
      let nodes;
      try { nodes = document.querySelectorAll(item.sel); } catch (_) { continue; }
      if (!nodes || !nodes.length) continue;

      for (const el of nodes) {
        // Bỏ qua phần tử ẩn
        if (el.offsetParent === null && el.offsetWidth === 0 && el.offsetHeight === 0) continue;
        const text = sanitizeText(el);
        if (!text || text.length > 250) continue; // Từ vựng không thể quá 250 ký tự

        let score = item.prio;
        // Điểm thưởng nếu là phần tử lá (không chứa nút bấm, audio, input con)
        if (!el.querySelector('button, [role="button"], audio, [class*="audio"], input, textarea')) {
          score += 25;
        }
        // Điểm thưởng cho độ dài hợp lý của từ vựng
        const wordCount = text.split(/\s+/).length;
        if (wordCount <= 5) score += 20;
        else if (wordCount <= 12) score += 10;

        if (score > bestScore) {
          best = el;
          bestScore = score;
          bestText = text;
        }
      }
      if (best && bestScore >= 115) break; // Đã tìm thấy khớp chất lượng rất cao
    }

    if (best) {
      return { el: best, text: bestText, isCustom: false, label: 'Tự động nhận diện' };
    }

    return { el: null, text: '', isCustom: false, label: '' };
  }

  // ─── VOICE CACHE & HIGH-QUALITY VOICE SELECTION ─────────────────────
  const VOICE_PRIORITY_PATTERNS = [
    /natural/i,
    /neural/i,
    /online/i,
    /google/i,
    /enhanced/i,
    /premium/i,
    /zira|david|mark|jenny|guy|aria|sonia|hazel|george|susan|alex|samantha|daniel|karen/i,
  ];

  function dedupeVoices(voices) {
    const seen = new Set();
    return voices.filter(v => {
      const key = `${v.lang}|${v.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function sortVoicesByQuality(voices) {
    return [...voices].sort((a, b) => {
      const getPrio = (v) => {
        const text = `${v.name} ${v.voiceURI || ''}`;
        for (let i = 0; i < VOICE_PRIORITY_PATTERNS.length; i++) {
          if (VOICE_PRIORITY_PATTERNS[i].test(text)) return i;
        }
        return VOICE_PRIORITY_PATTERNS.length + (v.localService ? 1 : 0);
      };
      const pa = getPrio(a);
      const pb = getPrio(b);
      if (pa !== pb) return pa - pb;
      return a.name.localeCompare(b.name);
    });
  }

  function getVoicesForLang(lang = config.lang) {
    if (!allVoicesCache || !allVoicesCache.length) {
      allVoicesCache = dedupeVoices(window.speechSynthesis.getVoices());
    }
    const primary = lang.split('-')[0].toLowerCase();
    const exact = lang.toLowerCase().replace('_', '-');

    const matched = allVoicesCache.filter(v => {
      if (!v.lang) return false;
      const vLang = v.lang.toLowerCase().replace('_', '-');
      return vLang === exact || vLang.startsWith(primary + '-');
    });

    return sortVoicesByQuality(matched);
  }

  function resolveVoice(lang, preferredVoiceName) {
    const available = getVoicesForLang(lang);
    if (!available.length) return null;

    if (preferredVoiceName) {
      const found = available.find(v => v.name === preferredVoiceName);
      if (found) return found;
    }
    return available[0]; // Mặc định giọng có ưu tiên cao nhất
  }

  function getVoicesReady() {
    if (allVoicesCache && allVoicesCache.length > 0) return Promise.resolve(allVoicesCache);
    return new Promise(resolve => {
      const v = window.speechSynthesis.getVoices();
      if (v.length > 0) {
        allVoicesCache = dedupeVoices(v);
        resolve(allVoicesCache);
        return;
      }
      function handler() {
        const voices = window.speechSynthesis.getVoices();
        if (!voices.length) return;
        allVoicesCache = dedupeVoices(voices);
        window.speechSynthesis.removeEventListener('voiceschanged', handler);
        resolve(allVoicesCache);
      }
      window.speechSynthesis.addEventListener('voiceschanged', handler);
    });
  }

  function preWarmVoices() {
    function sync() {
      const raw = window.speechSynthesis.getVoices();
      if (!raw.length) return;
      const deduped = dedupeVoices(raw);
      if (deduped.length === allVoicesCache?.length) return;
      allVoicesCache = deduped;
      updateCacheStatus(true);
      populateVoiceDropdown();
      warmUpEngine();
    }
    sync();
    window.speechSynthesis.addEventListener('voiceschanged', sync);
  }

  function updateCacheStatus(ready) {
    const el = document.getElementById('mtr-cache-status');
    const label = document.getElementById('mtr-cache-label');
    if (!el || !label) return;
    if (ready && allVoicesCache) {
      el.classList.add('ready');
      label.textContent = `${allVoicesCache.length} voices sẵn sàng`;
    } else {
      el.classList.remove('ready');
      label.textContent = 'Đang tải voices...';
    }
  }

  function populateVoiceDropdown() {
    const select = document.getElementById('mtr-voice');
    if (!select) return;

    const currentVal = config.voiceName || '';
    const voices = getVoicesForLang(config.lang);

    let html = '<option value="">✨ Tự động (Giọng tốt nhất)</option>';
    voices.forEach(v => {
      const isOnline = !v.localService || /online|natural|neural/i.test(v.name);
      const badge = isOnline ? ' ⭐' : '';
      const selected = v.name === currentVal ? 'selected' : '';
      html += `<option value="${escapeHTML(v.name)}" ${selected}>${escapeHTML(v.name)}${badge}</option>`;
    });
    select.innerHTML = html;
  }

  function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    }[tag] || tag));
  }

  function warmUpEngine() {
    if (engineWarmedUp) return;
    engineWarmedUp = true;
    getVoicesReady().then(() => {
      const voice = resolveVoice(config.lang, config.voiceName);
      const u = new SpeechSynthesisUtterance('\u00A0');
      u.volume = 0;
      u.rate = 10;
      u.lang = config.lang;
      if (voice) u.voice = voice;

      activeUtterances.add(u);
      u.onend = () => activeUtterances.delete(u);
      u.onerror = () => activeUtterances.delete(u);

      try { window.speechSynthesis.speak(u); } catch (_) {}
    });
  }

  // ─── CHROME 15s KEEP-ALIVE ──────────────────────────────────────────
  let keepAliveTimer = null;
  function startKeepAlive() {
    stopKeepAlive();
    keepAliveTimer = setInterval(() => {
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 10000);
  }
  function stopKeepAlive() {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  }

  // ─── CORE SPEECH SYNTHESIS ENGINE ───────────────────────────────────
  async function speak(text, force = false, _fromRepeat = false) {
    if (!config.enabled || !text) return;
    text = sanitizeText(text);
    if (!text) return;
    if (!force && text === lastSpokenText) return;

    if (!_fromRepeat) stopRepeatCycle();

    speakGen++;
    const currentGen = speakGen;

    // Hủy an toàn utterance cũ
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    window.speechSynthesis.cancel();
    stopKeepAlive();

    // Nhỏ gọn delay để browser giải phóng audio hardware
    await new Promise(r => setTimeout(r, 60));
    if (currentGen !== speakGen) return;

    const voices = await getVoicesReady();
    if (currentGen !== speakGen) return;

    const voice = resolveVoice(config.lang, config.voiceName);
    const fab = document.getElementById('mtr-fab');

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang   = config.lang;
    utter.rate   = Math.max(0.5, Math.min(2.0, parseFloat(config.rate) || 1.0));
    utter.pitch  = Math.max(0.5, Math.min(2.0, parseFloat(config.pitch) || 1.0));
    utter.volume = Math.max(0.0, Math.min(1.0, parseFloat(config.volume) || 1.0));
    if (voice) utter.voice = voice;

    // Khắc phục Chromium GC Bug 799003: Giữ tham chiếu mạnh
    activeUtterances.add(utter);

    utter.onstart = () => {
      if (currentGen !== speakGen) return;
      fab?.classList.add('reading');
      startKeepAlive();
    };

    utter.onend = () => {
      activeUtterances.delete(utter);
      if (currentGen !== speakGen) return;
      fab?.classList.remove('reading');
      stopKeepAlive();
      lastSpokenText = text;
      scheduleNextRepeat(text);
    };

    utter.onerror = (e) => {
      activeUtterances.delete(utter);
      if (currentGen !== speakGen) return;
      fab?.classList.remove('reading');
      stopKeepAlive();
      if (e.error !== 'interrupted' && e.error !== 'canceled') {
        lastSpokenText = '';
        stopRepeatCycle();
      }
    };

    if (currentGen !== speakGen) return;

    // Đảm bảo không bị kẹt ở trạng thái paused trước khi speak
    if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    try {
      window.speechSynthesis.speak(utter);
    } catch (_) {}
  }

  function speakWithRepeat(text, force = false, _fromRepeat = false) {
    if (!_fromRepeat) {
      stopRepeatCycle();
      if (config.repeatCount > 0) {
        repeatRemaining = config.repeatCount;
        repeatCurrentText = text;
      }
    }
    return speak(text, force, _fromRepeat);
  }

  function stopAllSpeech() {
    speakGen++;
    window.speechSynthesis.cancel();
    stopRepeatCycle();
    stopKeepAlive();
    activeUtterances.clear();
    const fab = document.getElementById('mtr-fab');
    fab?.classList.remove('reading');
  }

  // ─── REPEAT SCHEDULER ──────────────────────────────────────────────
  function scheduleNextRepeat(text) {
    if (config.repeatCount === 0 || repeatRemaining <= 0) {
      stopRepeatCycle();
      return;
    }
    if (watchedText && text !== watchedText) {
      stopRepeatCycle();
      return;
    }

    const fab = document.getElementById('mtr-fab');
    fab?.classList.add('repeating');
    updateRepeatBadge(repeatRemaining);
    showRepeatProgress(true);

    repeatStartTime = Date.now();
    repeatTotalMs   = (parseFloat(config.repeatInterval) || 3.0) * 1000;

    function animProgress() {
      const elapsed = Date.now() - repeatStartTime;
      const pct = Math.min((elapsed / repeatTotalMs) * 100, 100);
      const bar = document.getElementById('mtr-repeat-progress-bar');
      const txt = document.getElementById('mtr-repeat-progress-text');
      if (bar) bar.style.width = pct + '%';
      if (txt) {
        const rem = Math.max(0, repeatTotalMs - elapsed);
        txt.textContent = `còn ${rem < 1000 ? `${Math.round(rem)}ms` : `${Math.ceil(rem / 1000)}s`} · lần ${repeatRemaining}`;
      }
      if (elapsed < repeatTotalMs) {
        progressAnimFrame = requestAnimationFrame(animProgress);
      }
    }
    cancelAnimationFrame(progressAnimFrame);
    progressAnimFrame = requestAnimationFrame(animProgress);

    clearTimeout(repeatTimer);
    repeatTimer = setTimeout(() => {
      cancelAnimationFrame(progressAnimFrame);
      repeatRemaining--;
      speak(text, true, true);
    }, repeatTotalMs);
  }

  function stopRepeatCycle() {
    clearTimeout(repeatTimer);
    cancelAnimationFrame(progressAnimFrame);
    repeatRemaining   = 0;
    repeatCurrentText = '';
    repeatTimer       = null;

    const fab = document.getElementById('mtr-fab');
    fab?.classList.remove('repeating');
    updateRepeatBadge(0);
    showRepeatProgress(false);
  }

  function updateRepeatBadge(n) {
    const el = document.getElementById('mtr-fab-repeat-count');
    if (!el) return;
    el.textContent = n > 0 ? n : '';
    document.getElementById('mtr-fab')?.classList.toggle('repeating', n > 0);
  }

  function showRepeatProgress(visible) {
    document.getElementById('mtr-repeat-progress-wrap')?.classList.toggle('active', visible);
    document.getElementById('mtr-btn-stop-repeat')?.classList.toggle('active', visible);
    if (!visible) {
      const bar = document.getElementById('mtr-repeat-progress-bar');
      if (bar) bar.style.width = '0%';
    }
  }

  function reReadLast() {
    if (lastSpokenText) {
      speakWithRepeat(lastSpokenText, true);
    } else {
      const { text } = pickBestTextElement();
      if (text) {
        speakWithRepeat(text, true);
        showToast('🔁 Đọc lại: ' + text.slice(0, 30));
      }
    }
  }

  function readSelector(selectorObj) {
    const el = document.querySelector(selectorObj.cssPath);
    const text = el ? sanitizeText(el) : '';
    if (text) {
      showToast(`🔊 Đọc: "${text.slice(0, 40)}"`);
      speakWithRepeat(text, true);
    } else {
      showToast(el ? '⚠️ Không tìm thấy nội dung' : '⚠️ Phần tử không còn trên trang');
    }
  }

  // ─── CHANGE DETECTION & MUTATION THROTTLING ─────────────────────────
  function updateWatchedWordDisplay(text, label) {
    const el = document.getElementById('mtr-current-word');
    const tag = document.getElementById('mtr-detected-tag');
    if (!el) return;
    if (text) {
      el.textContent = `"${text.slice(0, 40)}"`;
      el.classList.add('active');
      if (tag && label) {
        tag.textContent = label;
        tag.style.display = 'inline-block';
      }
    } else {
      el.textContent = '— chưa có từ —';
      el.classList.remove('active');
      if (tag) tag.style.display = 'none';
    }
  }

  function flashChangedFab() {
    const fab = document.getElementById('mtr-fab');
    if (!fab) return;
    fab.classList.remove('changed');
    void fab.offsetWidth;
    fab.classList.add('changed');
    setTimeout(() => fab.classList.remove('changed'), 600);
  }

  function checkAndReadNewWord() {
    if (!config.enabled || !config.autoRead) return;
    const { text, label } = pickBestTextElement();
    if (!text || text === watchedText) return;

    watchedText = text;
    updateWatchedWordDisplay(text, label);
    flashChangedFab();

    clearTimeout(autoReadTimer);
    autoReadTimer = setTimeout(() => {
      const current = pickBestTextElement();
      if (!current.text) return;
      if (current.text !== watchedText) {
        watchedText = current.text;
        updateWatchedWordDisplay(current.text, current.label);
      }
      speakWithRepeat(current.text, true);
    }, 120);
  }

  // Tối ưu hóa: gom mutations bằng requestAnimationFrame + debounce 120ms
  let rafScheduled = false;
  let mutationDebounceTimer = null;

  function onDOMMutation() {
    if (!config.enabled || !config.autoRead) return;
    if (rafScheduled) return;
    rafScheduled = true;

    requestAnimationFrame(() => {
      rafScheduled = false;
      clearTimeout(mutationDebounceTimer);
      mutationDebounceTimer = setTimeout(() => {
        checkAndReadNewWord();
      }, 120);
    });
  }

  // Chỉ quan sát childList để tránh lag khi style, canvas hoặc attribute thay đổi
  const observer = new MutationObserver(onDOMMutation);
  observer.observe(document.body, { childList: true, subtree: true, characterData: false, attributes: false });

  // SPA Route Change Listener (khi chuyển qua bài học khác mà không reload trang)
  let lastUrl = location.href;
  function handleUrlChange() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      watchedText = '';
      lastSpokenText = '';
      stopRepeatCycle();
      updateWatchedWordDisplay('', '');
      setTimeout(checkAndReadNewWord, 500);
    }
  }

  const origPushState = history.pushState;
  if (origPushState) {
    history.pushState = function () {
      origPushState.apply(this, arguments);
      handleUrlChange();
    };
  }
  const origReplaceState = history.replaceState;
  if (origReplaceState) {
    history.replaceState = function () {
      origReplaceState.apply(this, arguments);
      handleUrlChange();
    };
  }
  window.addEventListener('popstate', handleUrlChange);

  // ─── CSS PATH GENERATOR FOR PICK MODE ──────────────────────────────
  function getCSSPath(el) {
    const parts = [];
    while (el && el !== document.body) {
      let selector = el.tagName.toLowerCase();
      if (el.id) {
        selector += '#' + CSS.escape(el.id);
        parts.unshift(selector);
        break;
      } else {
        const classes = [...el.classList].filter(c => !c.startsWith('mtr-')).slice(0, 2);
        if (classes.length) selector += '.' + classes.join('.');
        const siblings = el.parentElement
          ? [...el.parentElement.children].filter(c => c.tagName === el.tagName)
          : [];
        if (siblings.length > 1) selector += `:nth-of-type(${siblings.indexOf(el) + 1})`;
        parts.unshift(selector);
        el = el.parentElement;
      }
    }
    return parts.join(' > ');
  }

  function getLabelFromEl(el) {
    const text = sanitizeText(el).slice(0, 30);
    const cls  = [...el.classList].filter(c => !c.startsWith('mtr-')).slice(0, 2).join('.');
    return text || `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
  }

  // ─── PICK MODE ─────────────────────────────────────────────────────
  function startPickMode() {
    isPickingMode = true;
    document.getElementById('mtr-fab')?.classList.add('picking');
    const btn = document.getElementById('mtr-btn-pick');
    if (btn) { btn.classList.add('active'); btn.textContent = '⏹ Hủy chọn'; }
    showToast('🎯 Click vào từ/phần tử bạn muốn đọc...');
    document.body.style.cursor = 'crosshair';
  }

  function stopPickMode() {
    isPickingMode = false;
    clearHighlight();
    document.getElementById('mtr-fab')?.classList.remove('picking');
    const btn = document.getElementById('mtr-btn-pick');
    if (btn) { btn.classList.remove('active'); btn.textContent = '✚ Chọn vị trí'; }
    document.body.style.cursor = '';
  }

  function clearHighlight() {
    if (highlightEl) {
      highlightEl.classList.remove('mtr-pick-highlight');
      highlightEl = null;
    }
  }

  // ─── TOAST NOTIFICATION ────────────────────────────────────────────
  let toastTimer;
  function showToast(msg) {
    const t = document.getElementById('mtr-toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ─── UI BUILDER ────────────────────────────────────────────────────
  function createUI() {
    const toast = document.createElement('div');
    toast.id = 'mtr-toast';
    document.body.appendChild(toast);

    const fab = document.createElement('button');
    fab.id = 'mtr-fab';
    fab.title = 'Memrise TTS Reader (Click để mở menu, Double click để bật/tắt)';
    fab.innerHTML = '🔊<span class="mtr-badge"></span><span class="mtr-repeat-badge" id="mtr-fab-repeat-count"></span>';
    if (!config.enabled) fab.classList.add('disabled');
    document.body.appendChild(fab);

    const panel = document.createElement('div');
    panel.id = 'mtr-panel';
    panel.innerHTML = buildPanelHTML();
    document.body.appendChild(panel);

    panel.style.width     = config.panelWidth  + 'px';
    panel.style.maxHeight = config.panelHeight + 'px';

    return { fab, panel, toast };
  }

  function buildPanelHTML() {
    const langs = [
      { code:'en-US', name:'🇺🇸 English (US)' },
      { code:'en-GB', name:'🇬🇧 English (UK)' },
      { code:'vi-VN', name:'🇻🇳 Tiếng Việt'  },
      { code:'ja-JP', name:'🇯🇵 日本語'        },
      { code:'ko-KR', name:'🇰🇷 한국어'         },
      { code:'zh-CN', name:'🇨🇳 中文 (简体)'   },
      { code:'zh-TW', name:'🇹🇼 中文 (繁體)'   },
      { code:'fr-FR', name:'🇫🇷 Français'      },
      { code:'de-DE', name:'🇩🇪 Deutsch'       },
      { code:'es-ES', name:'🇪🇸 Español'       },
      { code:'ru-RU', name:'🇷🇺 Русский'       },
      { code:'id-ID', name:'🇮🇩 Bahasa Indonesia' },
    ];
    const langOptions = langs.map(l =>
      `<option value="${l.code}" ${config.lang === l.code ? 'selected' : ''}>${l.name}</option>`
    ).join('');

    return `
      <div id="mtr-resize-handle" title="Kéo để thay đổi kích thước panel"></div>
      <div id="mtr-panel-header">
        <div>
          <div class="title">📖 Trình đọc TTS v4.0</div>
          <div class="subtitle">Memrise Vocabulary Reader</div>
        </div>
        <div id="mtr-cache-status" title="Trạng thái giọng đọc">
          <span class="dot"></span>
          <span id="mtr-cache-label">Đang tải voices...</span>
        </div>
      </div>
      <div id="mtr-panel-body">
        <div class="mtr-row">
          <span class="mtr-label">Bật TTS</span>
          <label class="mtr-switch">
            <input type="checkbox" id="mtr-toggle-enabled" ${config.enabled ? 'checked' : ''}>
            <span class="mtr-slider"></span>
          </label>
          <span class="mtr-label" style="min-width:auto;margin-left:12px">Tự đọc</span>
          <label class="mtr-switch">
            <input type="checkbox" id="mtr-toggle-auto" ${config.autoRead ? 'checked' : ''}>
            <span class="mtr-slider"></span>
          </label>
        </div>
        <div class="mtr-row">
          <span class="mtr-label">Ngôn ngữ</span>
          <select id="mtr-lang" class="mtr-select">${langOptions}</select>
        </div>
        <div class="mtr-row">
          <span class="mtr-label">Giọng đọc</span>
          <select id="mtr-voice" class="mtr-select">
            <option value="">✨ Tự động (Giọng tốt nhất)</option>
          </select>
        </div>
        <div class="mtr-row">
          <span class="mtr-label">Tốc độ</span>
          <input type="range" id="mtr-rate" class="mtr-range" min="0.5" max="2" step="0.1" value="${config.rate}">
          <span class="mtr-range-val" id="mtr-rate-val">${config.rate}x</span>
        </div>
        <div class="mtr-row">
          <span class="mtr-label">Cao độ</span>
          <input type="range" id="mtr-pitch" class="mtr-range" min="0.5" max="2" step="0.1" value="${config.pitch}">
          <span class="mtr-range-val" id="mtr-pitch-val">${config.pitch}</span>
        </div>
        <div class="mtr-divider"></div>
        <div class="mtr-repeat-section">
          <div class="mtr-section-title">🔁 Lặp lại tự động</div>
          <div class="mtr-row" style="gap:10px;">
            <span class="mtr-label" style="min-width:54px;">Số lần</span>
            <input type="number" id="mtr-repeat-count" class="mtr-number" min="0" max="20" value="${config.repeatCount}" placeholder="0">
            <span style="font-size:11px;color:#64748b;flex:1;">lần (0 = tắt)</span>
          </div>
          <div class="mtr-row" style="gap:10px;">
            <span class="mtr-label" style="min-width:54px;">Cách nhau</span>
            <input type="number" id="mtr-repeat-interval" class="mtr-number" min="0.1" max="60" step="0.1" value="${config.repeatInterval}" placeholder="3">
            <span style="font-size:11px;color:#64748b;flex:1;">giây</span>
          </div>
          <div id="mtr-repeat-progress-wrap">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">
              <span style="font-size:10px;color:#6ee7b7;">Đang chờ đọc lại...</span>
              <span id="mtr-repeat-progress-text" style="font-size:10px;color:#6ee7b7;"></span>
            </div>
            <div id="mtr-repeat-progress-bar-bg">
              <div id="mtr-repeat-progress-bar"></div>
            </div>
          </div>
          <button class="mtr-btn danger" id="mtr-btn-stop-repeat" style="width:100%;justify-content:center;">
            ⏹ Dừng lặp lại
          </button>
        </div>
        <div class="mtr-change-section">
          <div class="mtr-section-title">
            <span>⚡ Từ vựng hiện tại</span>
            <span id="mtr-detected-tag">Tự động</span>
          </div>
          <div style="font-size:11px;color:#92400e;line-height:1.4;">
            Tự động lọc sạch phiên âm IPA, từ loại và phát hiện từ mới.
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:10px;color:#78716c;">Đang theo dõi:</span>
            <span id="mtr-current-word">— chưa có từ —</span>
          </div>
        </div>
        <div class="mtr-divider"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:11px;color:#94a3b8;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;">
            📌 Vị trí tự chọn (Tuỳ chọn)
          </div>
        </div>
        <div id="mtr-selector-list"></div>
        <div class="mtr-btn-row">
          <button class="mtr-btn" id="mtr-btn-pick">✚ Chọn vị trí</button>
          <button class="mtr-btn" id="mtr-btn-reread" title="Đọc lại từ hiện tại (Phím R)">🔁 Đọc lại</button>
          <button class="mtr-btn danger" id="mtr-btn-clear">🗑 Xoá vị trí</button>
        </div>
        <div class="mtr-divider"></div>
        <div style="font-size:11px;color:#94a3b8;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;">
          🔈 Thử nghiệm âm thanh
        </div>
        <div class="mtr-row" style="gap:6px;">
          <input id="mtr-test-input" type="text" placeholder="Nhập từ cần phát âm..."
            style="flex:1;background:#1e293b;border:1px solid rgba(255,255,255,0.1);border-radius:8px;
            color:#e2e8f0;font-size:12px;padding:6px 10px;outline:none;font-family:inherit;">
          <button class="mtr-btn" id="mtr-btn-test">▶</button>
        </div>
        <div style="font-size:10px;color:#475569;text-align:center;margin-top:2px;">
          Phím tắt: R (đọc lại) · Alt+S (bật/tắt) · Alt+X (dừng) · Kéo góc ↖ để đổi cỡ
        </div>
      </div>
    `;
  }

  function renderSelectorList() {
    const list = document.getElementById('mtr-selector-list');
    if (!list) return;
    if (!config.savedSelectors || config.savedSelectors.length === 0) {
      list.innerHTML = '<div class="mtr-empty">Mặc định dùng Auto-detect. Bạn có thể bấm "+ Chọn vị trí" nếu muốn chỉ định vùng riêng.</div>';
      return;
    }
    list.innerHTML = config.savedSelectors.map((s, i) => `
      <div class="mtr-selector-item" data-index="${i}">
        <div style="flex:1;min-width:0;">
          <div class="item-label">📌 ${escapeHTML(s.label)}</div>
          <div class="item-selector">${escapeHTML(s.cssPath)}</div>
        </div>
        <button class="item-play" title="Đọc ngay" data-index="${i}">▶</button>
        <button class="item-del"  title="Xoá"      data-index="${i}">✕</button>
      </div>
    `).join('');

    list.querySelectorAll('.item-play').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        readSelector(config.savedSelectors[+btn.dataset.index]);
      });
    });
    list.querySelectorAll('.item-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        config.savedSelectors.splice(+btn.dataset.index, 1);
        saveConfig();
        renderSelectorList();
        showToast('🗑 Đã xoá vị trí');
      });
    });
  }

  // ─── PANEL RESIZE ──────────────────────────────────────────────────
  function initPanelResize(panel) {
    const handle = document.getElementById('mtr-resize-handle');
    if (!handle) return;

    let dragging = false, startX, startY, startW, startH;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      startX   = e.clientX;
      startY   = e.clientY;
      startW   = panel.offsetWidth;
      startH   = panel.offsetHeight;
      document.body.style.userSelect = 'none';
      document.body.style.cursor     = 'nw-resize';
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const newW = Math.max(260, Math.min(680, startW + (startX - e.clientX)));
      const newH = Math.max(300, Math.min(window.innerHeight - 130, startH + (startY - e.clientY)));
      panel.style.width     = newW + 'px';
      panel.style.maxHeight = newH + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = '';
      document.body.style.cursor     = '';
      config.panelWidth  = panel.offsetWidth;
      config.panelHeight = panel.offsetHeight;
      saveConfig();
      showToast(`📐 Đã lưu cỡ: ${config.panelWidth}×${config.panelHeight}px`);
    });
  }

  // ─── INITIALIZATION ────────────────────────────────────────────────
  function init() {
    const { fab, panel } = createUI();
    renderSelectorList();
    preWarmVoices();
    initPanelResize(panel);

    // FAB click -> mở/đóng panel
    fab.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isPickingMode) { stopPickMode(); return; }
      panelOpen = !panelOpen;
      panel.classList.toggle('open', panelOpen);
      if (panelOpen) {
        updateCacheStatus(allVoicesCache && allVoicesCache.length > 0);
        populateVoiceDropdown();
        const cur = pickBestTextElement();
        updateWatchedWordDisplay(cur.text || watchedText, cur.label);
      }
    });

    // FAB double-click -> bật/tắt nhanh
    fab.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      config.enabled = !config.enabled;
      saveConfig();
      fab.classList.toggle('disabled', !config.enabled);
      const chk = document.getElementById('mtr-toggle-enabled');
      if (chk) chk.checked = config.enabled;
      showToast(config.enabled ? '🔊 TTS đã bật' : '🔇 TTS đã tắt');
      if (!config.enabled) stopAllSpeech();
    });

    // Đóng panel khi click bên ngoài
    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target) && e.target !== fab && !isPickingMode) {
        panelOpen = false;
        panel.classList.remove('open');
      }
    });

    // Bật/tắt TTS
    document.getElementById('mtr-toggle-enabled')?.addEventListener('change', function () {
      config.enabled = this.checked;
      saveConfig();
      fab.classList.toggle('disabled', !config.enabled);
      if (!config.enabled) stopAllSpeech();
      showToast(config.enabled ? '🔊 TTS đã bật' : '🔇 TTS đã tắt');
    });

    // Bật/tắt Tự đọc
    document.getElementById('mtr-toggle-auto')?.addEventListener('change', function () {
      config.autoRead = this.checked;
      saveConfig();
      showToast(config.autoRead ? '⚡ Tự đọc đã bật' : '⏸ Tự đọc đã tắt');
      if (config.autoRead) checkAndReadNewWord();
    });

    // Thay đổi ngôn ngữ
    document.getElementById('mtr-lang')?.addEventListener('change', function () {
      config.lang = this.value;
      config.voiceName = ''; // reset giọng để auto chọn giọng tốt nhất của ngôn ngữ mới
      saveConfig();
      populateVoiceDropdown();
      engineWarmedUp = false;
      warmUpEngine();
      showToast(`🌐 Ngôn ngữ: ${this.options[this.selectedIndex].text}`);
    });

    // Thay đổi giọng đọc cụ thể
    document.getElementById('mtr-voice')?.addEventListener('change', function () {
      config.voiceName = this.value;
      saveConfig();
      const txt = this.value ? `🗣 Giọng: ${this.options[this.selectedIndex].text}` : '✨ Giọng: Tự động';
      showToast(txt);
      warmUpEngine();
    });

    // Tốc độ
    document.getElementById('mtr-rate')?.addEventListener('input', function () {
      config.rate = parseFloat(this.value);
      document.getElementById('mtr-rate-val').textContent = config.rate + 'x';
      saveConfig();
    });

    // Cao độ
    document.getElementById('mtr-pitch')?.addEventListener('input', function () {
      config.pitch = parseFloat(this.value);
      document.getElementById('mtr-pitch-val').textContent = config.pitch;
      saveConfig();
    });

    // Số lần lặp
    document.getElementById('mtr-repeat-count')?.addEventListener('change', function () {
      const val = Math.max(0, Math.min(20, parseInt(this.value, 10) || 0));
      this.value = val;
      config.repeatCount = val;
      saveConfig();
      showToast(val === 0 ? '🔁 Lặp lại đã tắt' : `🔁 Sẽ lặp thêm ${val} lần`);
    });

    // Khoảng cách lặp
    document.getElementById('mtr-repeat-interval')?.addEventListener('change', function () {
      const val = Math.max(0.1, Math.min(60, parseFloat(this.value) || 3));
      this.value = val;
      config.repeatInterval = val;
      saveConfig();
      showToast(`⏱ Khoảng cách: ${val}s`);
    });

    // Dừng lặp lại
    document.getElementById('mtr-btn-stop-repeat')?.addEventListener('click', () => {
      stopAllSpeech();
      showToast('⏹ Đã dừng lặp lại');
    });

    // Test input
    document.getElementById('mtr-btn-test')?.addEventListener('click', () => {
      const input = document.getElementById('mtr-test-input');
      const val = input ? input.value.trim() : '';
      if (val) speakWithRepeat(val, true);
      else showToast('⚠️ Nhập từ cần thử trước');
    });

    document.getElementById('mtr-test-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.value.trim()) {
        speakWithRepeat(e.target.value.trim(), true);
      }
    });

    // Đọc lại từ
    document.getElementById('mtr-btn-reread')?.addEventListener('click', () => {
      reReadLast();
      showToast('🔁 Đọc lại...');
    });

    // Xoá tất cả selector
    document.getElementById('mtr-btn-clear')?.addEventListener('click', () => {
      if (!config.savedSelectors || !config.savedSelectors.length) {
        showToast('Chưa có vị trí nào để xoá');
        return;
      }
      config.savedSelectors = [];
      saveConfig();
      renderSelectorList();
      showToast('🗑 Đã xoá tất cả vị trí');
    });

    // Nút chọn vị trí
    document.getElementById('mtr-btn-pick')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isPickingMode) {
        stopPickMode();
      } else {
        startPickMode();
        panelOpen = false;
        panel.classList.remove('open');
      }
    });

    // Pick Mode Events
    document.addEventListener('mouseover', (e) => {
      if (!isPickingMode) return;
      if (e.target.closest('#mtr-panel') || e.target === fab) return;
      clearHighlight();
      highlightEl = e.target;
      highlightEl.classList.add('mtr-pick-highlight');
    });

    document.addEventListener('mouseout', (e) => {
      if (!isPickingMode) return;
      if (e.target === highlightEl) clearHighlight();
    });

    document.addEventListener('click', (e) => {
      if (!isPickingMode) return;
      if (e.target.closest('#mtr-panel') || e.target === fab) return;
      e.preventDefault();
      e.stopPropagation();

      const target  = e.target;
      const cssPath = getCSSPath(target);
      const label   = getLabelFromEl(target);
      const text    = sanitizeText(target);

      if (!config.savedSelectors.some(s => s.cssPath === cssPath)) {
        config.savedSelectors.push({ label, cssPath });
        saveConfig();
        showToast(`✅ Đã lưu: "${label.slice(0, 30)}"`);
      } else {
        showToast('ℹ️ Vị trí này đã được lưu rồi');
      }

      if (text) speakWithRepeat(text, true);

      stopPickMode();
      renderSelectorList();
      panelOpen = true;
      panel.classList.add('open');
    }, true);

    // Bắt phím tắt an toàn (không xung đột ô nhập liệu)
    document.addEventListener('keydown', (e) => {
      if (isEditableTarget(document.activeElement)) return;

      if (e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        config.enabled = !config.enabled;
        saveConfig();
        fab.classList.toggle('disabled', !config.enabled);
        const chk = document.getElementById('mtr-toggle-enabled');
        if (chk) chk.checked = config.enabled;
        showToast(config.enabled ? '🔊 TTS đã bật' : '🔇 TTS đã tắt');
        if (!config.enabled) stopAllSpeech();
        return;
      }

      if (e.altKey && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        stopAllSpeech();
        showToast('⏹ Đã dừng (Alt+X)');
        return;
      }

      if (e.key === 'r' || e.key === 'R') {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          reReadLast();
          showToast('🔁 Đọc lại...');
        }
        return;
      }

      if (e.key === 'Escape' && isPickingMode) {
        stopPickMode();
      }
    });

    // Khởi động kiểm tra từ đầu tiên sau khi trang nạp
    setTimeout(checkAndReadNewWord, 1200);
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);

})();
