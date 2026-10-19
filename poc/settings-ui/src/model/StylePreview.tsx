/* The stage's big sample frame. Folia draws its live renderer here; the injected settings window
 * shows a real captured frame of the selected style instead (docs/folia-spec/assets.md explains
 * why: the live renderer needs the full playback data pipeline).
 *
 * Switching styles crossfades: the outgoing frame stays behind while the incoming one animates in
 * via the `spw-preview-in` CSS keyframes. NOTE: a previous implementation drove both layers from a
 * `fading` boolean inside an effect keyed on [src, current]; because setCurrent() retriggered the
 * effect, its cleanup cancelled the crossfade timers and the preview could stay on the old style
 * (reported m03519). This version keys the effect on `src` only and never blocks the incoming frame. */
import React, { useEffect, useRef, useState } from 'react';
import { getStyleEntry } from './styles';
import type { StyleMode } from './settings';

interface StylePreviewProps {
    mode: StyleMode;
}

const CROSSFADE_MS = 220;

const StylePreview: React.FC<StylePreviewProps> = ({ mode }) => {
    const src = getStyleEntry(mode).thumb;
    const [previous, setPrevious] = useState<string | null>(null);
    const lastSrc = useRef<string>(src);

    useEffect(() => {
        if (lastSrc.current === src) return undefined;
        setPrevious(lastSrc.current);
        lastSrc.current = src;
        const timer = setTimeout(() => setPrevious(null), CROSSFADE_MS);
        return () => clearTimeout(timer);
    }, [src]);

    return (
        <>
            {previous && previous !== src && (
                <img
                    key={previous}
                    src={previous}
                    alt=""
                    aria-hidden="true"
                    draggable={false}
                    className="absolute inset-0 h-full w-full object-cover"
                />
            )}
            <img
                key={src}
                src={src}
                alt={getStyleEntry(mode).labelFallback}
                draggable={false}
                className="spw-preview-in absolute inset-0 h-full w-full object-cover"
            />
        </>
    );
};

export default StylePreview;
