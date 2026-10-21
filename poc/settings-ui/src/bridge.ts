/* The page-side bridge. When injected by the host, `window.__SPW_FOLIA__` is the Shim's object and
 * every call is forwarded to the host; when opened directly (dev.html, screenshots) a fake bridge
 * answers with demo data and logs pushed configs. Protocol: docs/protocol.md §3. */
import type { ObsBrowserSourceConfig } from '@/types/obsBrowserSource';
import type { Theme } from '@/types';
import { useSettingsStore, snapshotFromState, applySnapshot, type SettingsSnapshot } from '~/model/settings';

export type BridgeEventType = 'hello' | 'settings' | 'state' | 'lyrics' | 'track' | 'audio' | 'config' | 'beat' | 'settingsUI' | 'queue';

export interface BridgeStateMessage {
    currentTime: number;
    duration: number;
    playerState: 'IDLE' | 'PLAYING' | 'PAUSED';
    sentAtMs: number;
    playbackRate?: number;
    lyricOffsetMs?: number;
}

export interface BridgeTrackMessage {
    id: string;
    title: string;
    artist?: string | null;
    album?: string | null;
    /** Preferred spelling (Folia's config type). */
    coverUrl?: string | null;
    /** The plugin/host also report the cover under this name; `bridgeTrackCover` accepts both. */
    coverDataUrl?: string | null;
    durationMs?: number;
    lyrics?: unknown;
}

/* v0.3.0: playback control channel (docs/protocol.md §3.1 `control` / §3.4). The page only asks;
 * the plugin is the control sink, the host just relays. */
export type PlaybackControlAction = 'toggle' | 'previous' | 'next' | 'seek' | 'shuffle' | 'queue-play';

export interface PlaybackControlExtra {
    /** `seek` target in milliseconds (clamped by the plugin). */
    positionMs?: number;
    /** `queue-play` row index. */
    index?: number;
    /** `queue-play`: play the random queue instead of the normal one. */
    random?: boolean;
}

export interface PlaybackControlPayload extends PlaybackControlExtra {
    action: PlaybackControlAction;
}

/** One row of the current playback queue (protocol §3.2 `queue`). */
export interface QueueItem {
    id: string;
    title: string;
    artist: string;
    album?: string;
}

/** Current queue snapshot: `random` selects the random queue and `index` points into `items`. */
export interface PlaybackQueueSnapshot {
    mode: 'circle' | 'circle-end' | 'repeat-one' | 'random';
    random: boolean;
    index: number;
    items: QueueItem[];
}

/** The cover can arrive as `coverUrl` (page/config naming) or `coverDataUrl` (plugin naming). */
export const bridgeTrackCover = (track: BridgeTrackMessage | null | undefined): string | null => {
    if (!track) return null;
    const value = track.coverUrl ?? track.coverDataUrl ?? null;
    return typeof value === 'string' && value.length > 0 ? value : null;
};

export interface SpwFoliaBridge {
    protocol?: number;
    on: (type: string, listener: (payload: never) => void) => (() => void) | void;
    emit: (type: string, payload?: unknown) => void;
    pushConfig: (config: ObsBrowserSourceConfig) => void;
    getSettings: () => unknown;
    setSettings: (partial: unknown) => void;
    requestClose?: () => void;
    inputs?: {
        state?: BridgeStateMessage | null;
        lyrics?: unknown;
        track?: BridgeTrackMessage | null;
        /** v0.3.0: last `queue` snapshot the host sent; may be absent on older shims. */
        queue?: PlaybackQueueSnapshot | null;
    };
    /** protocol §7.5: overlay-only settings control surface the host drives (no page reload). */
    ui?: SettingsUiApi;
}

export interface SettingsUiApi {
    isSettingsOpen: () => boolean;
    openSettings: () => void;
    closeSettings: () => void;
}

interface SettingsUiController {
    open: () => void;
    close: () => void;
    toggle: () => void;
    isOpen: () => boolean;
}

declare global {
    interface Window {
        __SPW_FOLIA__?: SpwFoliaBridge;
        __SPW_FOLIA_UI__?: SettingsUiController;
        __SPW_FOLIA_LAST_CONFIG__?: ObsBrowserSourceConfig;
        /** v0.3.0 dev-only: every `control` the page emitted, in order (fake bridge + verify scripts). */
        __SPW_FOLIA_TEST_CONTROLS__?: PlaybackControlPayload[];
    }
}

const listeners = new Map<string, Set<(payload: unknown) => void>>();

const emitLocally = (type: string, payload: unknown): void => {
    for (const listener of listeners.get(type) ?? []) {
        try {
            listener(payload);
        } catch (error) {
            console.error('[settings-ui] bridge listener failed', type, error);
        }
    }
};

/** Demo track so a directly opened page still builds a complete config. */
export const DEMO_TRACK: BridgeTrackMessage = {
    id: 'spike-song',
    title: 'Spike Track',
    artist: 'Folia',
    album: 'POC',
    coverUrl: null,
    lyrics: {
        lines: [
            { startMs: 0, endMs: 4000, main: '静かな夜に', sub: '在寂静的夜里' },
            { startMs: 4000, endMs: 8000, main: '光が満ちて', sub: '光芒洒满' },
            { startMs: 8000, endMs: 12000, main: '君の声が', sub: '你的声音' },
            { startMs: 12000, endMs: 16000, main: '遠くへ響く', sub: '响彻远方' },
        ],
    },
};

const DEMO_THEME: Theme = {
    name: 'Midnight Default',
    backgroundColor: '#09090b',
    primaryColor: '#f4f4f5',
    accentColor: '#f4f4f5',
    secondaryColor: '#71717a',
    fontStyle: 'sans',
    animationIntensity: 'normal',
};

const isInjected = (): boolean => typeof window.__SPW_FOLIA__ === 'object' && window.__SPW_FOLIA__ !== null;

let bridgeInstance: SpwFoliaBridge | null = null;

/* v0.3.0 · fake bridge playback model (dev.html only). It mirrors what the plugin/host send back:
 * a queue snapshot plus state/track events, so the playback HUD and the queue panel have real
 * feedback while clicking around without a host. */
const DEMO_QUEUE: QueueItem[] = [
    { id: DEMO_TRACK.id, title: DEMO_TRACK.title, artist: DEMO_TRACK.artist ?? 'Folia', album: DEMO_TRACK.album ?? undefined },
    { id: 'demo-02', title: '夜航星', artist: '不才', album: '夜航星' },
    { id: 'demo-03', title: '星间旅行 Interstellar Journey', artist: '知更鸟, HOYO-MiX' },
    { id: 'demo-04', title: 'Lemon', artist: '米津玄師', album: 'Lemon' },
    { id: 'demo-05', title: '花に亡霊', artist: 'ヨルシカ', album: '盗作' },
    { id: 'demo-06', title: '群青', artist: 'YOASOBI', album: 'THE BOOK' },
    { id: 'demo-07', title: '光るなら', artist: 'Goose house' },
];

const DEMO_DURATION_MS = 245_000;

interface FakePlaybackModel {
    index: number;
    playing: boolean;
    /** position at `atMs`; the clock is extrapolated lazily so no interval churns dev renders */
    positionMs: number;
    atMs: number;
    durationMs: number;
    mode: PlaybackQueueSnapshot['mode'];
}

const fakePlayback: FakePlaybackModel = {
    index: 0,
    playing: true,
    positionMs: 31_000,
    atMs: Date.now(),
    durationMs: DEMO_DURATION_MS,
    mode: 'circle',
};

const fakePosition = (): number => {
    const model = fakePlayback;
    const position = model.playing ? model.positionMs + (Date.now() - model.atMs) : model.positionMs;
    return Math.min(Math.max(0, position), model.durationMs);
};

const fakeQueueSnapshot = (): PlaybackQueueSnapshot => ({
    mode: fakePlayback.mode,
    random: fakePlayback.mode === 'random',
    index: fakePlayback.index,
    items: DEMO_QUEUE.map(item => ({ ...item })),
});

const updateFakeInputs = (patch: Partial<NonNullable<SpwFoliaBridge['inputs']>>): void => {
    if (!bridgeInstance) return;
    bridgeInstance.inputs = { ...(bridgeInstance.inputs ?? {}), ...patch };
};

const emitFakeState = (): void => {
    const posMs = Math.round(fakePosition());
    updateFakeInputs({
        state: {
            currentTime: posMs / 1000,
            duration: fakePlayback.durationMs / 1000,
            playerState: fakePlayback.playing ? 'PLAYING' : 'PAUSED',
            sentAtMs: Date.now(),
            playbackRate: 1,
        },
    });
    emitLocally('state', {
        posMs,
        durationMs: fakePlayback.durationMs,
        playing: fakePlayback.playing,
        rate: 1,
        tsMs: Date.now(),
    });
};

const emitFakeTrack = (): void => {
    const item = DEMO_QUEUE[fakePlayback.index] ?? DEMO_QUEUE[0];
    const payload: BridgeTrackMessage = {
        id: item.id,
        title: item.title,
        artist: item.artist,
        album: item.album ?? null,
        durationMs: fakePlayback.durationMs,
    };
    updateFakeInputs({ track: payload });
    emitLocally('track', payload);
};

const emitFakeQueue = (): void => {
    const snapshot = fakeQueueSnapshot();
    updateFakeInputs({ queue: snapshot });
    emitLocally('queue', snapshot);
};

/** Play the semantic meaning of every control the page sends, then push the resulting snapshot. */
const handleFakeControl = (raw: unknown): void => {
    const payload = (raw ?? {}) as Partial<PlaybackControlPayload>;
    const action = payload.action;
    if (!action) return;
    const record: PlaybackControlPayload = { action };
    if (typeof payload.positionMs === 'number') record.positionMs = payload.positionMs;
    if (typeof payload.index === 'number') record.index = payload.index;
    if (typeof payload.random === 'boolean') record.random = payload.random;
    window.__SPW_FOLIA_TEST_CONTROLS__ = window.__SPW_FOLIA_TEST_CONTROLS__ ?? [];
    window.__SPW_FOLIA_TEST_CONTROLS__.push(record);

    const model = fakePlayback;
    switch (action) {
        case 'toggle':
            model.positionMs = fakePosition();
            model.atMs = Date.now();
            model.playing = !model.playing;
            emitFakeState();
            break;
        case 'previous':
        case 'next': {
            const step = action === 'next' ? 1 : -1;
            model.index = (model.index + step + DEMO_QUEUE.length) % DEMO_QUEUE.length;
            model.positionMs = 0;
            model.atMs = Date.now();
            emitFakeTrack();
            emitFakeQueue();
            emitFakeState();
            break;
        }
        case 'seek':
            model.positionMs = Math.min(Math.max(0, record.positionMs ?? fakePosition()), model.durationMs);
            model.atMs = Date.now();
            emitFakeState();
            break;
        case 'shuffle':
            model.mode = model.mode === 'random' ? 'circle' : 'random';
            emitFakeQueue();
            break;
        case 'queue-play': {
            const index = record.index ?? model.index;
            if (index < 0 || index >= DEMO_QUEUE.length) return;
            model.index = index;
            model.positionMs = 0;
            model.atMs = Date.now();
            emitFakeTrack();
            emitFakeQueue();
            emitFakeState();
            break;
        }
        default:
            break;
    }
};

/** Fake bridge for running the bundle in a plain browser (`pnpm dev` → dev.html). */
const createFakeBridge = (): SpwFoliaBridge => {
    window.__SPW_FOLIA_TEST_CONTROLS__ = window.__SPW_FOLIA_TEST_CONTROLS__ ?? [];
    // Mirror the host replay order: state → track → queue (docs/playback-controls.md §3.1).
    window.setTimeout(() => {
        emitFakeTrack();
        emitFakeQueue();
        emitFakeState();
    }, 0);
    return {
        protocol: 1,
        on: (type, listener) => {
            const set = listeners.get(type) ?? new Set();
            set.add(listener as (payload: unknown) => void);
            listeners.set(type, set);
            return () => set.delete(listener as (payload: unknown) => void);
        },
        emit: (type, payload) => {
            // v0.3.0: `control` does not echo locally — the fake bridge plays the player's part.
            if (type === 'control') {
                handleFakeControl(payload);
                return;
            }
            emitLocally(type, payload);
        },
        pushConfig: config => {
            window.__SPW_FOLIA_LAST_CONFIG__ = config;
            console.info('[settings-ui] pushConfig', config);
        },
        getSettings: () => null,
        setSettings: partial => {
            console.info('[settings-ui] setSettings', partial);
        },
        requestClose: () => console.info('[settings-ui] requestClose'),
        inputs: { state: null, lyrics: null, track: DEMO_TRACK, queue: fakeQueueSnapshot() },
    };
};

export const getBridge = (): SpwFoliaBridge => {
    if (bridgeInstance) return bridgeInstance;
    if (!isInjected()) {
        // Dev harness parity: expose the fake bridge on the same global the host page provides so
        // scripts and the chrome contract (`__SPW_FOLIA__.ui`) behave identically in both contexts.
        bridgeInstance = createFakeBridge();
        window.__SPW_FOLIA__ = bridgeInstance;
        return bridgeInstance;
    }
    bridgeInstance = window.__SPW_FOLIA__ as SpwFoliaBridge;
    return bridgeInstance;
};

export const bridgeIsInjected = (): boolean => isInjected();

export const bridgeOn = <T,>(type: string, listener: (payload: T) => void): (() => void) => {
    const bridge = getBridge();
    const off = bridge.on(type, listener as never);
    return typeof off === 'function' ? off : () => emitLocally(`off:${type}`, null);
};

/** v0.3.0: page → player control request. The host relays it to the plugin on stdin; the page never
 *  mutates playback state itself, it waits for the echoed `state`/`queue` snapshots. */
export const sendPlaybackControl = (action: PlaybackControlAction, extra: PlaybackControlExtra = {}): void => {
    getBridge().emit('control', { action, ...extra });
};

/** Settings emits are throttled to <=10 Hz (protocol §3.3) and skipped entirely when the snapshot
 *  did not change. The host echoes every accepted `setSettings` back as a `settings` event, so an
 *  emit made from inside that echo would loop; `applyingRemote` guards against it. */
export const SETTINGS_EMIT_MIN_INTERVAL_MS = 100;

let applyingRemote = false;
let pendingSnapshot: SettingsSnapshot | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let lastEmitAt = 0;
let lastEmitJson = '';

const flushSettingsEmit = (): void => {
    const queued = pendingSnapshot;
    pendingSnapshot = null;
    if (!queued) return;
    lastEmitAt = Date.now();
    lastEmitJson = JSON.stringify(queued);
    getBridge().setSettings?.(queued);
};

const scheduleSettingsEmit = (snapshot: SettingsSnapshot, force = false): void => {
    const json = JSON.stringify(snapshot);
    if (!force && json === lastEmitJson) return;
    pendingSnapshot = snapshot;
    const wait = Math.max(0, SETTINGS_EMIT_MIN_INTERVAL_MS - (Date.now() - lastEmitAt));
    if (wait === 0) {
        if (pendingTimer) {
            clearTimeout(pendingTimer);
            pendingTimer = null;
        }
        flushSettingsEmit();
        return;
    }
    if (pendingTimer) return;
    pendingTimer = setTimeout(() => {
        pendingTimer = null;
        flushSettingsEmit();
    }, wait);
};

/** v0.2.0: `applySnapshot` drops the transparent window when the snapshot's style cannot render it
 *  (monet, or lumiere on a light cover). Remote snapshots are guarded by `applyingRemote`, so that
 *  correction would never be reported back and the host would keep the window keyed. Re-emit the
 *  corrected snapshot whenever the incoming one asked for transparency but the store ended up off. */
const emitBlockedTransparencyCorrection = (incoming: Partial<SettingsSnapshot> | null | undefined): void => {
    if (!incoming || incoming.transparentPlayerBackground !== true) return;
    const state = useSettingsStore.getState();
    if (state.transparentPlayerBackground) return;
    scheduleSettingsEmit(snapshotFromState(state), true);
};

/** v0.2.0: push the current store snapshot to the host even when it did not change. Needed when the
 *  host switched the window into colour-key mode on its own (the Ctrl+Alt+B hotkey path) and the
 *  selected style refuses that mode — the page has to tell the host to drop the key again. */
export const forceEmitSettings = (): void => {
    scheduleSettingsEmit(snapshotFromState(useSettingsStore.getState()), true);
};

/** Settings round trip: host pushes the persisted snapshot, the UI reports changes back (<=10 Hz). */
export const subscribeSettingsRoundTrip = (): (() => void) => {
    const bridge = getBridge();
    const incoming = bridge.getSettings?.();
    if (incoming && typeof incoming === 'object') {
        applySnapshot(incoming as Partial<SettingsSnapshot>);
        emitBlockedTransparencyCorrection(incoming as Partial<SettingsSnapshot>);
    }

    const off = bridgeOn<SettingsSnapshot>('settings', snapshot => {
        applyingRemote = true;
        try {
            applySnapshot(snapshot);
        } finally {
            applyingRemote = false;
        }
        emitBlockedTransparencyCorrection(snapshot);
    });

    lastEmitJson = JSON.stringify(snapshotFromState(useSettingsStore.getState()));
    const unsubscribe = useSettingsStore.subscribe(state => {
        if (applyingRemote) return;
        scheduleSettingsEmit(snapshotFromState(state));
    });

    // dev: let "save" buttons or the console drive settings too
    emitLocally('bridgeReady', { injected: isInjected() });
    return () => {
        off();
        unsubscribe();
        if (pendingTimer) {
            clearTimeout(pendingTimer);
            pendingTimer = null;
        }
        pendingSnapshot = null;
    };
};

/** The host drives the window through `window.__SPW_FOLIA_UI__` (ExecuteScriptAsync) or a
 *  `settingsUI` bridge event; the page never decides on its own to cover the stage.
 *
 *  The Shim in poc/webview/host/Shim.js emits the agreed contract as `ui` events with
 *  `action: 'toggle-settings' | 'open-settings' | 'close-settings'` (F1 / host `command`), and also
 *  calls `window.__SPW_FOLIA_SETTINGS_UI__` directly when it exists — both names are exposed here. */
const uiActionToCommand = (action: string | undefined): 'open' | 'close' | 'toggle' => {
    switch (action) {
        case 'open':
        case 'open-settings':
        case 'settings-open':
            return 'open';
        case 'close':
        case 'close-settings':
        case 'settings-close':
            return 'close';
        default:
            return 'toggle';
    }
};

export const registerSettingsUiController = (controls: { open: () => void; close: () => void }): (() => void) => {
    const controller: SettingsUiController = {
        open: controls.open,
        close: controls.close,
        toggle: () => (isSettingsUiOpen() ? controls.close() : controls.open()),
        isOpen: isSettingsUiOpen,
    };
    window.__SPW_FOLIA_UI__ = controller;
    window.__SPW_FOLIA_SETTINGS_UI__ = controller;
    // protocol §7.5: `__SPW_FOLIA__.ui` is the stable host-facing surface; the object is created by
    // Shim.js before this bundle runs, so the page augments it instead of replacing it.
    getBridge().ui = {
        isSettingsOpen: () => isSettingsUiOpen(),
        openSettings: () => controller.open(),
        closeSettings: () => controller.close(),
    };
    const offLocal = bridgeOn<{ action?: string }>('settingsUI', payload => {
        if (!payload?.action) return;
        const action = uiActionToCommand(payload?.action);
        if (action === 'open') controller.open();
        else if (action === 'close') controller.close();
        else controller.toggle();
    });
    const offShim = bridgeOn<{ action?: string }>('ui', payload => {
        const action = uiActionToCommand(payload?.action);
        if (action === 'open') controller.open();
        else if (action === 'close') controller.close();
        else controller.toggle();
    });
    return () => {
        offLocal();
        offShim();
    };
};

let openState = false;
export const setSettingsUiOpenState = (open: boolean): void => {
    if (openState === open) return;
    openState = open;
    // protocol §7.5: tell the host so it keeps the system cursor visible while the overlay is
    // open (the host hides the pointer after an idle period in fullscreen mode). Post straight to
    // the WebView2 channel: routing this through `__SPW_FOLIA__.emit` would echo it back into the
    // page's own 'ui' listener and make the panel toggle forever.
    const post = (window as unknown as {
        chrome?: { webview?: { postMessage: (message: unknown) => void } };
    }).chrome?.webview?.postMessage;
    if (typeof post === 'function') {
        try {
            post({ type: 'settingsUI', state: open ? 'open' : 'closed' });
        } catch (error) {
            console.warn('[spw-folia] failed to report settings ui state', error);
        }
    }
};
const isSettingsUiOpen = (): boolean => openState;

/** Posts a raw message to the host (no shim echo). Returns false when the page is not hosted. */
export const postHostMessage = (message: unknown): boolean => {
    const post = (window as unknown as {
        chrome?: { webview?: { postMessage: (message: unknown) => void } };
    }).chrome?.webview?.postMessage;
    if (typeof post !== 'function') return false;
    try {
        post(message);
        return true;
    } catch (error) {
        console.warn('[spw-folia] failed to post host message', error);
        return false;
    }
};

/**
 * v0.1.9: reports the interactive chrome rectangles (CSS px, page viewport) so the host can keep them
 * clickable while the transparent player window is in mouse-passthrough mode. Everything else falls
 * through to the desktop.
 */
export interface HitRegion {
    x: number;
    y: number;
    w: number;
    h: number;
}

export const reportHitRegions = (regions: HitRegion[]): void => {
    const viewportWidth = window.innerWidth || 0;
    const viewportHeight = window.innerHeight || 0;
    if (viewportWidth <= 0 || viewportHeight <= 0) return;
    postHostMessage({
        type: 'hitbox',
        vw: viewportWidth,
        vh: viewportHeight,
        rects: regions,
    });
};

export { DEMO_THEME };
