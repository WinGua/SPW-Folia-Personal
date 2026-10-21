import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { PlaybackQueueSnapshot } from '~/bridge';

/**
 * v0.3.0 · playback queue panel that hangs above the playback bar.
 *
 * Opened by the queue button; rows mirror the host's `queue` snapshot (protocol §3.2). Selecting a
 * row only asks the player to switch (`control` → `queue-play`), the highlighted row follows the
 * echoed snapshot. The panel owns its own dismissal: outside pointerdown, a close button, and
 * Escape captured on `window` while stopping propagation so the host/settings layer keeps its
 * Escape handling untouched. Focus returns to the queue button through `onClose`.
 *
 * DOM contract shared with the integration acceptance scripts (do not rename):
 *   root   `.spw-queue-panel` (plus `.spw-playback-queue-panel` for HUD styles)
 *   row    `.spw-playback-queue-item` with `data-queue-index="<items index>"`,
 *          `data-current="true"` on the row matching `queue.index`.
 */

const PANEL_ID = 'spw-playback-queue-panel';

interface PlaybackQueuePanelProps {
    queue: PlaybackQueueSnapshot;
    flat: boolean;
    /** the queue toggle button in the playback bar; clicks on it are not "outside" */
    anchorRef: React.RefObject<HTMLButtonElement | null>;
    onClose: () => void;
    onSelect: (index: number) => void;
}

const PlaybackQueuePanel: React.FC<PlaybackQueuePanelProps> = ({ queue, flat, anchorRef, onClose, onSelect }) => {
    const panelRef = useRef<HTMLDivElement | null>(null);
    const currentItemRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            // Capture + stop: closing the list must not fall through to the host window or a panel
            // underneath (settings overlay / player-background panel keep their own Escape).
            event.preventDefault();
            event.stopPropagation();
            onClose();
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [onClose]);

    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node | null;
            if (!target) return;
            if (panelRef.current?.contains(target)) return;
            if (anchorRef.current?.contains(target)) return;
            onClose();
        };
        document.addEventListener('pointerdown', handlePointerDown, true);
        return () => document.removeEventListener('pointerdown', handlePointerDown, true);
    }, [anchorRef, onClose]);

    // Follow the player: when the index changes (queue-play / next / previous) keep the row visible.
    useEffect(() => {
        currentItemRef.current?.scrollIntoView({ block: 'center' });
    }, [queue.index, queue.random, queue.items.length]);

    const title = queue.items.length > 0 ? `${queue.items.length} 首` : '暂无曲目';

    return (
        <div
            ref={panelRef}
            id={PANEL_ID}
            className="spw-playback-queue-panel spw-queue-panel"
            data-flat={flat ? 'true' : 'false'}
            role="dialog"
            aria-label="播放列表"
        >
            <div className="spw-playback-queue-header">
                <span className="spw-playback-queue-heading">播放列表</span>
                <span className="spw-playback-queue-count">{title}</span>
                <button
                    type="button"
                    className="spw-playback-queue-close"
                    title="关闭"
                    aria-label="关闭播放列表"
                    onClick={onClose}
                >
                    <X size={16} />
                </button>
            </div>
            <div className="spw-playback-queue-list">
                {queue.items.map((item, index) => {
                    const current = index === queue.index;
                    const artist = item.artist || '未知歌手';
                    return (
                        <button
                            key={`${item.id}-${index}`}
                            ref={current ? currentItemRef : undefined}
                            type="button"
                            className="spw-playback-queue-item"
                            data-index={index}
                            data-queue-index={index}
                            data-current={current ? 'true' : 'false'}
                            aria-current={current ? 'true' : undefined}
                            title={`${item.title || '未知曲目'} - ${artist}`}
                            onClick={() => onSelect(index)}
                        >
                            <span className="spw-playback-queue-index">{index + 1}</span>
                            <span className="spw-playback-queue-meta">
                                <span className="spw-playback-queue-name">{item.title || '未知曲目'}</span>
                                <span className="spw-playback-queue-artist">
                                    {artist}
                                    {item.album ? ` · ${item.album}` : ''}
                                </span>
                            </span>
                        </button>
                    );
                })}
                {queue.items.length === 0 ? (
                    <div className="spw-playback-queue-empty">播放队列为空</div>
                ) : null}
            </div>
        </div>
    );
};

export default PlaybackQueuePanel;
