/* The stage's big sample frame. Folia draws its live renderer here; the injected settings window
 * shows a real captured frame of the selected style instead (docs/folia-spec/assets.md explains
 * why: the live renderer needs the full playback data pipeline). Switching styles crossfades. */
import React, { useEffect, useState } from 'react';
import { stylePreviewUrl } from './assetBase';
import { getStyleEntry } from './styles';
import type { StyleMode } from './settings';

interface StylePreviewProps {
    mode: StyleMode;
}

const CROSSFADE_MS = 220;

const StylePreview: React.FC<StylePreviewProps> = ({ mode }) => {
    const src = getStyleEntry(mode).thumb;
    const [current, setCurrent] = useState(src);
    const [previous, setPrevious] = useState<string | null>(null);
    const [fading, setFading] = useState(false);

    useEffect(() => {
        if (src === current) return undefined;
        setPrevious(current);
        setCurrent(src);
        setFading(false);
        // Two frames: start the outgoing one opaque, then flip so the incoming image fades in.
        const raf = requestAnimationFrame(() => setFading(true));
        const timer = setTimeout(() => {
            setPrevious(null);
            setFading(false);
        }, CROSSFADE_MS);
        return () => {
            cancelAnimationFrame(raf);
            clearTimeout(timer);
        };
    }, [src, current]);

    return (
        <>
            {previous && (
                <img
                    key={previous}
                    src={previous}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    className="absolute inset-0 h-full w-full object-cover"
                    style={{ opacity: fading ? 0 : 1, transition: `opacity ${CROSSFADE_MS}ms ease` }}
                />
            )}
            <img
                key={current}
                src={current}
                alt={getStyleEntry(mode).labelFallback}
                draggable={false}
                className="absolute inset-0 h-full w-full object-cover"
                style={{ opacity: previous ? (fading ? 1 : 0) : 1, transition: `opacity ${CROSSFADE_MS}ms ease` }}
            />
        </>
    );
};

export default StylePreview;
