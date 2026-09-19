// ==UserScript==
// @name         Memrise TTS Vocabulary Reader
// @namespace    http://tampermonkey.net/
// @version      3.6
// @description  Đọc từ vựng bằng TTS trên Memrise - fix cắt đầu từ lần đầu + fix số voice hiển thị sai
// @author       TTS Reader
// @match        https://community-courses.memrise.com/*
// @match        https://*.memrise.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/ngxuanhai123/MemTTS/main/TTS%20Vocabulary.js
// @downloadURL  https://raw.githubusercontent.com/ngxuanhai123/MemTTS/main/TTS%20Vocabulary.js
// ==/UserScript==

(function () {
  'use strict';

  // ─── CONFIG & STATE ───────────────────────────────────────────────
  const STORAGE_KEY = 'memrise_tts_config';

  let config = GM_getValue(STORAGE_KEY, {
    enabled: true,
    lang: 'en-US',
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    autoRead: true,
    savedSelectors: [],
    repeatCount: 0,
    repeatInterval: 3.0,
    panelWidth: 310,
    panelHeight: 520,
  });

  // Migrate: thêm trường mới nếu chưa có
  if (!config.panelWidth)  config.panelWidth  = 310;
  if (!config.panelHeight) config.panelHeight = 520;

  let isPickingMode = false;
  let highlightEl   = null;
  let autoReadTimer = null;
  let panelOpen     = false;

  // Repeat state
  let repeatRemaining   = 0;
  let repeatCurrentText = '';
  let repeatTimer       = null;

  // Voice cache
  const voiceCache   = new Map();
  let allVoicesCache = null;

  // Change-detection state
  let watchedText       = '';
  let changeDetectTimer = null;

  // ─────────────────────────────────────────────────────────────────
  // GENERATION COUNTER — tránh callback cũ can thiệp.
  // ─────────────────────────────────────────────────────────────────
  let speakGen = 0;

  // ─────────────────────────────────────────────────────────────────
  // FIX #1 – ENGINE WARM-UP FLAG
  // Chỉ warm-up 1 lần duy nhất khi voices sẵn sàng.
  // ─────────────────────────────────────────────────────────────────
  let engineWarmedUp = false;

  function saveConfig() { GM_setValue(STORAGE_KEY, config); }

  // ─── CSS ─────────────────────────────────────────────────────────
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
    #mtr-fab:hover { transform:scale(1.1); box-shadow:0 6px 28px rgba(99,102,241,0.7); }
    #mtr-fab.disabled {
      background:linear-gradient(135deg,#64748b,#94a3b8);
      box-shadow:0 4px 16px rgba(100,116,139,0.4);
    }
    #mtr-fab .mtr-badge {
      position:absolute; top:-4px; right:-4px;
      width:14px; height:14px; background:#ef4444;
      border-radius:50%; border:2px solid #fff; display:none;
    }
    #mtr-fab.picking .mtr-badge { display:block; background:#f59e0b; }
    #mtr-fab .mtr-repeat-badge {
      position:absolute; top:-6px; left:-6px;
      min-width:18px; height:18px; background:#10b981;
      border-radius:9px; border:2px solid #fff; display:none;
      align-items:center; justify-content:center;
      font-size:9px; font-weight:700; color:#fff; padding:0 3px;
    }
    #mtr-fab.repeating .mtr-repeat-badge { display:flex; }
    @keyframes mtr-changed-flash {
      0%   { box-shadow:0 0 0 0  rgba(245,158,11,0.8); }
      60%  { box-shadow:0 0 0 14px rgba(245,158,11,0);  }
      100% { box-shadow:0 0 0 0  rgba(245,158,11,0);   }
    }
    #mtr-fab.changed { animation:mtr-changed-flash 0.5s ease-out; }

    /* ── PANEL ── */
    #mtr-panel {
      position:fixed; bottom:92px; right:28px; z-index:2147483646;
      width:310px; max-height:520px;
      min-width:260px; max-width:680px;
      background:#0f172a;
      border:1px solid rgba(99,102,241,0.3); border-radius:16px;
      box-shadow:0 20px 60px rgba(0,0,0,0.6),0 0 0 1px rgba(255,255,255,0.04);
      font-family:'Segoe UI',system-ui,sans-serif; color:#e2e8f0;
      overflow:hidden;
      transform-origin:bottom right;
      transition:transform 0.25s cubic-bezier(.16,1,.3,1),opacity 0.2s;
      transform:scale(0.85); opacity:0; pointer-events:none;
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
      border-left:2.5px solid rgba(99,102,241,0.45);
      border-top:2.5px solid rgba(99,102,241,0.45);
      border-radius:3px 0 0 0;
      transition:border-color 0.15s;
    }
    #mtr-resize-handle:hover::before { border-color:rgba(165,180,252,0.9); }

    #mtr-panel-header {
      display:flex; align-items:center; justify-content:space-between;
      padding:14px 18px 12px;
      background:linear-gradient(135deg,rgba(99,102,241,0.15),rgba(139,92,246,0.1));
      border-bottom:1px solid rgba(255,255,255,0.06);
      flex-shrink:0;
    }
    #mtr-panel-header .title {
      font-size:13px; font-weight:700; letter-spacing:0.06em;
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
      letter-spacing:0.04em; text-transform:uppercase; min-width:64px;
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
    .mtr-switch input:checked + .mtr-slider { background:rgba(99,102,241,0.4); border-color:#6366f1; }
    .mtr-switch input:checked + .mtr-slider:before { transform:translateX(16px); background:#a5b4fc; }
    .mtr-select {
      flex:1; background:#1e293b; border:1px solid rgba(255,255,255,0.08);
      border-radius:8px; color:#e2e8f0; font-size:12px; padding:5px 8px;
      outline:none; cursor:pointer;
    }
    .mtr-select:focus { border-color:#6366f1; }
    .mtr-range { flex:1; accent-color:#6366f1; cursor:pointer; }
    .mtr-range-val { font-size:11px; color:#a5b4fc; min-width:28px; text-align:right; }
    .mtr-number {
      width:52px; background:#1e293b; border:1px solid rgba(255,255,255,0.08);
      border-radius:8px; color:#e2e8f0; font-size:12px; padding:5px 8px;
      outline:none; text-align:center; -moz-appearance:textfield;
    }
    .mtr-number::-webkit-outer-spin-button,
    .mtr-number::-webkit-inner-spin-button { -webkit-appearance:none; }
    .mtr-number:focus { border-color:#6366f1; }
    .mtr-repeat-section {
      background:rgba(16,185,129,0.06); border:1px solid rgba(16,185,129,0.2);
      border-radius:10px; padding:10px 12px; display:flex; flex-direction:column; gap:8px;
    }
    .mtr-repeat-section .mtr-section-title {
      font-size:11px; color:#6ee7b7; font-weight:700; letter-spacing:0.05em;
      text-transform:uppercase; display:flex; align-items:center; gap:6px;
    }
    .mtr-change-section {
      background:rgba(245,158,11,0.06); border:1px solid rgba(245,158,11,0.2);
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
    #mtr-repeat-progress-wrap { display:none; flex-direction:column; gap:4px; }
    #mtr-repeat-progress-wrap.active { display:flex; }
    #mtr-repeat-progress-bar-bg {
      height:4px; background:rgba(16,185,129,0.15); border-radius:4px; overflow:hidden;
    }
    #mtr-repeat-progress-bar {
      height:100%; background:#10b981; border-radius:4px;
      transition:width 0.3s linear; width:0%;
    }
    #mtr-repeat-progress-text { font-size:10px; color:#6ee7b7; text-align:right; }
    #mtr-btn-stop-repeat { display:none; }
    #mtr-btn-stop-repeat.active { display:flex; }
    .mtr-divider { height:1px; background:rgba(255,255,255,0.05); margin:2px -4px; }
    #mtr-selector-list {
      display:flex; flex-direction:column; gap:6px;
      max-height:160px; overflow-y:auto; padding-right:2px;
    }
    #mtr-selector-list::-webkit-scrollbar { width:4px; }
    #mtr-selector-list::-webkit-scrollbar-track { background:transparent; }
    #mtr-selector-list::-webkit-scrollbar-thumb { background:#334155; border-radius:4px; }
    .mtr-selector-item {
      display:flex; align-items:center; gap:8px; background:#1e293b;
      border-radius:8px; padding:7px 10px; border:1px solid rgba(255,255,255,0.05); font-size:12px;
    }
    .mtr-selector-item .item-label { flex:1; color:#cbd5e1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .mtr-selector-item .item-selector {
      font-size:10px; color:#475569; font-family:monospace;
      max-width:100px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
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
    .mtr-empty { font-size:11px; color:#475569; text-align:center; padding:12px 0; font-style:italic; }
    .mtr-btn {
      display:flex; align-items:center; gap:6px;
      background:rgba(99,102,241,0.15); border:1px solid rgba(99,102,241,0.3);
      color:#a5b4fc; border-radius:8px; padding:7px 12px;
      font-size:12px; font-weight:600; cursor:pointer;
      transition:background 0.15s,border-color 0.15s; user-select:none;
    }
    .mtr-btn:hover { background:rgba(99,102,241,0.25); border-color:rgba(99,102,241,0.5); }
    .mtr-btn.active { background:rgba(99,102,241,0.35); border-color:#6366f1; color:#c7d2fe; }
    .mtr-btn.danger { background:rgba(239,68,68,0.1); border-color:rgba(239,68,68,0.3); color:#f87171; }
    .mtr-btn.danger:hover { background:rgba(239,68,68,0.2); }
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
      position:fixed; bottom:100px; right:28px; z-index:2147483648;
      background:#1e293b; border:1px solid rgba(99,102,241,0.4); color:#a5b4fc;
      border-radius:10px; padding:8px 14px; font-size:12px;
      font-family:'Segoe UI',system-ui,sans-serif;
      box-shadow:0 8px 24px rgba(0,0,0,0.4);
      opacity:0; pointer-events:none; transform:translateY(8px);
      transition:opacity 0.2s,transform 0.2s;
    }
    #mtr-toast.show { opacity:1; transform:translateY(0); }
    .mtr-pick-highlight {
      outline:2px dashed #f59e0b !important;
      outline-offset:2px !important;
      background:rgba(245,158,11,0.08) !important;
      cursor:crosshair !important;
    }
    @keyframes mtr-pulse {
      0%,100% { box-shadow:0 4px 20px rgba(99,102,241,0.5); }
      50%      { box-shadow:0 4px 30px rgba(99,102,241,0.9),0 0 0 8px rgba(99,102,241,0.15); }
    }
    #mtr-fab.reading { animation:mtr-pulse 1s ease-in-out infinite; }
    @keyframes mtr-repeat-glow {
      0%,100% { box-shadow:0 4px 20px rgba(16,185,129,0.4); }
      50%      { box-shadow:0 4px 28px rgba(16,185,129,0.8),0 0 0 6px rgba(16,185,129,0.12); }
    }
    #mtr-fab.repeating:not(.reading) {
      animation:mtr-repeat-glow 2s ease-in-out infinite;
      background:linear-gradient(135deg,#059669,#10b981);
    }
  `);

  // ─── DOM CREATION ────────────────────────────────────────────────
  function createUI() {
    const toast = document.createElement('div');
    toast.id = 'mtr-toast';
    document.body.appendChild(toast);

    const fab = document.createElement('button');
    fab.id = 'mtr-fab';
    fab.title = 'Memrise TTS Reader';
    fab.innerHTML = '🔊<span class="mtr-badge"></span><span class="mtr-repeat-badge" id="mtr-fab-repeat-count"></span>';
    if (!config.enabled) fab.classList.add('disabled');
    document.body.appendChild(fab);

    const panel = document.createElement('div');
    panel.id = 'mtr-panel';
    panel.innerHTML = buildPanelHTML();
    document.body.appendChild(panel);

    // Khôi phục kích thước đã lưu
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
          <div class="title">📖 Trình đọc TTS</div>
          <div class="subtitle">Memrise Vocabulary Player</div>
        </div>
        <div id="mtr-cache-status" title="Trạng thái cache giọng đọc">
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
            <span class="mtr-label" style="min-width:52px;">Số lần</span>
            <input type="number" id="mtr-repeat-count" class="mtr-number" min="0" max="20" value="${config.repeatCount}" placeholder="0">
            <span style="font-size:11px;color:#64748b;flex:1;">lần (0 = tắt)</span>
          </div>
          <div class="mtr-row" style="gap:10px;">
            <span class="mtr-label" style="min-width:52px;">Cách nhau</span>
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
          <div class="mtr-section-title">⚡ Phát hiện từ mới</div>
          <div style="font-size:11px;color:#92400e;line-height:1.5;">
            Khi từ trên trang thay đổi, TTS sẽ dừng ngay và đọc từ mới.
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:10px;color:#78716c;">Đang theo dõi:</span>
            <span id="mtr-current-word">— chưa có từ —</span>
          </div>
        </div>
        <div class="mtr-divider"></div>
        <div style="font-size:11px;color:#94a3b8;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;">
          📌 Vị trí từ đã lưu
        </div>
        <div id="mtr-selector-list"></div>
        <div class="mtr-btn-row">
          <button class="mtr-btn" id="mtr-btn-pick">✚ Chọn vị trí</button>
          <button class="mtr-btn" id="mtr-btn-reread" title="Đọc lại từ vừa đọc (phím R)">🔁 Đọc lại</button>
          <button class="mtr-btn danger" id="mtr-btn-clear">🗑 Xoá tất cả</button>
        </div>
        <div class="mtr-divider"></div>
        <div style="font-size:11px;color:#94a3b8;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;">
          🔈 Thử nghiệm TTS
        </div>
        <div class="mtr-row" style="gap:6px;">
          <input id="mtr-test-input" type="text" placeholder="Nhập từ để thử..."
            style="flex:1;background:#1e293b;border:1px solid rgba(255,255,255,0.08);border-radius:8px;
            color:#e2e8f0;font-size:12px;padding:6px 10px;outline:none;font-family:inherit;">
          <button class="mtr-btn" id="mtr-btn-test">▶</button>
        </div>
        <div style="font-size:10px;color:#334155;text-align:center;margin-top:4px;">
          Kéo góc ↖ trên-trái để thay đổi kích thước
        </div>
      </div>
    `;
  }

  function renderSelectorList() {
    const list = document.getElementById('mtr-selector-list');
    if (!list) return;
    if (config.savedSelectors.length === 0) {
      list.innerHTML = '<div class="mtr-empty">Chưa có vị trí nào. Nhấn "+ Chọn vị trí" để thêm.</div>';
      return;
    }
    list.innerHTML = config.savedSelectors.map((s, i) => `
      <div class="mtr-selector-item" data-index="${i}">
        <div style="flex:1;min-width:0;">
          <div class="item-label">📌 ${s.label}</div>
          <div class="item-selector">${s.cssPath}</div>
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

  // ─── VOICE CACHE ─────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────
  // FIX #1 – WARM-UP ENGINE
  //
  // Vấn đề gốc: khi TTS chưa từng được gọi trong phiên này, trình
  // duyệt cần ~50–150ms để acquire audio hardware stream. Nếu gọi
  // speak() ngay lập tức, 50–150ms đầu tiên của audio bị drop →
  // nghe như mất nửa đầu từ.
  //
  // Giải pháp: khi voices sẵn sàng, phát một utterance volume=0,
  // rate=10 (siêu nhanh, không nghe thấy) để "warm up" audio pipeline.
  // Sau đó khi người dùng trigger TTS thật, hardware đã sẵn sàng.
  // ─────────────────────────────────────────────────────────────────
  function warmUpEngine() {
    if (engineWarmedUp) return;
    engineWarmedUp = true;
    // getVoicesReady() luôn resolve ngay (allVoicesCache đã có) khi gọi từ preWarmVoices
    getVoicesReady().then(voices => {
      const voice = getCachedVoice(voices, config.lang);
      const u = new SpeechSynthesisUtterance('\u00A0'); // non-breaking space – siêu ngắn
      u.volume = 0;   // hoàn toàn im lặng
      u.rate   = 10;  // tốc độ tối đa → xong trong <20ms
      u.lang   = config.lang;
      if (voice) u.voice = voice;
      try { window.speechSynthesis.speak(u); } catch (_) { /* bỏ qua nếu browser block */ }
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // FIX #2 – VOICE COUNT SỐ HIỂN THỊ SAI
  //
  // Vấn đề gốc 1: { once: true } chỉ bắt lần đầu tiên voiceschanged.
  // Chrome fire sự kiện này nhiều lần: đợt 1 là voices local, đợt 2
  // là voices online (Neural, Premium…). Dùng { once: true } → chỉ
  // thấy voices đợt 1 → số hiển thị thấp hơn thực tế.
  //
  // Vấn đề gốc 2: regex cũ xóa "Neural" / "Desktop" khỏi tên trước
  // khi tạo dedup-key → "Microsoft Mark Neural" và "Microsoft Mark"
  // bị merge thành 1 → mất voices, số hiển thị sai.
  // ─────────────────────────────────────────────────────────────────
  function preWarmVoices() {
    function syncVoices() {
      const raw = window.speechSynthesis.getVoices();
      if (!raw.length) return;
      const deduped = dedupeVoices(raw);
      // Chỉ cập nhật khi số lượng thực sự thay đổi (tránh re-render thừa)
      if (deduped.length === allVoicesCache?.length) return;
      allVoicesCache = deduped;
      invalidateVoiceCache();
      updateCacheStatus(true);
      warmUpEngine(); // prime audio hardware ngay khi voices ready
    }
    syncVoices(); // thử ngay (Firefox, Chrome load lần thứ 2+)
    // KHÔNG dùng { once: true } – Chrome fire voiceschanged nhiều lần theo batch
    window.speechSynthesis.addEventListener('voiceschanged', syncVoices);
  }

  function updateCacheStatus(ready) {
    const el    = document.getElementById('mtr-cache-status');
    const label = document.getElementById('mtr-cache-label');
    if (!el || !label) return;
    if (ready) { el.classList.add('ready'); label.textContent = `${allVoicesCache.length} voices sẵn sàng`; }
    else        { el.classList.remove('ready'); label.textContent = 'Đang tải voices...'; }
  }

  function getVoicesReady() {
    if (allVoicesCache?.length > 0) return Promise.resolve(allVoicesCache);
    return new Promise(resolve => {
      const v = window.speechSynthesis.getVoices();
      if (v.length > 0) {
        allVoicesCache = dedupeVoices(v);
        invalidateVoiceCache();
        resolve(allVoicesCache);
        return;
      }
      // Dùng named handler để removeEventListener được khi đã resolve
      function handler() {
        const voices = window.speechSynthesis.getVoices();
        if (!voices.length) return;
        allVoicesCache = dedupeVoices(voices);
        invalidateVoiceCache();
        window.speechSynthesis.removeEventListener('voiceschanged', handler);
        resolve(allVoicesCache);
      }
      window.speechSynthesis.addEventListener('voiceschanged', handler);
    });
  }

  function getCachedVoice(voices, lang) {
    if (voiceCache.has(lang)) return voiceCache.get(lang);
    const match =
      voices.find(v => v.lang === lang) ||
      voices.find(v => v.lang.startsWith(lang.split('-')[0])) ||
      null;
    voiceCache.set(lang, match);
    return match;
  }

  function dedupeVoices(voices) {
    const seen = new Set();
    return voices.filter(v => {
      // Dedup chỉ khi lang + name hoàn toàn giống nhau (true duplicates).
      // KHÔNG chuẩn hóa tên – giữ lại "Neural", "Enhanced", "Premium", "Desktop"
      // như các voice riêng biệt để tránh báo cáo sai số lượng.
      const key = `${v.lang}|${v.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function invalidateVoiceCache() { voiceCache.clear(); }

  // ─── KEEP-ALIVE ───────────────────────────────────────────────────
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
  function stopKeepAlive() { clearInterval(keepAliveTimer); keepAliveTimer = null; }

  let lastSpokenText = '';

  // ─────────────────────────────────────────────────────────────────
  // FIX: Hàm flush đảm bảo cancel() hoàn toàn xong trước speak().
  // ─────────────────────────────────────────────────────────────────
  async function flushSynthesis(myGen) {
    // Bước 1: delay tối thiểu sau cancel()
    await new Promise(r => setTimeout(r, 120));
    if (myGen !== speakGen) return false;

    // Bước 2: poll cho đến khi synthesis thực sự dừng
    const deadline = Date.now() + 600;
    while (window.speechSynthesis.speaking && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 30));
      if (myGen !== speakGen) return false;
    }
    return myGen === speakGen;
  }

  // ─────────────────────────────────────────────────────────────────
  // CORE TTS ENGINE
  // ─────────────────────────────────────────────────────────────────
  async function speak(text, force = false, _fromRepeat = false) {
    if (!config.enabled || !text?.trim()) return;
    text = text.trim();
    if (!force && text === lastSpokenText) return;

    if (!_fromRepeat) stopRepeatCycle();

    speakGen++;
    const myGen = speakGen;

    window.speechSynthesis.cancel();
    stopKeepAlive();

    const ok = await flushSynthesis(myGen);
    if (!ok) return;

    const voices = await getVoicesReady();
    if (myGen !== speakGen) return;

    const voice = getCachedVoice(voices, config.lang);
    const fab = document.getElementById('mtr-fab');

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang   = config.lang;
    utter.rate   = parseFloat(config.rate);
    utter.pitch  = parseFloat(config.pitch);
    utter.volume = parseFloat(config.volume);
    if (voice) utter.voice = voice;

    utter.onstart = () => {
      if (myGen !== speakGen) return;
      fab?.classList.add('reading');
      startKeepAlive();
    };

    utter.onend = () => {
      if (myGen !== speakGen) return;
      fab?.classList.remove('reading');
      stopKeepAlive();
      lastSpokenText = text;
      scheduleNextRepeat(text);
    };

    utter.onerror = (e) => {
      if (myGen !== speakGen) return;
      fab?.classList.remove('reading');
      stopKeepAlive();
      if (e.error !== 'interrupted') {
        lastSpokenText = '';
        stopRepeatCycle();
      }
    };

    if (myGen !== speakGen) return;

    // ─────────────────────────────────────────────────────────────
    // FIX #1 (tiếp) – resume() ngay trước speak()
    //
    // Sau cancel(), engine có thể ở trạng thái "paused" nội bộ trên
    // một số trình duyệt/OS. Gọi resume() trước speak() đảm bảo
    // engine ở trạng thái "playing" sẵn sàng → không cắt đầu từ.
    // ─────────────────────────────────────────────────────────────
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(utter);
  }

  // ─── REPEAT CYCLE ────────────────────────────────────────────────
  let progressAnimFrame = null;
  let repeatStartTime   = 0;
  let repeatTotalMs     = 0;

  function scheduleNextRepeat(text) {
    if (config.repeatCount === 0 || repeatRemaining <= 0) { stopRepeatCycle(); return; }
    if (watchedText && text !== watchedText) { stopRepeatCycle(); return; }

    const fab = document.getElementById('mtr-fab');
    fab?.classList.add('repeating');
    updateRepeatBadge(repeatRemaining);
    showRepeatProgress(true);

    repeatStartTime = Date.now();
    repeatTotalMs   = config.repeatInterval * 1000;

    function animProgress() {
      const elapsed = Date.now() - repeatStartTime;
      const pct = Math.min((elapsed / repeatTotalMs) * 100, 100);
      const bar = document.getElementById('mtr-repeat-progress-bar');
      const txt = document.getElementById('mtr-repeat-progress-text');
      if (bar) bar.style.width = pct + '%';
      if (txt) {
        const rem = Math.max(0, repeatTotalMs - elapsed);
        txt.textContent = `còn ${rem < 1000 ? `${Math.round(rem)}ms` : `${Math.ceil(rem/1000)}s`} · lần ${repeatRemaining}`;
      }
      if (elapsed < repeatTotalMs) progressAnimFrame = requestAnimationFrame(animProgress);
    }
    cancelAnimationFrame(progressAnimFrame);
    progressAnimFrame = requestAnimationFrame(animProgress);

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

  function speakWithRepeat(text, force = false, _fromRepeat = false) {
    if (!_fromRepeat) {
      stopRepeatCycle();
      if (config.repeatCount > 0) {
        repeatRemaining   = config.repeatCount;
        repeatCurrentText = text;
      }
    }
    return speak(text, force, true);
  }

  function reReadLast() {
    if (lastSpokenText) {
      speakWithRepeat(lastSpokenText, true);
    } else {
      for (const s of config.savedSelectors) {
        const el = document.querySelector(s.cssPath);
        const text = el && (el.innerText || el.textContent || '').trim();
        if (text) { speakWithRepeat(text, true); showToast('🔁 Đọc lại: ' + text.slice(0, 30)); break; }
      }
    }
  }

  function readSelector(selectorObj) {
    const el = document.querySelector(selectorObj.cssPath);
    const text = el && (el.innerText || el.textContent || '').trim();
    if (text) {
      showToast(`🔊 Đọc: "${text.slice(0, 40)}"`);
      speakWithRepeat(text, true);
    } else {
      showToast(el ? '⚠️ Không tìm thấy nội dung' : '⚠️ Phần tử không còn trên trang');
    }
  }

  // ─── CSS PATH GENERATOR ──────────────────────────────────────────
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
    const text = (el.innerText || el.textContent || '').trim().slice(0, 30);
    const cls  = [...el.classList].slice(0, 2).join('.');
    return text || `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
  }

  // ─── PICK MODE ───────────────────────────────────────────────────
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
    if (highlightEl) { highlightEl.classList.remove('mtr-pick-highlight'); highlightEl = null; }
  }

  // ─── CHANGE DETECTION ────────────────────────────────────────────
  function getFirstSelectorText() {
    for (const s of config.savedSelectors) {
      const el = document.querySelector(s.cssPath);
      const text = el && (el.innerText || el.textContent || '').trim();
      if (text) return text;
    }
    return '';
  }

  function updateWatchedWordDisplay(text) {
    const el = document.getElementById('mtr-current-word');
    if (!el) return;
    if (text) { el.textContent = `"${text.slice(0, 40)}"`; el.classList.add('active'); }
    else      { el.textContent = '— chưa có từ —';          el.classList.remove('active'); }
  }

  function flashChangedFab() {
    const fab = document.getElementById('mtr-fab');
    if (!fab) return;
    fab.classList.remove('changed');
    void fab.offsetWidth;
    fab.classList.add('changed');
    setTimeout(() => fab.classList.remove('changed'), 600);
  }

  function handleMutationChange() {
    if (!config.enabled || !config.autoRead || config.savedSelectors.length === 0) return;
    const newText = getFirstSelectorText();
    if (!newText || newText === watchedText) return;
    watchedText = newText;
    updateWatchedWordDisplay(newText);
    flashChangedFab();
    clearTimeout(changeDetectTimer);
    changeDetectTimer = setTimeout(() => {
      const latestText = getFirstSelectorText();
      if (!latestText) return;
      if (latestText !== watchedText) { watchedText = latestText; updateWatchedWordDisplay(latestText); }
      speakWithRepeat(latestText, true);
    }, 100);
  }

  // ─── AUTO-READ ────────────────────────────────────────────────────
  function scheduleAutoRead() {
    if (!config.enabled || !config.autoRead) return;
    clearTimeout(autoReadTimer);
    autoReadTimer = setTimeout(() => {
      const text = getFirstSelectorText();
      if (text && text !== lastSpokenText) {
        watchedText = text;
        updateWatchedWordDisplay(text);
        setTimeout(() => speakWithRepeat(text), 300);
      }
    }, 600);
  }

  // ─── MUTATION OBSERVER ────────────────────────────────────────────
  const observer = new MutationObserver(() => handleMutationChange());
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  // ─── TOAST ───────────────────────────────────────────────────────
  let toastTimer;
  function showToast(msg) {
    const t = document.getElementById('mtr-toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ─── PANEL RESIZE ────────────────────────────────────────────────
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
      showToast(`📐 Kích thước: ${config.panelWidth}×${config.panelHeight}px`);
    });
  }

  // ─── INIT ─────────────────────────────────────────────────────────
  function init() {
    const { fab, panel } = createUI();
    renderSelectorList();
    preWarmVoices();
    initPanelResize(panel);

    // FAB click → toggle panel
    fab.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isPickingMode) { stopPickMode(); return; }
      panelOpen = !panelOpen;
      panel.classList.toggle('open', panelOpen);
      if (panelOpen) {
        updateCacheStatus(allVoicesCache?.length > 0);
        updateWatchedWordDisplay(watchedText || getFirstSelectorText());
      }
    });

    // FAB double-click → bật/tắt nhanh
    fab.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      config.enabled = !config.enabled;
      saveConfig();
      fab.classList.toggle('disabled', !config.enabled);
      document.getElementById('mtr-toggle-enabled').checked = config.enabled;
      showToast(config.enabled ? '🔊 TTS đã bật' : '🔇 TTS đã tắt');
      if (!config.enabled) { window.speechSynthesis.cancel(); stopRepeatCycle(); stopKeepAlive(); }
    });

    // Đóng panel khi click ngoài
    document.addEventListener('click', (e) => {
      if (!panel.contains(e.target) && e.target !== fab && !isPickingMode) {
        panelOpen = false;
        panel.classList.remove('open');
      }
    });

    document.getElementById('mtr-toggle-enabled').addEventListener('change', function () {
      config.enabled = this.checked;
      saveConfig();
      fab.classList.toggle('disabled', !config.enabled);
      if (!config.enabled) { window.speechSynthesis.cancel(); stopRepeatCycle(); stopKeepAlive(); }
      showToast(config.enabled ? '🔊 TTS đã bật' : '🔇 TTS đã tắt');
    });

    document.getElementById('mtr-toggle-auto').addEventListener('change', function () {
      config.autoRead = this.checked;
      saveConfig();
      showToast(config.autoRead ? '⚡ Tự đọc đã bật' : '⏸ Tự đọc đã tắt');
    });

    document.getElementById('mtr-lang').addEventListener('change', function () {
      config.lang = this.value;
      saveConfig();
      invalidateVoiceCache();
      // Re-warm engine cho voice mới
      engineWarmedUp = false;
      warmUpEngine();
      showToast(`🌐 Ngôn ngữ: ${this.options[this.selectedIndex].text}`);
    });

    document.getElementById('mtr-rate').addEventListener('input', function () {
      config.rate = parseFloat(this.value);
      document.getElementById('mtr-rate-val').textContent = config.rate + 'x';
      saveConfig();
    });

    document.getElementById('mtr-pitch').addEventListener('input', function () {
      config.pitch = parseFloat(this.value);
      document.getElementById('mtr-pitch-val').textContent = config.pitch;
      saveConfig();
    });

    document.getElementById('mtr-repeat-count').addEventListener('change', function () {
      const val = Math.max(0, Math.min(20, parseInt(this.value) || 0));
      this.value = val;
      config.repeatCount = val;
      saveConfig();
      showToast(val === 0 ? '🔁 Lặp lại đã tắt' : `🔁 Sẽ lặp thêm ${val} lần`);
    });

    document.getElementById('mtr-repeat-interval').addEventListener('change', function () {
      const val = Math.max(0.1, Math.min(60, parseFloat(this.value) || 3));
      this.value = val;
      config.repeatInterval = val;
      saveConfig();
      showToast(`⏱ Khoảng cách: ${val}s`);
    });

    document.getElementById('mtr-btn-stop-repeat').addEventListener('click', () => {
      speakGen++;
      window.speechSynthesis.cancel();
      stopRepeatCycle();
      stopKeepAlive();
      showToast('⏹ Đã dừng lặp lại');
    });

    document.getElementById('mtr-btn-test').addEventListener('click', () => {
      const val = document.getElementById('mtr-test-input').value;
      if (val.trim()) speakWithRepeat(val.trim(), true);
      else showToast('⚠️ Nhập từ cần thử trước');
    });

    document.getElementById('mtr-test-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.value.trim()) speakWithRepeat(e.target.value.trim(), true);
    });

    document.getElementById('mtr-btn-reread').addEventListener('click', () => {
      reReadLast();
      showToast('🔁 Đọc lại...');
    });

    document.getElementById('mtr-btn-clear').addEventListener('click', () => {
      if (!config.savedSelectors.length) { showToast('Chưa có vị trí nào để xoá'); return; }
      config.savedSelectors = [];
      saveConfig();
      renderSelectorList();
      showToast('🗑 Đã xoá tất cả vị trí');
    });

    document.getElementById('mtr-btn-pick').addEventListener('click', (e) => {
      e.stopPropagation();
      if (isPickingMode) stopPickMode();
      else { startPickMode(); panelOpen = false; panel.classList.remove('open'); }
    });

    document.addEventListener('mouseover', (e) => {
      if (!isPickingMode) return;
      if (e.target.closest('#mtr-panel') || e.target === fab) return;
      clearHighlight();
      highlightEl = e.target;
      highlightEl.classList.add('mtr-pick-highlight');
    });

    document.addEventListener('mouseout', (e) => {
      if (!isPickingMode) return;
      if (e.target === highlightEl) e.target.classList.remove('mtr-pick-highlight');
    });

    document.addEventListener('click', (e) => {
      if (!isPickingMode) return;
      if (e.target.closest('#mtr-panel') || e.target === fab) return;
      e.preventDefault();
      e.stopPropagation();

      const target  = e.target;
      const cssPath = getCSSPath(target);
      const label   = getLabelFromEl(target);
      const text    = (target.innerText || target.textContent || '').trim();

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

    document.addEventListener('keydown', (e) => {
      if (e.key === 'r' && !e.altKey && !e.ctrlKey && document.activeElement.tagName !== 'INPUT') {
        reReadLast();
        showToast('🔁 Đọc lại...');
        return;
      }
      if (e.altKey && e.key === 's') {
        config.enabled = !config.enabled;
        saveConfig();
        fab.classList.toggle('disabled', !config.enabled);
        showToast(config.enabled ? '🔊 TTS đã bật' : '🔇 TTS đã tắt');
      }
      if (e.altKey && e.key === 'x') {
        speakGen++;
        window.speechSynthesis.cancel();
        stopRepeatCycle();
        stopKeepAlive();
        showToast('⏹ Đã dừng (Alt+X)');
      }
      if (e.key === 'Escape' && isPickingMode) stopPickMode();
    });

    setTimeout(scheduleAutoRead, 1500);
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);

})();
