// PreviewShim.js — child-frame shim for the settings-page live preview (docs/live-preview-iframe.md).
//
// The settings overlay (top document) embeds `preview.html?obs=1&preview=1` in a same-origin iframe.
// That iframe runs Folia's real OBS browser-source page (ObsBrowserSourceApp -> VisualizerRenderer),
// but `window.chrome.webview` only exists in the top document, so clock/audio are synthesized here
// and `config` is forwarded from the parent via postMessage. This script must be a classic script
// loaded in <head> BEFORE the page's deferred module entry, so `window.EventSource` is already
// replaced by the time ObsBrowserSourceApp constructs its SSE client.
//
// Parent -> child (all messages carry __spwFoliaPreview: 1):
//   {kind:'config', payload: ObsBrowserSourceConfig}
//   {kind:'meta',   payload: {loopDuration, startOffset}}     seconds
//   {kind:'paused', payload: boolean}
// Child -> parent:
//   {kind:'ready', payload:{}}       retried at 0/100/300/1000/2000 ms until the first config
//   {kind:'error', payload:{message}} init failure (parent falls back to the static preview)
//   {kind:'stats', payload:{canvases, frames}}  ~1 Hz
//
// Motion synthesis mirrors src/components/visualizer/preview/useVisPlaygroundPreviewPlayback.ts:
// while playing, clock advances with rAF dt and wraps over loopDuration; audioPower/bands/spectrum
// are deterministic sine waves of the rAF timestamp. While paused the clock keeps being emitted as
// PLAYING? no: as PAUSED with a FROZEN currentTime (resolveObsBrowserSourceClockTime would keep
// extrapolating a PLAYING clock, which is why pausing must flip playerState instead of going silent).
(function () {
  'use strict';

  // Top-level documents are owned by the host's Shim.js; this shim only ever runs inside the iframe.
  if (window.top === window) return;
  if (window.__SPW_FOLIA_PREVIEW_SHIM__) return;
  window.__SPW_FOLIA_PREVIEW_SHIM__ = true;

  // ---- rAF gate (document_start, before ANY Folia module executes) --------------------------------
  // Pausing only the synthetic clock still leaves the Folia renderer's own rAF loop redrawing grain/
  // dither noise every frame, so a paused frame diff is nonzero. Wrap window.requestAnimationFrame so
  // that while paused nothing new is scheduled (callbacks are queued), then flush on resume. Our own
  // synthetic tick loop uses rawRaf so it keeps emitting the pinned PAUSED clock. Playing = passthrough.
  var rafNative = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : null;
  var rafQueue = [];               // callbacks queued while paused
  var rafGatePaused = false;
  if (rafNative) {
    window.requestAnimationFrame = function (cb) {
      if (!rafGatePaused) return rafNative(cb);
      rafQueue.push(cb);
      return 0;
    };
  }

  var DEFAULT_LOOP_SECONDS = 14.4;
  var SPECTRUM_BINS = 64;
  var READY_RETRIES_MS = [0, 100, 300, 1000, 2000];
  var CONFIG_TIMEOUT_MS = 4000;

  var lastEvents = {};        // last payload per SSE event name (late listeners get a replay)
  var listeners = [];         // {source, name, fn}
  var receivedConfig = false;
  var paused = false;
  var loopDuration = DEFAULT_LOOP_SECONDS;
  var startOffset = 0;
  var elapsed = 0;
  var lastTick = null;
  var lastPauseClock = 0;
  var frames = 0;
  var canvases = 0;
  var configTimer = null;
  var statsTimer = null;
  var readyTimers = [];

  // ---------------------------------------------------------------- diagnostics

  function postToParent(kind, payload) {
    try {
      window.parent.postMessage({ __spwFoliaPreview: 1, source: 'preview', kind: kind, payload: payload || {} }, '*');
    } catch (e) { }
  }

  window.addEventListener('error', function (e) {
    var stack = e && e.error && e.error.stack ? String(e.error.stack).replace(/\s+/g, ' ').slice(0, 2000) : '';
    postToParent('error', { message: 'js: ' + String((e && (e.message || e.error)) || 'unknown') + (stack ? ' | stack: ' + stack : '') });
  });
  window.addEventListener('unhandledrejection', function (e) {
    postToParent('error', { message: 'rejection: ' + String((e && e.reason) || 'unknown') });
  });

  // The acceptance eval reads window.__SPW_FOLIA_PREVIEW__.{receivedConfig,frames,canvases}.
  var summary = { receivedConfig: false, frames: 0, canvases: 0, paused: false, clockMs: 0, playerState: null, loopDuration: loopDuration, startOffset: startOffset, errors: 0 };
  window.__SPW_FOLIA_PREVIEW__ = summary;
  function refreshSummary() {
    summary.receivedConfig = receivedConfig;
    summary.frames = frames;
    summary.canvases = canvases;
    summary.paused = paused;
    summary.loopDuration = loopDuration;
    summary.startOffset = startOffset;
  }
  setInterval(refreshSummary, 250);

  // ---------------------------------------------------------------- SSE emulation

  // Folia's ObsBrowserSourceApp does JSON.parse(event.data); the .data value must be a JSON string.
  function dispatch(src, name, data) {
    var text;
    try { text = JSON.stringify(data); } catch (e) { return; }
    var ev = { type: name, data: text };
    for (var i = 0; i < listeners.length; i++) {
      var entry = listeners[i];
      if (entry.source !== src || entry.name !== name) continue;
      try { entry.fn.call(src, ev); } catch (e) { reportListenerError(name, e); }
    }
  }

  var listenerErrors = 0;
  function reportListenerError(name, e) {
    if (listenerErrors >= 20) return;   // a broken listener must not flood the parent
    listenerErrors++;
    summary.errors = listenerErrors;
    postToParent('error', { message: 'listener ' + name + ': ' + String((e && (e.stack || e)) || e) });
  }

  function deliver(name, data) {
    lastEvents[name] = data;
    for (var i = 0; i < sources.length; i++) dispatch(sources[i], name, data);
  }

  function replayTo(entry) {
    if (!Object.prototype.hasOwnProperty.call(lastEvents, entry.name)) return;
    var source = entry.source;
    var name = entry.name;
    var data = lastEvents[name];
    setTimeout(function () { dispatch(source, name, data); }, 0);
  }

  var sources = [];
  var FakeEventSource = function (url) {
    this.url = url;
    this.readyState = 0;
    this.onopen = null;
    this.onerror = null;
    this.onmessage = null;
    sources.push(this);
    var self = this;
    setTimeout(function () {
      self.readyState = 1;
      try { if (self.onopen) self.onopen({ type: 'open' }); } catch (e) { }
      var names = Object.keys(lastEvents);
      for (var i = 0; i < names.length; i++) dispatch(self, names[i], lastEvents[names[i]]);
    }, 0);
  };
  FakeEventSource.CONNECTING = 0;
  FakeEventSource.OPEN = 1;
  FakeEventSource.CLOSED = 2;
  FakeEventSource.prototype.addEventListener = function (name, fn) {
    if (typeof fn !== 'function') return;
    var entry = { source: this, name: name, fn: fn };
    listeners.push(entry);
    replayTo(entry);
  };
  FakeEventSource.prototype.removeEventListener = function (name, fn) {
    for (var i = listeners.length - 1; i >= 0; i--) {
      if (listeners[i].source === this && listeners[i].name === name && listeners[i].fn === fn) listeners.splice(i, 1);
    }
  };
  FakeEventSource.prototype.close = function () { this.readyState = 2; };
  window.EventSource = FakeEventSource;

  // ---------------------------------------------------------------- playback synthesis

  function wave(now, offset, speed, floor, amplitude) {
    return floor + (Math.sin(now * speed + offset) * 0.5 + 0.5) * amplitude;
  }

  function buildAudio(now) {
    var spectrum = new Array(SPECTRUM_BINS);
    for (var i = 0; i < SPECTRUM_BINS; i++) {
      var ni = i / Math.max(1, SPECTRUM_BINS - 1);
      var lowShape = Math.exp(-ni * 2.4);
      var harmonic = Math.sin(now * 0.0027 + ni * Math.PI * 3.4) * 0.18 + Math.sin(now * 0.0052 + ni * Math.PI * 11.5) * 0.08;
      var shimmer = Math.sin(now * 0.0018 + ni * Math.PI * 1.2) * 0.12;
      var amplitude = Math.max(0, Math.min(1, lowShape * 0.8 + 0.08 + harmonic + shimmer));
      spectrum[i] = Math.round(amplitude * 255);
    }
    return {
      audioPower: wave(now, 0.2, 0.0024, 0.16, 0.18),
      bands: {
        bass: wave(now, 0.9, 0.0032, 0.14, 0.2),
        lowMid: wave(now, 1.7, 0.0028, 0.12, 0.16),
        mid: wave(now, 2.6, 0.0023, 0.1, 0.14),
        vocal: wave(now, 3.4, 0.0038, 0.16, 0.22),
        treble: wave(now, 4.2, 0.0046, 0.08, 0.14)
      },
      spectrum: spectrum,
      sentAtMs: Date.now()
    };
  }

  function emitClock(nowMs, playerState) {
    // Expose the synthesized clock for acceptance evals: paused => clockMs stays pinned, so a probe can
    // assert |delta clockMs| over time instead of relying only on pixel diffs (Folia's grain noise is
    // clock-independent and would otherwise mask a genuinely frozen frame).
    summary.clockMs = elapsed * 1000;
    summary.playerState = playerState;
    deliver('clock', {
      currentTime: elapsed,
      duration: loopDuration,
      playerState: playerState,
      sentAtMs: nowMs,
      playbackRate: 1,
      lyricOffsetMs: 0
    });
  }

  function tick(now) {
    try {
      if (!paused) {
        var previous = lastTick === null ? now : lastTick;
        var dt = (now - previous) / 1000;
        if (!(dt >= 0) || dt > 1) dt = 0;      // tab throttling / first frame
        lastTick = now;
        elapsed = (elapsed + dt) % loopDuration;
        emitClock(Date.now(), 'PLAYING');
        deliver('audio', buildAudio(now));
      } else {
        lastTick = null;
        // A frozen PLAYING clock would be extrapolated by resolveObsBrowserSourceClockTime, so keep
        // sending clock but as PAUSED with currentTime pinned; ~4 Hz is plenty for a static frame.
        var realNow = Date.now();
        if (realNow - lastPauseClock >= 250) {
          lastPauseClock = realNow;
          emitClock(realNow, 'PAUSED');
        }
      }
      frames++;
    } catch (e) {
      reportListenerError('tick', e);
    }
    if (rafNative) rafNative(tick);
  }

  // ---------------------------------------------------------------- parent -> child

  function applyConfig(payload) {
    if (!payload || typeof payload !== 'object') return;
    receivedConfig = true;
    if (configTimer) { clearTimeout(configTimer); configTimer = null; }
    for (var i = 0; i < readyTimers.length; i++) clearTimeout(readyTimers[i]);
    readyTimers = [];
    deliver('config', payload);
  }

  function applyMeta(payload) {
    if (!payload || typeof payload !== 'object') return;
    var loop = Number(payload.loopDuration);
    if (isFinite(loop) && loop > 0) loopDuration = loop;
    var offset = Number(payload.startOffset);
    if (!isFinite(offset) || offset < 0) offset = 0;
    startOffset = offset;
    elapsed = startOffset;      // restart the synthetic timeline on loop/meta changes
    lastTick = null;
  }

  function applyPaused(value) {
    paused = !!value;
    if (rafGatePaused !== paused) {
      rafGatePaused = paused;
      if (!paused) {
        // Resume: re-submit every callback that was queued while paused (Folia's renderer loop and any
        // transition animations), then let future rAF calls pass through again.
        var queued = rafQueue;
        rafQueue = [];
        for (var qi = 0; qi < queued.length; qi++) {
          try { rafNative(queued[qi]); } catch (e) { }
        }
      }
    }
    if (!paused) lastTick = null;
    refreshSummary();
  }

  window.addEventListener('message', function (event) {
    var data = event && event.data;
    if (!data || typeof data !== 'object' || data.__spwFoliaPreview !== 1) return;
    var payload = data.payload !== undefined ? data.payload : data.value;
    if (data.kind === 'config') applyConfig(payload);
    else if (data.kind === 'meta') applyMeta(payload);
    else if (data.kind === 'paused') applyPaused(payload !== undefined ? payload : data.paused);
  });

  // ---------------------------------------------------------------- ready / timeout

  function postReady() {
    refreshSummary();
    postToParent('ready', { receivedConfig: receivedConfig });
  }
  for (var r = 0; r < READY_RETRIES_MS.length; r++) {
    readyTimers.push(setTimeout(postReady, READY_RETRIES_MS[r]));
  }
  configTimer = setTimeout(function () {
    if (receivedConfig) return;
    postToParent('error', { message: 'config-timeout after ' + CONFIG_TIMEOUT_MS + 'ms' });
  }, CONFIG_TIMEOUT_MS);

  statsTimer = setInterval(function () {
    try { canvases = document.querySelectorAll('canvas').length; } catch (e) { canvases = 0; }
    refreshSummary();
    postToParent('stats', { canvases: canvases, frames: frames });
  }, 1000);

  window.addEventListener('pagehide', function () {
    if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
  });

  // Kick off the synthetic timeline immediately: config may arrive before or after the page's module
  // entry, the replay in FakeEventSource covers late listeners. The first frames simply have no
  // listeners yet; they are cheap and keep elapsed monotonic from the iframe's creation.
  if (rafNative) rafNative(tick);
})();
