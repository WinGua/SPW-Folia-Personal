/* Background swatches for the 背景 tab. Folia's BackgroundPicture mounts the real background layer
 * (WebGL/canvas) inside a PictureFrame and falls back to the mode glyph when no live image can be
 * made; the injected bundle draws the same static frame + glyph, not the layer. */
import React from 'react';
import { getVisualizerBackgroundRegistryEntry } from '~/stubs/backgrounds';
import { PREVIEW_THEME } from '~/model/theme';

interface BackgroundPictureProps {
    mode: string;
    visible?: boolean;
    chosen?: boolean;
    active?: boolean;
}

const BackgroundPicture: React.FC<BackgroundPictureProps> = ({ mode, visible = true }) => {
    const glyph = getVisualizerBackgroundRegistryEntry(mode).glyph;
    return (
        <span
            className="pointer-events-none absolute inset-0 block overflow-hidden"
            style={{
                backgroundColor: PREVIEW_THEME.backgroundColor,
                color: PREVIEW_THEME.primaryColor,
                opacity: visible ? 1 : 0,
            }}
        >
            {glyph ? <span className="absolute inset-0 grid place-items-center opacity-50">{glyph}</span> : null}
        </span>
    );
};

export default BackgroundPicture;
