/* v0.1.7: bottom-right chrome control for Folia's player-page transparent background.
 *
 * Reference (screenshot 2): a round sliders button sits in the player's bottom-right corner; tapping
 * it opens a small control panel above with the "播放页透明背景" switch (screenshot 1). The switch is
 * Folia's own `transparentPlayerBackground` setting: it hides the visualizer background and lets the
 * host window become colour-key transparent so the desktop actually shows through. */
import React, { useCallback, useEffect, useRef } from 'react';
import { SlidersHorizontal } from 'lucide-react';

interface PlayerBackgroundControlProps {
    /** Follows the 2.5 s chrome idle-fade, never while the panel itself is open. */
    visible: boolean;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Whether the player page background is currently transparent. */
    enabled: boolean;
    onToggle: (next: boolean) => void;
    label: string;
    hint: string;
}

const PlayerBackgroundControl: React.FC<PlayerBackgroundControlProps> = ({
    visible,
    open,
    onOpenChange,
    enabled,
    onToggle,
    label,
    hint,
}) => {
    const rootRef = useRef<HTMLDivElement | null>(null);

    const close = useCallback(() => onOpenChange(false), [onOpenChange]);

    // Clicking anywhere outside the control dismisses the panel (capture so it also works over canvas).
    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event: PointerEvent) => {
            const root = rootRef.current;
            const target = event.target;
            if (root && target instanceof Node && root.contains(target)) return;
            close();
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => document.removeEventListener('pointerdown', onPointerDown, true);
    }, [open, close]);

    return (
        <div className="spw-player-bg" ref={rootRef} data-flat={enabled ? 'true' : 'false'}>
            <div className="spw-player-bg-panel" data-open={open ? 'true' : 'false'} role="group" aria-label={label}>
                <button
                    type="button"
                    className="spw-player-bg-row"
                    role="switch"
                    aria-checked={enabled ? 'true' : 'false'}
                    onClick={() => onToggle(!enabled)}
                >
                    <span className="spw-player-bg-text">
                        <span className="spw-player-bg-label">{label}</span>
                        <span className="spw-player-bg-hint">{hint}</span>
                    </span>
                    <span className="spw-switch" data-on={enabled ? 'true' : 'false'} aria-hidden="true">
                        <span className="spw-switch-knob" />
                    </span>
                </button>
                {enabled ? (
                    <p className="spw-player-bg-note">
                        透明窗口为鼠标穿透：按 Ctrl+Alt+B 或点左下角浮标恢复不透明，ESC 退出播放。
                    </p>
                ) : null}
            </div>
            <button
                type="button"
                className="spw-chrome-btn spw-chrome-btn--player"
                data-spw-chrome="player-background"
                data-visible={visible ? 'true' : 'false'}
                aria-label={label}
                aria-expanded={open ? 'true' : 'false'}
                title={label}
                onClick={() => onOpenChange(!open)}
            >
                <SlidersHorizontal size={20} strokeWidth={1.75} />
            </button>
        </div>
    );
};

export default PlayerBackgroundControl;
