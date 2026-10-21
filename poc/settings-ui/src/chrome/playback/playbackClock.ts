import { useEffect, useRef, useState, type RefObject } from 'react';
import { bridgeOn, type BridgeTrackMessage } from '~/bridge';

/**
 * v0.3.0 · playback HUD data layer (bottom-centre progress bar).
 *
 * Read-only by design: the protocol has no page→host playback-control channel that reaches the
 * plugin (page `action` messages carry only a `name`, and the plugin just logs them — see
 * docs/protocol.md §3.1 and HostForm.cs), so this HUD displays the clock it receives and leaves
 * seeking/transport controls to a future protocol append.
 *
 * `state` payloads arrive in two shapes:
 *   • injected (host): the RAW plugin message forwarded by Shim.js:240 —
 *     { posMs, durationMs, playing, rate, tsMs, lyricOffsetMs };
 *   • dev fake bridge: BridgeStateMessage (seconds-based) —
 *     { currentTime, duration, playerState, sentAtMs, playbackRate }.
 * Both normalize to PlaybackClock.
 */

export interface PlaybackClock {
    /** playback position at `atMs`, milliseconds */
    positionMs: number;
    /** track length in milliseconds; 0 when unknown */
    durationMs: number;
    playing: boolean;
    /** playback rate used to extrapolate position between `state` messages */
    rate: number;
    /** epoch ms the snapshot describes; positions extrapolate from here while playing */
    atMs: number;
}

interface RawStatePayload {
    posMs?: number;
    durationMs?: number;
    playing?: boolean;
    rate?: number;
    tsMs?: number;
}

interface SecondsStatePayload {
    currentTime?: number;
    duration?: number;
    playerState?: string;
    playbackRate?: number;
    sentAtMs?: number;
}

/** Plugin/host clock drift must never teleport the dot: only extrapolate near "now". */
const nearNow = (stampMs: number, now: number): number =>
    now - stampMs > 5000 || stampMs - now > 1000 ? now : stampMs;

export const normalizeClock = (payload: unknown, now: number = Date.now()): PlaybackClock | null => {
    const msg = (payload ?? null) as (RawStatePayload & SecondsStatePayload) | null;
    if (!msg) return null;
    if (typeof msg.posMs === 'number') {
        return {
            positionMs: Math.max(0, msg.posMs),
            durationMs: Math.max(0, msg.durationMs ?? 0),
            playing: msg.playing !== false,
            rate: typeof msg.rate === 'number' && msg.rate > 0 ? msg.rate : 1,
            atMs: nearNow(typeof msg.tsMs === 'number' && msg.tsMs > 0 ? msg.tsMs : now, now),
        };
    }
    if (typeof msg.currentTime === 'number') {
        return {
            positionMs: Math.max(0, msg.currentTime * 1000),
            durationMs: Math.max(0, (msg.duration ?? 0) * 1000),
            playing: msg.playerState !== 'PAUSED' && msg.playerState !== 'IDLE',
            rate: typeof msg.playbackRate === 'number' && msg.playbackRate > 0 ? msg.playbackRate : 1,
            atMs: nearNow(typeof msg.sentAtMs === 'number' ? msg.sentAtMs : now, now),
        };
    }
    return null;
};

/** Interpolated read; keeps the dot moving between `state` messages. */
export const clockPosition = (clock: PlaybackClock, now: number = Date.now()): number => {
    const drift = clock.playing ? (now - clock.atMs) * clock.rate : 0;
    const position = clock.positionMs + drift;
    const capped = clock.durationMs > 0 ? Math.min(position, clock.durationMs) : position;
    return Math.max(0, capped);
};

export const formatTime = (ms: number): string => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const pad = (value: number): string => String(value).padStart(2, '0');
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
};

export interface PlaybackMeta {
    /** title of the current track; '' while unknown */
    title: string;
    artist: string;
    playing: boolean;
    durationMs: number;
}

const EMPTY_META: PlaybackMeta = { title: '', artist: '', playing: false, durationMs: 0 };

export interface PlaybackClockHandle {
    meta: PlaybackMeta;
    /** live clock; read inside the rAF loop — mutating it never triggers a render */
    clockRef: RefObject<PlaybackClock | null>;
}

/**
 * Subscribes to the bridge clock/track feed. Renders happen only when the *metadata* changes
 * (title / playing flag / duration); the position itself is painted from `clockRef` per frame.
 */
export const usePlaybackClock = (): PlaybackClockHandle => {
    const clockRef = useRef<PlaybackClock | null>(null);
    const [meta, setMeta] = useState<PlaybackMeta>(EMPTY_META);

    useEffect(() => {
        const offState = bridgeOn<unknown>('state', (payload) => {
            const clock = normalizeClock(payload);
            if (!clock) return;
            clockRef.current = clock;
            setMeta((prev) =>
                prev.playing === clock.playing && (clock.durationMs <= 0 || prev.durationMs === clock.durationMs)
                    ? prev
                    : {
                        ...prev,
                        playing: clock.playing,
                        durationMs: clock.durationMs > 0 ? clock.durationMs : prev.durationMs,
                    },
            );
        });
        const offTrack = bridgeOn<Partial<BridgeTrackMessage>>('track', (payload) => {
            const next: PlaybackMeta = {
                title: typeof payload?.title === 'string' ? payload.title : '',
                artist: typeof payload?.artist === 'string' ? payload.artist : '',
                playing: false,
                durationMs: Math.max(0, payload?.durationMs ?? 0),
            };
            setMeta((prev) => ({
                title: next.title || prev.title,
                artist: next.artist || prev.artist,
                playing: prev.playing,
                durationMs: next.durationMs > 0 ? next.durationMs : prev.durationMs,
            }));
        });
        return () => {
            offState();
            offTrack();
        };
    }, []);

    return { meta, clockRef };
};
