/* The page-side bridge. When injected by the host, `window.__SPW_FOLIA__` is the Shim's object and
 * every call is forwarded to the host; when opened directly (dev.html, screenshots) a fake bridge
 * answers with demo data and logs pushed configs. Protocol: docs/protocol.md §3. */
import type { ObsBrowserSourceConfig } from '@/types/obsBrowserSource';
import type { Theme } from '@/types';
import { useSettingsStore, snapshotFromState, applySnapshot, type SettingsSnapshot } from '~/model/settings';

export type BridgeEventType = 'hello' | 'settings' | 'state' | 'lyrics' | 'track' | 'audio' | 'config' | 'beat' | 'settingsUI';

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
    coverUrl?: string | null;
    durationMs?: number;
    lyrics?: unknown;
}

export interface SpwFoliaBridge {
    protocol?: number;
    on: (type: string, listener: (payload: never) => void) => (() => void) | void;
    emit: (type: string, payload?: unknown) => void;
    pushConfig: (config: ObsBrowserSourceConfig) => void;
    getSettings: () => unknown;
    setSettings: (partial: unknown) => void;
    requestClose?: () => void;
    inputs?: { state?: BridgeStateMessage | null; lyrics?: unknown; track?: BridgeTrackMessage | null };
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

/** Fake bridge for running the bundle in a plain browser (`pnpm dev` → dev.html). */
const createFakeBridge = (): SpwFoliaBridge => ({
    protocol: 1,
    on: (type, listener) => {
        const set = listeners.get(type) ?? new Set();
        set.add(listener as (payload: unknown) => void);
        listeners.set(type, set);
        return () => set.delete(listener as (payload: unknown) => void);
    },
    emit: (type, payload) => emitLocally(type, payload),
    pushConfig: config => {
        window.__SPW_FOLIA_LAST_CONFIG__ = config;
        console.info('[settings-ui] pushConfig', config);
    },
    getSettings: () => null,
    setSettings: partial => {
        console.info('[settings-ui] setSettings', partial);
    },
    requestClose: () => console.info('[settings-ui] requestClose'),
    inputs: { state: null, lyrics: null, track: DEMO_TRACK },
});

let bridgeInstance: SpwFoliaBridge | null = null;

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

/** Settings round trip: host pushes the persisted snapshot, the UI reports changes back (<=10 Hz). */
export const subscribeSettingsRoundTrip = (): (() => void) => {
    const bridge = getBridge();
    const incoming = bridge.getSettings?.();
    if (incoming && typeof incoming === 'object') applySnapshot(incoming as Partial<SettingsSnapshot>);

    const off = bridgeOn<SettingsSnapshot>('settings', snapshot => {
        applyingRemote = true;
        try {
            applySnapshot(snapshot);
        } finally {
            applyingRemote = false;
        }
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
    openState = open;
};
const isSettingsUiOpen = (): boolean => openState;

export { DEMO_THEME };
