// PLACEHOLDER settings overlay injected into Folia's OBS page alongside the shim.
// Purpose: prove the "second injected script" surface the plugin will use for its real settings UI
// (folia-spec builds the real one). It computes a new ObsBrowserSourceConfig in-page and hands it
// to the shim via window.__SPW_FOLIA__.pushConfig(), exactly like the production UI will.
//
// Controls: C settings panel, ArrowLeft/ArrowRight previous/next style, D daylight toggle,
//           H hint. The host maps its `settings` stdin command to __SPW_FOLIA_OVERLAY__.toggle().
(function () {
  'use strict';
  if (window.__SPW_FOLIA_OVERLAY__) return;

  var MODES = [
    'sonnet', 'tempera', 'lumiere', 'fume', 'monet', 'pendolo', 'cappella', 'partita',
    'claddagh', 'cadenza', 'diorama', 'tilt', 'still', 'window', 'classic'
  ];

  function el(tag, style, text) {
    var node = document.createElement(tag);
    if (style) node.style.cssText = style;
    if (text != null) node.textContent = text;
    return node;
  }

  var root = el('div', [
    'position:fixed', 'right:18px', 'bottom:18px', 'z-index:2147483000',
    'display:flex', 'flex-direction:column', 'align-items:flex-end', 'gap:8px',
    'font:12px/1.45 Consolas,"Microsoft YaHei",monospace', 'color:#d4d4d8',
    'pointer-events:none', 'user-select:none'
  ].join(';'));

  var hint = el('div', [
    'background:rgba(9,9,11,.72)', 'border:1px solid rgba(244,244,245,.18)',
    'border-radius:6px', 'padding:7px 10px', 'letter-spacing:.4px',
    'transition:opacity .6s', 'opacity:1'
  ].join(';'), 'C  settings    ← →  style    D  daylight    ESC  close');

  var panel = el('div', [
    'background:rgba(9,9,11,.86)', 'border:1px solid rgba(244,244,245,.22)',
    'border-radius:8px', 'padding:12px 14px', 'min-width:236px',
    'display:none', 'backdrop-filter:blur(6px)', 'pointer-events:auto'
  ].join(';'));

  var title = el('div', 'font-weight:600;letter-spacing:1px;margin-bottom:8px;color:#e4e4e7', 'SPW FOLIA · placeholder settings');
  panel.appendChild(title);

  var modeLabel = el('div', 'margin-bottom:4px;color:#a1a1aa', 'visualizerMode: sonnet');
  panel.appendChild(modeLabel);

  var grid = el('div', 'display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:8px');
  var buttons = [];
  for (var i = 0; i < MODES.length; i++) {
    (function (mode) {
      var b = el('button', [
        'font:inherit', 'color:#d4d4d8', 'background:rgba(255,255,255,.06)',
        'border:1px solid rgba(255,255,255,.12)', 'border-radius:4px',
        'padding:3px 6px', 'cursor:pointer', 'text-align:left'
      ].join(';'), mode);
      b.onclick = function () { setMode(mode); };
      buttons.push(b);
      grid.appendChild(b);
    })(MODES[i]);
  }
  panel.appendChild(grid);

  var footer = el('div', 'display:flex;gap:8px;align-items:center');
  var dayButton = el('button', [
    'font:inherit', 'color:#d4d4d8', 'background:rgba(255,255,255,.06)',
    'border:1px solid rgba(255,255,255,.12)', 'border-radius:4px', 'padding:3px 8px', 'cursor:pointer'
  ].join(';'), 'daylight: off');
  dayButton.onclick = function () { toggleDaylight(); };
  footer.appendChild(dayButton);
  panel.appendChild(footer);

  root.appendChild(hint);
  root.appendChild(panel);

  function mount() {
    if (!document.body) { setTimeout(mount, 30); return; }
    document.body.appendChild(root);
    refresh();
    setTimeout(function () { hint.style.opacity = '0'; }, 5000);
  }

  function cfg() {
    return (window.__SPW_FOLIA__ && window.__SPW_FOLIA__.getLastConfig()) || null;
  }

  function push(patch) {
    var current = cfg();
    if (!current) return false;
    var next = {};
    var k;
    for (k in current) if (Object.prototype.hasOwnProperty.call(current, k)) next[k] = current[k];
    for (k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) next[k] = patch[k];
    if (window.__SPW_FOLIA__ && window.__SPW_FOLIA__.pushConfig) window.__SPW_FOLIA__.pushConfig(next);
    refresh();
    return true;
  }

  function refresh() {
    var current = cfg();
    var mode = (current && current.visualizerMode) || '?';
    modeLabel.textContent = 'visualizerMode: ' + mode;
    for (var i = 0; i < buttons.length; i++) {
      var active = buttons[i].textContent === mode;
      buttons[i].style.background = active ? 'rgba(113,113,122,.55)' : 'rgba(255,255,255,.06)';
      buttons[i].style.color = active ? '#fafafa' : '#d4d4d8';
    }
    dayButton.textContent = 'daylight: ' + (current && current.isDaylight ? 'on' : 'off');
  }

  function setMode(mode) {
    push({ visualizerMode: mode });
    if (window.__SPW_FOLIA__ && window.__SPW_FOLIA__.getStats) { /* no-op */ }
  }

  function currentMode() {
    var current = cfg();
    return (current && current.visualizerMode) || MODES[0];
  }

  function stepMode(delta) {
    var idx = MODES.indexOf(currentMode());
    if (idx < 0) idx = 0;
    idx = (idx + delta + MODES.length) % MODES.length;
    setMode(MODES[idx]);
  }

  function toggleDaylight() {
    var current = cfg();
    push({ isDaylight: !(current && current.isDaylight) });
  }

  var open = false;
  function toggle(force) {
    open = typeof force === 'boolean' ? force : !open;
    panel.style.display = open ? 'block' : 'none';
    hint.style.opacity = open ? '0' : '';
    if (!open) hint.style.opacity = '0';
    refresh();
    return open;
  }

  document.addEventListener('keydown', function (e) {
    if (!e || e.ctrlKey || e.altKey) return;
    var k = e.key;
    if (k === 'c' || k === 'C') { toggle(); e.preventDefault(); }
    else if (k === 'd' || k === 'D') { toggleDaylight(); e.preventDefault(); }
    else if (k === 'h' || k === 'H') { hint.style.opacity = hint.style.opacity === '0' ? '1' : '0'; e.preventDefault(); }
    else if (k === 'ArrowRight') { if (open) { stepMode(1); e.preventDefault(); } }
    else if (k === 'ArrowLeft') { if (open) { stepMode(-1); e.preventDefault(); } }
  }, true);

  window.__SPW_FOLIA_OVERLAY__ = {
    version: '1.0-spike',
    toggle: toggle,
    show: function () { return toggle(true); },
    hide: function () { return toggle(false); },
    setMode: setMode,
    isOpen: function () { return open; },
    modes: MODES.slice()
  };

  mount();
})();
