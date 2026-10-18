// Shim.js — injected by spw-folia-host BEFORE any Folia page script. Implements protocol v1 §3.
//
// Folia's production OBS browser-source page (src/components/obs/ObsBrowserSourceApp.tsx) reads an
// SSE stream (/obs/events: config / clock / audio) and renders the real VisualizerRenderer. We
// replace EventSource with an in-memory implementation so the page can run with no HTTP server and
// no network: the host pushes JSON over window.chrome.webview instead.
//
// Responsibilities
//   1. FakeEventSource -> translates host messages into the exact SSE payloads the page expects.
//   2. window.__SPW_FOLIA__ bridge per docs/protocol.md §3.3 (settings / lyrics / track / state /
//      audio / config inputs, settings emit, pushConfig, requestClose).
//   3. Diagnostics: page errors, console errors, rAF FPS/heap, key events -> host.
(function () {
  'use strict';
  if (window.__SPW_FOLIA_SHIM__) return;
  window.__SPW_FOLIA_SHIM__ = true;

  var PROTOCOL = 1;
  var listeners = {};
  var lastEvents = {};           // last SSE payload per event name
  var lastConfig = null;
  var lastClock = null;
  var lastFps = 0;
  var sources = [];
  var settings = {};
  var inputs = { state: null, lyrics: null, track: null, audio: null, hello: null, beat: null, ui: null };
  var lastClockSentAt = 0;

  function post(msg) {
    try { window.chrome.webview.postMessage(msg); } catch (e) { }
  }

  function emitLocal(type, payload) {
    var list = listeners[type];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      try { list[i](payload); } catch (e) { console.error('[spw-folia] listener error', type, (e && e.stack) ? e.stack : e); }
    }
  }

  // Surface page errors / console errors to the host so integration failures are diagnosable.
  // Settings-overlay ownership (docs/protocol.md §7.5): the injected settings UI owns the panel and
  // exposes open/close/toggle/isOpen. The host only forwards commands through window.__SPW_FOLIA__.ui;
  // it never inspects or controls the panel itself.
  function settingsUi() { return window.__SPW_FOLIA_SETTINGS_UI__ || window.__SPW_FOLIA_UI__ || null; }
  function isSettingsOpen() {
    var ui = settingsUi();
    try { return !!(ui && typeof ui.isOpen === 'function' && ui.isOpen()); } catch (e) { return false; }
  }
  function callSettingsUi(method) {
    var ui = settingsUi();
    if (!ui || typeof ui[method] !== 'function') return false;
    try { ui[method](); return true; } catch (e) { console.error('[spw-folia] settings ' + method, e); return false; }
  }
  function applyUiAction(action) {
    if (action === 'open-settings') callSettingsUi('open');
    else if (action === 'close-settings') callSettingsUi('close');
    else if (action === 'toggle-settings') callSettingsUi('toggle');
  }

  window.addEventListener('error', function (e) {
    post({ type: 'log', level: 'error', msg: 'js: ' + String((e && (e.message || e.error)) || 'unknown') + ' @ ' + String((e && e.filename) || '') + ':' + ((e && e.lineno) || 0) });
  });
  window.addEventListener('unhandledrejection', function (e) {
    post({ type: 'log', level: 'error', msg: 'rejection: ' + String((e && e.reason) || 'unknown') });
  });
  (function () {
    var orig = console.error;
    if (!orig) return;
    console.error = function () {
      try {
        var parts = [];
        for (var i = 0; i < arguments.length && i < 6; i++) parts.push(String(arguments[i]));
        post({ type: 'log', level: 'error', msg: 'console: ' + parts.join(' ').slice(0, 500) });
      } catch (e) { }
      return orig.apply(console, arguments);
    };
  })();

  // ---------------------------------------------------------------- SSE emulation

  function dispatch(src, name, data) {
    var list = src.__listeners[name];
    if (!list || !list.length) return;
    // Real EventSource hands the listener a MessageEvent whose .data is a JSON *string*; Folia's
    // ObsBrowserSourceApp does JSON.parse(event.data). Serialize here (never hand it a raw object).
    var text;
    try { text = JSON.stringify(data); } catch (err) { return; }
    var ev = { type: name, data: text };
    for (var i = 0; i < list.length; i++) {
      try { list[i].call(src, ev); } catch (err) { console.error('[spw-folia] SSE listener error', name, err); }
    }
  }

  function deliver(name, data) {
    lastEvents[name] = data;
    if (name === 'config') lastConfig = data;
    if (name === 'clock') lastClock = data;
    for (var i = 0; i < sources.length; i++) dispatch(sources[i], name, data);
  }

  function FakeEventSource(url) {
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onerror = null;
    this.onmessage = null;
    this.__listeners = {};
    sources.push(this);
    var self = this;
    setTimeout(function () {
      self.readyState = 1;
      try { if (self.onopen) self.onopen({ type: 'open' }); } catch (e) { }
      var names = Object.keys(lastEvents);
      for (var i = 0; i < names.length; i++) dispatch(self, names[i], lastEvents[names[i]]);
      post({ type: 'log', level: 'info', msg: 'eventsource-open ' + self.url });
    }, 0);
  }
  FakeEventSource.CONNECTING = 0;
  FakeEventSource.OPEN = 1;
  FakeEventSource.CLOSED = 2;
  FakeEventSource.prototype.addEventListener = function (name, fn) {
    var list = this.__listeners[name] || (this.__listeners[name] = []);
    if (list.indexOf(fn) < 0) list.push(fn);
    if (Object.prototype.hasOwnProperty.call(lastEvents, name)) {
      var self = this;
      var data = lastEvents[name];
      setTimeout(function () { dispatch(self, name, data); }, 0);
    }
  };
  FakeEventSource.prototype.removeEventListener = function (name, fn) {
    var list = this.__listeners[name];
    if (!list) return;
    var idx = list.indexOf(fn);
    if (idx >= 0) list.splice(idx, 1);
  };
  FakeEventSource.prototype.close = function () { this.readyState = 2; };
  window.EventSource = FakeEventSource;

  // ---------------------------------------------------------------- payload translation

  var ZERO_BANDS = { bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0 };

  // state -> ObsBrowserSourceClock (page interpolates from sentAtMs + playbackRate)
  function toClock(state) {
    return {
      currentTime: (state.posMs || 0) / 1000,
      duration: (state.durationMs || 0) / 1000,
      playerState: state.playing === false ? 'PAUSED' : 'PLAYING',
      sentAtMs: Date.now(),
      playbackRate: typeof state.rate === 'number' ? state.rate : 1,
      lyricOffsetMs: (state.lyricOffsetMs || 0) / 1000
    };
  }

  // audio -> ObsBrowserSourceAudio. Values are already the Folia 0..255 gamma-shaped scale
  // (see docs/protocol.md §5), spectrum is a 0..255 byte array (1024 bins).
  function toAudio(msg) {
    var bands = msg.bands;
    if (bands && Object.prototype.toString.call(bands) === '[object Array]') {
      bands = { bass: bands[0] || 0, lowMid: bands[1] || 0, mid: bands[2] || 0, vocal: bands[3] || 0, treble: bands[4] || 0 };
    } else if (!bands) {
      bands = {
        bass: msg.bass || 0, lowMid: msg.lowMid || 0, mid: msg.mid || 0,
        vocal: msg.vocal || 0, treble: msg.treble || 0
      };
    }
    var spectrum = msg.spectrum;
    if (spectrum && Object.prototype.toString.call(spectrum) === '[object Array]') {
      var bytes = new Uint8Array(spectrum.length);
      for (var i = 0; i < spectrum.length; i++) {
        var v = spectrum[i] | 0;
        bytes[i] = v < 0 ? 0 : (v > 255 ? 255 : v);
      }
      spectrum = bytes;
    } else if (!spectrum) {
      spectrum = new Uint8Array(0);
    }
    return {
      audioPower: typeof msg.power === 'number' ? msg.power : (msg.audioPower || 0),
      bands: bands || ZERO_BANDS,
      spectrum: spectrum,
      sentAtMs: Date.now()
    };
  }

  function clockThrottled(force) {
    var now = Date.now();
    if (!force && now - lastClockSentAt < 250) return false;
    lastClockSentAt = now;
    return true;
  }

  // ---------------------------------------------------------------- host -> page

  window.chrome.webview.addEventListener('message', function (e) {
    var msg = e.data;
    if (typeof msg === 'string') {
      try { msg = JSON.parse(msg); } catch (err) { return; }
    }
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'hello':
        inputs.hello = msg;
        emitLocal('hello', msg);
        break;
      case 'settings':
        settings = msg.settings || {};
        emitLocal('settings', settings);
        break;
      case 'state':
        inputs.state = msg;
        if (clockThrottled(!lastClock || msg.playing !== lastClock.__playing)) {
          deliver('clock', toClock(msg));
          lastClock.__playing = msg.playing;
        }
        emitLocal('state', msg);
        break;
      case 'lyrics':
        inputs.lyrics = msg;
        emitLocal('lyrics', msg);
        break;
      case 'track':
        inputs.track = msg;
        emitLocal('track', msg);
        break;
      case 'audio':
        inputs.audio = msg;
        deliver('audio', toAudio(msg));
        emitLocal('audio', msg);
        break;
      case 'config':
        deliver('config', msg.config);
        break;
      case 'ui':
        inputs.ui = msg;
        applyUiAction(msg.action);
        emitLocal('ui', msg);
        break;
      case 'beat':
        inputs.beat = msg;
        emitLocal('beat', msg);
        if (window.__SPW_FOLIA_BEAT__ && window.__SPW_FOLIA_BEAT__.onBeat) {
          try { window.__SPW_FOLIA_BEAT__.onBeat(msg); } catch (err) { console.error('[spw-folia] beat handler', err); }
        }
        break;
    }
  });

  // ---------------------------------------------------------------- public bridge (§3.3)

  window.__SPW_FOLIA__ = {
    protocol: PROTOCOL,
    version: '1.0',
    on: function (type, fn) {
      var list = listeners[type] || (listeners[type] = []);
      if (list.indexOf(fn) < 0) list.push(fn);
    },
    off: function (type, fn) {
      var list = listeners[type];
      if (!list) return;
      var idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    },
    emit: function (type, payload) {
      if (type === 'settings') post({ type: 'settings', settings: payload });
      else if (type === 'action') post({ type: 'action', name: (payload && payload.name) || payload });
      else if (type === 'log') post({ type: 'log', level: (payload && payload.level) || 'info', msg: (payload && payload.msg) || '' });
      else post({ type: type, payload: payload });
      emitLocal(type, payload);
    },
    pushConfig: function (config) {
      if (!config) return;
      lastConfig = config;
      deliver('config', config);
    },
    getSettings: function () { return settings; },
    setSettings: function (partial) {
      if (!partial) return settings;
      for (var k in partial) if (Object.prototype.hasOwnProperty.call(partial, k)) settings[k] = partial[k];
      post({ type: 'settings', settings: settings });
      emitLocal('settings', settings);
      return settings;
    },
    requestClose: function () { post({ type: 'action', name: 'close' }); },
    openSettings: function () { applyUiAction('open-settings'); emitLocal('ui', { action: 'open-settings' }); },
    closeSettings: function () { applyUiAction('close-settings'); emitLocal('ui', { action: 'close-settings' }); },
    toggleSettings: function () { applyUiAction('toggle-settings'); emitLocal('ui', { action: 'toggle-settings' }); },
    ui: {
      isSettingsOpen: isSettingsOpen,
      openSettings: function () { applyUiAction('open-settings'); emitLocal('ui', { action: 'open-settings' }); },
      closeSettings: function () { applyUiAction('close-settings'); emitLocal('ui', { action: 'close-settings' }); },
      toggleSettings: function () { applyUiAction('toggle-settings'); emitLocal('ui', { action: 'toggle-settings' }); }
    },
    getStats: function () {
      return { fps: lastFps, longFrames: longFrames, atMs: Math.round(performance.now()), href: location.href };
    },
    inputs: inputs,
    lastConfig: function () { return lastConfig; },
    lastClock: function () { return lastClock; }
  };

  document.addEventListener('keydown', function (e) {
    if (!e || !e.key) return;
    // Docs/protocol.md §7.5: the settings UI owns ESC while its overlay is open (it handles the key
    // in its own capture listener and stops propagation). The shim must not swallow/duplicate it:
    // when the overlay is open we do nothing here; a second ESC (overlay closed) reaches the host,
    // which closes the window with reason "user".
    if (e.key === 'Escape' && isSettingsOpen()) return;
    post({ type: 'key', key: e.key, ctrl: !!e.ctrlKey, alt: !!e.altKey, shift: !!e.shiftKey });
    // F1 is the agreed open/close trigger, routed through the same ui actions the host uses.
    if (e.key === 'F1') {
      applyUiAction('toggle-settings');
      emitLocal('ui', { action: 'toggle-settings' });
      e.preventDefault();
    }
  }, true);

  // ---------------------------------------------------------------- rAF metrics

  var frames = 0;
  var windowStart = 0;
  var lastFrame = 0;
  var longFrames = 0;
  function tick(t) {
    if (!windowStart) { windowStart = t; lastFrame = t; }
    frames += 1;
    if (lastFrame && t - lastFrame > 25) longFrames += 1;
    lastFrame = t;
    var elapsed = t - windowStart;
    if (elapsed >= 1000) {
      var fps = frames * 1000.0 / elapsed;
      lastFps = Math.round(fps * 10) / 10;
      var heapMB = null;
      if (performance.memory) heapMB = Math.round(performance.memory.usedJSHeapSize / 104857.6) / 10;
      post({
        type: 'fps',
        fps: lastFps,
        longFrames: longFrames,
        heapMB: heapMB,
        canvases: document.querySelectorAll('canvas').length,
        dpr: window.devicePixelRatio,
        w: window.innerWidth,
        h: window.innerHeight,
        atMs: Math.round(t)
      });
      frames = 0;
      windowStart = t;
      longFrames = 0;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  post({ type: 'ready', source: 'shim', protocol: PROTOCOL, href: window.location.href });
})();
