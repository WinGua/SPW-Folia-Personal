import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ListMusic, Pause, Play, Shuffle, SkipBack, SkipForward } from 'lucide-react';
import { useSettingsStore } from '~/model/settings';
import {
    bridgeOn,
    getBridge,
    sendPlaybackControl,
    type PlaybackQueueSnapshot,
} from '~/bridge';
import { clockPosition, formatTime, usePlaybackClock, type PlaybackClock } from './playbackClock';
import PlaybackQueuePanel from './PlaybackQueuePanel';

/**
 * v0.3.0 · bottom-centre playback HUD.
 *
 * Collapsed: a small translucent bar — current time / thin progress with a position dot /
 * total time (reference: "如图2"). Hovering expands it (short delay, smooth transition) into the
 * full control bar — white play/pause circle, previous, truncated title, next, progress + times,
 * shuffle, queue (reference: "如图3").
 *
 * since v0.3.0 every transport control is wired to the page → host `control` channel
 * (docs/protocol.md §3.1/§3.4): the page only emits requests, the plugin plays them and echoes
 * `state`/`queue` snapshots back. The progress bar accepts click + pointer drag seek and the
 * queue button opens the playback-queue panel above the bar.
 *
 * DOM contract shared with the integration acceptance scripts (do not rename):
 *   transport buttons keep `.spw-playback-play` / `.spw-playback-step` / `.spw-playback-icon`,
 *   shuffle has aria-label「随机播放」, queue toggle「播放列表」;
 *   seek rail is `.spw-playback-bar .spw-playback-track` and answers BOTH the
 *   pointerdown→pointerup sequence and a plain `click` (synthetic events included).
 *
 * While the player page is in mouse-passthrough mode the HUD is unmounted entirely (no pixels,
 * no hit region — clicks must fall through to the desktop), as is the case while the settings
 * overlay covers the stage.
 */

const EXPAND_DELAY_MS = 150;
const COLLAPSE_DELAY_MS = 260;
/** v0.3.0 · hide the HUD downward once the pointer has been idle for this long (matches the host
 *  cursor-hide idle window, so bar and cursor disappear together instead of the bar covering lyrics). */
const IDLE_HIDE_MS = 2600;
/** Expanded HUD geometry, mirrored from app.css (`width: min(620px, 100vw - 48px)`, height 96 px,
 *  anchored 28 px above the viewport bottom). Used for coordinate hover hit-testing — see the
 *  transparent-window note below; the settled rect is used so slide-in animations never flip hover. */
const HUD_EXPANDED_WIDTH = 620;
const HUD_EXPANDED_HEIGHT = 96;
const HUD_SIDE_OFFSET = 24;
const HUD_BOTTOM_OFFSET = 28;
const SEEK_EPSILON = 0.005;
/** a real pointer press is followed by a `click` on the same rail — don't emit the same seek twice */
const CLICK_SEEK_DEDUPE_MS = 600;

interface PlaybackBarProps {
    /** the settings overlay owns the stage while open; the HUD steps aside */
    settingsOpen?: boolean;
}

const EMPTY_QUEUE: PlaybackQueueSnapshot = { mode: 'circle', random: false, index: -1, items: [] };

const isQueueSnapshot = (value: unknown): value is PlaybackQueueSnapshot => {
    const candidate = value as PlaybackQueueSnapshot | null;
    return !!candidate && typeof candidate === 'object' && Array.isArray(candidate.items);
};

/** Tolerate older shims: missing/invalid fields fall back to a neutral circle-mode snapshot. */
const normalizeQueue = (value: unknown): PlaybackQueueSnapshot | null => {
    if (!isQueueSnapshot(value)) return null;
    const snapshot = value as Partial<PlaybackQueueSnapshot>;
    return {
        mode: snapshot.mode ?? 'circle',
        random: snapshot.random === true || snapshot.mode === 'random',
        index: typeof snapshot.index === 'number' ? snapshot.index : 0,
        items: snapshot.items.filter((item) => !!item && typeof item === 'object'),
    };
};

const writeTime = (nodes: (HTMLSpanElement | null)[], text: string): void => {
    for (const node of nodes) {
        if (node && node.textContent !== text) node.textContent = text;
    }
};

const writeProgress = (roots: (HTMLSpanElement | null)[], ratio: number): void => {
    const percent = `${(ratio * 100).toFixed(3)}%`;
    for (const root of roots) {
        if (!root) continue;
        const fill = root.firstElementChild as HTMLElement | null;
        const dot = root.lastElementChild as HTMLElement | null;
        if (fill) fill.style.width = percent;
        if (dot) dot.style.left = percent;
    }
};

const paint = (
    clock: PlaybackClock | null,
    durationMs: number,
    positionNodes: (HTMLSpanElement | null)[],
    durationNodes: (HTMLSpanElement | null)[],
    trackNodes: (HTMLSpanElement | null)[],
): void => {
    const duration = Math.max(durationMs, clock?.durationMs ?? 0);
    const position = clock ? clockPosition(clock) : 0;
    writeTime(positionNodes, formatTime(position));
    writeTime(durationNodes, formatTime(duration));
    writeProgress(trackNodes, duration > 0 ? Math.min(position / duration, 1) : 0);
};

interface DragState {
    pointerId: number;
    ratio: number;
    /** ratio already sent to the player; pointerup only sends again once the pointer really moved */
    committedRatio: number;
}

const PlaybackBar: React.FC<PlaybackBarProps> = ({ settingsOpen = false }) => {
    const mousePassthrough = useSettingsStore((s) => s.mousePassthrough);
    const flat = useSettingsStore((s) => s.transparentPlayerBackground);
    const { meta, clockRef } = usePlaybackClock();
    const [expanded, setExpanded] = useState(false);
    const [queueOpen, setQueueOpen] = useState(false);
    /** true while the pointer has been idle: the HUD slides down out of the way of the lyrics. */
    const [idleHidden, setIdleHidden] = useState(false);
    const [queue, setQueue] = useState<PlaybackQueueSnapshot | null>(() => normalizeQueue(getBridge().inputs?.queue));

    const rootRef = useRef<HTMLDivElement | null>(null);
    const listButtonRef = useRef<HTMLButtonElement | null>(null);
    const positionNodes = useRef<(HTMLSpanElement | null)[]>([]);
    const durationNodes = useRef<(HTMLSpanElement | null)[]>([]);
    const trackNodes = useRef<(HTMLSpanElement | null)[]>([]);
    const hoverTimer = useRef<number | null>(null);
    /** while dragging the track: local ratio preview so the fill follows the pointer without waiting
     *  for the player's echoed `state` */
    const previewRatio = useRef<number | null>(null);
    const drag = useRef<DragState | null>(null);
    const lastSeek = useRef<{ ratio: number; at: number } | null>(null);
    const idleTimer = useRef<number | null>(null);
    const queueOpenRef = useRef(false);
    const expandedRef = useRef(false);
    /** last pointer position seen by the page (pointerleave below is a forwarded-move artefact). */
    const lastPointer = useRef<{ x: number; y: number } | null>(null);
    /** Timer target currently pending in `hoverTimer` (null = no pending expand/collapse). */
    const hoverTarget = useRef<boolean | null>(null);

    useEffect(() => {
        queueOpenRef.current = queueOpen;
    }, [queueOpen]);

    useEffect(() => {
        expandedRef.current = expanded;
    }, [expanded]);

    const clearHoverTimer = useCallback(() => {
        if (hoverTimer.current !== null) {
            window.clearTimeout(hoverTimer.current);
            hoverTimer.current = null;
        }
        hoverTarget.current = null;
    }, []);

    const schedule = useCallback(
        (next: boolean, delay: number) => {
            clearHoverTimer();
            hoverTarget.current = next;
            hoverTimer.current = window.setTimeout(() => {
                hoverTimer.current = null;
                hoverTarget.current = null;
                setExpanded(next);
            }, delay);
        },
        [clearHoverTimer],
    );

    /**
     * v0.3.0 fix · hover for the transparent window.
     *
     * While the player page is transparent the host routes the mouse through an invisible input
     * catcher that forwards raw WM_MOUSEMOVE/WM_LBUTTON* messages to WebView2 (the colour-key
     * layered window itself never receives native hover). Chromium therefore dispatches a
     * `pointerover`/`pointerenter` followed by `pointerout`/`pointerleave` for *every* forwarded
     * move (the real cursor is not over the web view), so plain onPointerEnter + onPointerLeave
     * expand-then-collapse and the HUD never opens. Pointer moves still reach the page with correct
     * client coordinates, so hover is decided here from the pointer position against the *settled*
     * HUD rect (independent of the slide-in/expand animation, which would otherwise flip hover).
     */
    const hitTestHud = useCallback((x: number, y: number): boolean => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const width = Math.min(HUD_EXPANDED_WIDTH, Math.max(0, vw - 2 * HUD_SIDE_OFFSET));
        const left = (vw - width) / 2;
        const bottom = vh - HUD_BOTTOM_OFFSET;
        return x >= left && x <= left + width && y >= bottom - HUD_EXPANDED_HEIGHT && y <= bottom;
    }, []);

    const requestHover = useCallback(
        (next: boolean) => {
            if (hoverTarget.current === next) return;
            if (expandedRef.current === next) {
                clearHoverTimer();
                return;
            }
            schedule(next, next ? EXPAND_DELAY_MS : COLLAPSE_DELAY_MS);
        },
        [clearHoverTimer, schedule],
    );

    useEffect(() => () => clearHoverTimer(), [clearHoverTimer]);

    // v0.3.0: pointer-idle auto-hide. Any pointer/key activity slides the HUD back in; after
    // IDLE_HIDE_MS of stillness it slides below the stage so it never covers the lyrics. The queue
    // panel keeps its anchor visible while open, and an in-flight seek drag wins over idle hiding.
    const armIdleTimer = useCallback(function arm(): void {
        if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
        idleTimer.current = window.setTimeout(() => {
            if (queueOpenRef.current || drag.current) {
                arm();
                return;
            }
            clearHoverTimer();
            setIdleHidden(true);
            setExpanded(false);
        }, IDLE_HIDE_MS);
    }, [clearHoverTimer]);

    const bumpActivity = useCallback(() => {
        setIdleHidden(false);
        armIdleTimer();
    }, [armIdleTimer]);

    useEffect(() => {
        bumpActivity();
        // Hover is resolved from pointer coordinates (see hitTestHud): the transparent-window input
        // catcher makes native enter/leave fire in the same tick for every forwarded move.
        const onPointerMove = (event: PointerEvent): void => {
            bumpActivity();
            lastPointer.current = { x: event.clientX, y: event.clientY };
            if (queueOpenRef.current || drag.current) return;
            requestHover(hitTestHud(event.clientX, event.clientY));
        };
        window.addEventListener('pointermove', onPointerMove, { passive: true });
        window.addEventListener('pointerdown', bumpActivity, { passive: true });
        window.addEventListener('keydown', bumpActivity);
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerdown', bumpActivity);
            window.removeEventListener('keydown', bumpActivity);
            if (idleTimer.current !== null) {
                window.clearTimeout(idleTimer.current);
                idleTimer.current = null;
            }
        };
    }, [bumpActivity, hitTestHud, requestHover]);

    // The idle countdown is paused while the queue panel is open; restart it when it closes.
    useEffect(() => {
        if (!queueOpen) bumpActivity();
    }, [queueOpen, bumpActivity]);

    // v0.3.0: queue snapshots arrive from the host (`queue` event); read the cached input for late mounts.
    useEffect(() => bridgeOn<PlaybackQueueSnapshot>('queue', (snapshot) => {
        const next = normalizeQueue(snapshot);
        if (next) setQueue(next);
    }), []);

    // Keep the bar open while the queue panel is visible: it hangs above it and needs its anchor.
    useEffect(() => {
        if (!queueOpen) return;
        clearHoverTimer();
        setExpanded(true);
    }, [queueOpen, clearHoverTimer]);

    // The HUD unmounts in passthrough / behind the settings overlay; don't resurrect a stale panel.
    useEffect(() => {
        if (mousePassthrough || settingsOpen) setQueueOpen(false);
    }, [mousePassthrough, settingsOpen]);

    // Per-frame painter: the dot and the time labels follow the clock without re-rendering React.
    useEffect(() => {
        let frame = 0;
        const loop = () => {
            const preview = previewRatio.current;
            const duration = Math.max(meta.durationMs, clockRef.current?.durationMs ?? 0);
            if (preview !== null && duration > 0) {
                writeTime(positionNodes.current, formatTime(preview * duration));
                writeTime(durationNodes.current, formatTime(duration));
                writeProgress(trackNodes.current, preview);
            } else {
                paint(clockRef.current, meta.durationMs, positionNodes.current, durationNodes.current, trackNodes.current);
            }
            frame = window.requestAnimationFrame(loop);
        };
        frame = window.requestAnimationFrame(loop);
        return () => window.cancelAnimationFrame(frame);
    }, [clockRef, meta.durationMs]);

    const durationForSeek = useCallback(
        () => Math.max(meta.durationMs, clockRef.current?.durationMs ?? 0),
        [meta.durationMs, clockRef],
    );

    const seekToRatio = useCallback((ratio: number) => {
        const duration = durationForSeek();
        if (duration <= 0) return;
        lastSeek.current = { ratio, at: Date.now() };
        sendPlaybackControl('seek', { positionMs: Math.round(ratio * duration) });
    }, [durationForSeek]);

    const ratioAt = (track: HTMLElement, clientX: number): number => {
        const rect = track.getBoundingClientRect();
        if (rect.width <= 0) return 0;
        return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    };

    const handleTrackPointerDown = (event: React.PointerEvent<HTMLSpanElement>): void => {
        if (event.button !== 0) return;
        const track = event.currentTarget;
        const ratio = ratioAt(track, event.clientX);
        // Don't let the press bubble into the HUD hover/expand machinery.
        event.preventDefault();
        event.stopPropagation();
        drag.current = { pointerId: event.pointerId, ratio, committedRatio: ratio };
        previewRatio.current = ratio;
        writeProgress(trackNodes.current, ratio);
        writeTime(positionNodes.current, formatTime(ratio * durationForSeek()));
        try {
            track.setPointerCapture(event.pointerId);
        } catch {
            /* pointer capture is best-effort */
        }
        seekToRatio(ratio);
    };

    const handleTrackPointerMove = (event: React.PointerEvent<HTMLSpanElement>): void => {
        const state = drag.current;
        if (!state || state.pointerId !== event.pointerId) return;
        event.stopPropagation();
        const ratio = ratioAt(event.currentTarget, event.clientX);
        state.ratio = ratio;
        previewRatio.current = ratio;
        const duration = durationForSeek();
        writeProgress(trackNodes.current, ratio);
        writeTime(positionNodes.current, formatTime(ratio * duration));
    };

    const finishTrackDrag = (event: React.PointerEvent<HTMLSpanElement>): void => {
        const state = drag.current;
        if (!state || state.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        const ratio = ratioAt(event.currentTarget, event.clientX);
        drag.current = null;
        previewRatio.current = null;
        if (Math.abs(ratio - state.committedRatio) > SEEK_EPSILON) seekToRatio(ratio);
    };

    const cancelTrackDrag = (): void => {
        drag.current = null;
        previewRatio.current = null;
    };

    // Plain `click` (mouse click without a drag, keyboard-free tools and synthetic acceptance
    // events) also seeks. Real presses already emitted the same ratio on pointerdown and are
    // de-duplicated so one physical click sends exactly one control message.
    const handleTrackClick = (event: React.MouseEvent<HTMLSpanElement>): void => {
        const ratio = ratioAt(event.currentTarget, event.clientX);
        const previous = lastSeek.current;
        if (previous && Date.now() - previous.at < CLICK_SEEK_DEDUPE_MS && Math.abs(previous.ratio - ratio) < 0.01) {
            return;
        }
        seekToRatio(ratio);
    };

    const closeQueue = useCallback(() => {
        setQueueOpen(false);
        window.requestAnimationFrame(() => listButtonRef.current?.focus());
    }, []);

    const toggleQueue = useCallback(() => {
        setQueueOpen((open) => !open);
        clearHoverTimer();
        setExpanded(true);
    }, [clearHoverTimer]);

    const selectQueueItem = useCallback((index: number) => {
        sendPlaybackControl('queue-play', { index, random: queue?.random === true });
    }, [queue?.random]);

    const visible = meta.durationMs > 0;
    if (mousePassthrough || settingsOpen || !visible) return null;

    const randomActive = queue?.mode === 'random' || queue?.random === true;
    const position = clockRef.current ? clockPosition(clockRef.current) : 0;
    const duration = Math.max(meta.durationMs, clockRef.current?.durationMs ?? 0);
    const panelQueue = queue ?? EMPTY_QUEUE;

    return (
        <>
            <div
                ref={rootRef}
                className="spw-playback"
                data-expanded={expanded ? 'true' : 'false'}
                data-flat={flat ? 'true' : 'false'}
                data-hidden={idleHidden ? 'true' : 'false'}
                role="group"
                aria-label="播放进度"
                onPointerEnter={(event) => {
                    lastPointer.current = { x: event.clientX, y: event.clientY };
                    requestHover(true);
                }}
                onPointerLeave={(event) => {
                    if (queueOpen || drag.current) return;
                    // Ignore the bogus leave that the transparent-window forwarder emits for every
                    // move: the coordinates still say the pointer is inside the bar.
                    const point = lastPointer.current ?? { x: event.clientX, y: event.clientY };
                    if (hitTestHud(point.x, point.y)) return;
                    requestHover(false);
                }}
                onFocus={() => {
                    // Keyboard users tabbing into the transport buttons reveal the bar.
                    bumpActivity();
                    clearHoverTimer();
                    setExpanded(true);
                }}
            >
                {/* collapsed pill: 00:05 ——●—— 02:03 (reference fig.2) */}
                <div className="spw-playback-pill" aria-hidden={expanded ? 'true' : 'false'}>
                    <span
                        className="spw-playback-time"
                        ref={(node) => { positionNodes.current[0] = node; }}
                    >
                        {formatTime(position)}
                    </span>
                    <span
                        className="spw-playback-track"
                        role="progressbar"
                        aria-label="播放进度"
                        ref={(node) => { trackNodes.current[0] = node; }}
                        onPointerDown={handleTrackPointerDown}
                        onPointerMove={handleTrackPointerMove}
                        onPointerUp={finishTrackDrag}
                        onPointerCancel={cancelTrackDrag}
                        onClick={handleTrackClick}
                    >
                        <span className="spw-playback-fill" />
                        <span className="spw-playback-dot" />
                    </span>
                    <span
                        className="spw-playback-time"
                        ref={(node) => { durationNodes.current[0] = node; }}
                    >
                        {formatTime(duration)}
                    </span>
                </div>

                {/* expanded control bar (reference fig.3) */}
                <div className="spw-playback-bar" aria-hidden={expanded ? 'false' : 'true'}>
                    <button
                        type="button"
                        className="spw-playback-play"
                        title={meta.playing ? '暂停' : '播放'}
                        aria-label={meta.playing ? '暂停' : '播放'}
                        onClick={() => sendPlaybackControl('toggle')}
                    >
                        {meta.playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
                    </button>
                    <div className="spw-playback-main">
                        <button
                            type="button"
                            className="spw-playback-step"
                            title="上一首"
                            aria-label="上一首"
                            onClick={() => sendPlaybackControl('previous')}
                        >
                            <SkipBack size={17} fill="currentColor" />
                        </button>
                        <span className="spw-playback-title" title={meta.title}>{meta.title || '正在播放'}</span>
                        <button
                            type="button"
                            className="spw-playback-step"
                            title="下一首"
                            aria-label="下一首"
                            onClick={() => sendPlaybackControl('next')}
                        >
                            <SkipForward size={17} fill="currentColor" />
                        </button>
                        <button
                            type="button"
                            className="spw-playback-icon"
                            data-active={randomActive ? 'true' : 'false'}
                            aria-pressed={randomActive}
                            title={`随机播放：${randomActive ? '开' : '关'}`}
                            aria-label="随机播放"
                            onClick={() => sendPlaybackControl('shuffle')}
                        >
                            <Shuffle size={18} />
                        </button>
                        <button
                            ref={listButtonRef}
                            type="button"
                            className="spw-playback-icon"
                            data-active={queueOpen ? 'true' : 'false'}
                            aria-expanded={queueOpen}
                            aria-controls="spw-playback-queue-panel"
                            title="播放列表"
                            aria-label="播放列表"
                            onClick={toggleQueue}
                        >
                            <ListMusic size={18} />
                        </button>
                    </div>
                    <div className="spw-playback-line">
                        <span
                            className="spw-playback-time"
                            ref={(node) => { positionNodes.current[1] = node; }}
                        >
                            {formatTime(position)}
                        </span>
                        <span
                            className="spw-playback-track"
                            role="progressbar"
                            aria-label="播放进度"
                            ref={(node) => { trackNodes.current[1] = node; }}
                            onPointerDown={handleTrackPointerDown}
                            onPointerMove={handleTrackPointerMove}
                            onPointerUp={finishTrackDrag}
                            onPointerCancel={cancelTrackDrag}
                            onClick={handleTrackClick}
                        >
                            <span className="spw-playback-fill" />
                            <span className="spw-playback-dot" />
                        </span>
                        <span
                            className="spw-playback-time"
                            ref={(node) => { durationNodes.current[1] = node; }}
                        >
                            {formatTime(duration)}
                        </span>
                    </div>
                </div>
            </div>
            {queueOpen ? (
                <PlaybackQueuePanel
                    queue={panelQueue}
                    flat={flat}
                    anchorRef={listButtonRef}
                    onClose={closeQueue}
                    onSelect={selectQueueItem}
                />
            ) : null}
        </>
    );
};

export default PlaybackBar;
