/* v0.1.7: bottom-right chrome control for Folia's player-page transparent background.
 *
 * Reference (screenshot 2): a round sliders button sits in the player's bottom-right corner; tapping
 * it opens a small control panel above with the "播放页透明背景" switch (screenshot 1). The switch is
 * Folia's own `transparentPlayerBackground` setting: it hides the visualizer background and lets the
 * host window become colour-key transparent so the desktop actually shows through.
 *
 * v0.1.11: the selected lyric style decides whether the transparent window is usable at all. A style
 * that paints a large semi-transparent plate under the colour key turns into a pink haze, so for
 * those styles the switch is disabled and the panel says why (the store closes transparency when
 * such a style is selected, see `model/transparencyCompat.ts`). */
import React, { useCallback, useEffect, useRef } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { TransparencyCompat } from '~/model/transparencyCompat';

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
    /** v0.1.9: while transparent, let the mouse reach the desktop instead of the page. */
    passthrough: boolean;
    onTogglePassthrough: (next: boolean) => void;
    passthroughLabel: string;
    passthroughHint: string;
    /** v0.1.11: how the selected style behaves under the transparent window. */
    compat: TransparencyCompat;
    /** v0.1.11: extra line under the switches (why the switch is off / what is simplified). */
    compatNote: string | null;
}

const PlayerBackgroundControl: React.FC<PlayerBackgroundControlProps> = ({
    visible,
    open,
    onOpenChange,
    enabled,
    onToggle,
    label,
    hint,
    passthrough,
    onTogglePassthrough,
    passthroughLabel,
    passthroughHint,
    compat,
    compatNote,
}) => {
    const rootRef = useRef<HTMLDivElement | null>(null);

    const close = useCallback(() => onOpenChange(false), [onOpenChange]);

    // A style that cannot run under the colour key (monet, lumiere on a light theme) disables the
    // switch instead of letting a pink haze cover the desktop.
    const blocked = compat === 'unsupported';

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
        <div className="spw-player-bg" ref={rootRef} data-flat={enabled ? 'true' : 'false'} data-compat={compat}>
            <div
                className="spw-player-bg-panel"
                data-spw-chrome="player-background-panel"
                data-open={open ? 'true' : 'false'}
                role="group"
                aria-label={label}
            >
                <button
                    type="button"
                    className="spw-player-bg-row"
                    role="switch"
                    aria-checked={enabled ? 'true' : 'false'}
                    aria-disabled={blocked ? 'true' : undefined}
                    disabled={blocked}
                    data-disabled={blocked ? 'true' : 'false'}
                    onClick={() => {
                        if (blocked) return;
                        onToggle(!enabled);
                    }}
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
                    <button
                        type="button"
                        className="spw-player-bg-row spw-player-bg-row--second"
                        role="switch"
                        aria-checked={passthrough ? 'true' : 'false'}
                        onClick={() => onTogglePassthrough(!passthrough)}
                    >
                        <span className="spw-player-bg-text">
                            <span className="spw-player-bg-label">{passthroughLabel}</span>
                            <span className="spw-player-bg-hint">{passthroughHint}</span>
                        </span>
                        <span className="spw-switch" data-on={passthrough ? 'true' : 'false'} aria-hidden="true">
                            <span className="spw-switch-knob" />
                        </span>
                    </button>
                ) : null}
                {enabled ? (
                    <p className="spw-player-bg-note">
                        {passthrough
                            ? '鼠标正落向桌面：右下角圆钮与右上角齿轮始终可点；关掉「鼠标穿透」即可操作页面。'
                            : '透明窗口内页面可正常点击；打开「鼠标穿透」可直接操作桌面。ESC 退出播放。'}
                    </p>
                ) : null}
                {compatNote ? <p className="spw-player-bg-note spw-player-bg-note--compat">{compatNote}</p> : null}
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
