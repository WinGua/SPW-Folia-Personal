/* v0.2.0: per-style compatibility with the transparent (colour-key) player window.
 *
 * The player window is made transparent with a colour key: every pixel the page draws with
 * alpha < 1 gets mixed with the key colour (pure magenta) and shows up as a pink haze in the
 * real window. A style is only usable while the window is transparent when what it paints is
 * either fully opaque (glyphs, line art) or fully transparent — large semi-transparent plates
 * are not.
 *
 * Measured with the alpha probes (docs/archive/verification-v0.2.0.md):
 *  - `native`: the style leaves nothing but glyphs / line art on screen once Folia's own
 *    background renderer is switched off by `background.transparent` (alpha coverage < 24%).
 *  - `tuned`: the style has a full-screen or otherwise large semi-transparent layer that can be
 *    removed through its own tuning (or a scoped CSS rule for `still`). While the window is
 *    transparent the published config carries an extra tuning override; the player's stored
 *    settings are untouched, so the original look comes back as soon as transparency is off.
 *  - `unsupported`: no tuning can remove the layer (monet paints the portrait plate, which is
 *    part of the style's identity; lumiere forces a 94% dark field on light themes). Selecting
 *    the style turns the transparent window off (see `useSettingsStore`).
 */
import type { StyleMode } from './settings';

export type TransparencyCompat = 'native' | 'tuned' | 'unsupported';

export interface TransparencyCompatContext {
    /** True when the cover-derived theme is a light one (`deriveThemeFromCover`). */
    isDaylight: boolean;
}

const STYLE_COMPAT: Record<StyleMode, TransparencyCompat> = {
    sonnet: 'native',
    tempera: 'tuned',
    lumiere: 'tuned',
    classic: 'native',
    cadenza: 'native',
    partita: 'native',
    fume: 'native',
    tilt: 'native',
    claddagh: 'native',
    monet: 'unsupported',
    pendolo: 'tuned',
    cappella: 'native',
    diorama: 'native',
    still: 'tuned',
};

export const getStyleTransparencyCompat = (
    mode: StyleMode,
    context?: TransparencyCompatContext,
): TransparencyCompat => {
    // 绘光's dark field keeps a 94% alpha floor on light themes (lumiereDarkField.ts), so no
    // tuning can make it transparent there — the plate would cover the whole keyed window.
    if (mode === 'lumiere' && context?.isDaylight === true) return 'unsupported';
    return STYLE_COMPAT[mode] ?? 'native';
};

export const isTransparencySupported = (mode: StyleMode, context?: TransparencyCompatContext): boolean =>
    getStyleTransparencyCompat(mode, context) !== 'unsupported';

/* ---------------------------------------------------------------------------------------------
 * Render-only overrides applied while the player window is transparent. They are merged into the
 * published `visualizerTunings` bundle (`publisher/config.ts`), never into the settings store, so
 * the user's own values survive and come back when transparency is switched off.
 * ------------------------------------------------------------------------------------------- */

/** Extra tuning for one style that removes its large semi-transparent layers. */
export const transparentStyleTuning = (
    mode: StyleMode,
    context: TransparencyCompatContext,
): Record<string, unknown> | null => {
    if (getStyleTransparencyCompat(mode, context) !== 'tuned') return null;
    switch (mode) {
        case 'tempera':
            // 35% paper wash + screentone dots (`temperaSceneBuilder.ts`), plus the post-process
            // grain/vignette that are painted over the whole canvas.
            return { showBlocks: false, postProcessGrain: 0, postProcessVignette: 0 };
        case 'lumiere':
            // 75% dark field (`lumiereDarkField.ts`) + the light field / dust / line art groups.
            return { darkField: 0, textOnly: true };
        case 'pendolo':
            // The centre radial gradient is a ~72%-alpha disc across the watch face.
            return { showCenterGradient: false };
        default:
            return null;
    }
};
