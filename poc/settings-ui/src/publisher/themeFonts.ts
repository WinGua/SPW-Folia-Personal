/* v0.1.3: maps the 字体 / 字幕字体 controls onto Folia's derived Theme.
 *
 * Before this module the settings page showed 字体族 / 字重 controls but the derived theme always
 * hard-coded `fontStyle: 'sans'` and never set `fontWeight`, so the visualizer ignored them (they
 * were listed in docs/known-inert-settings.md group C). Folia's renderer resolves the concrete font
 * stack from `Theme.fontStyle` / `Theme.fontWeight` (see
 * work/folia/folia-major-main/src/components/visualizer/preview/GlowWord.tsx and
 * visualizer/VisualizerShell.tsx), so applying the selected values to the theme is enough.
 *
 * Custom font families are no longer offered (the injected page has no font source — group B), so a
 * persisted 'custom' choice from an older settings file degrades to 'sans'. */
import type { Theme } from '@/types';

export interface ThemeFontInputs {
    fontStyle?: string | null;
    fontWeight?: number | null;
}

const FONT_STYLES: Theme['fontStyle'][] = ['sans', 'serif', 'mono'];

const normalizeFontStyle = (value: string | null | undefined): Theme['fontStyle'] =>
    FONT_STYLES.includes(value as Theme['fontStyle']) ? (value as Theme['fontStyle']) : 'sans';

/** Returns a copy of `theme` with the selected font family and weight applied. */
export const applyThemeFonts = (theme: Theme, inputs: ThemeFontInputs): Theme => {
    const next: Theme = { ...theme, fontStyle: normalizeFontStyle(inputs.fontStyle) };
    // The renderer resolves the stack from fontStyle when no explicit family is set; keeping a stale
    // custom family here would override the selection.
    delete next.fontFamily;
    delete next.fontFamilyStack;
    if (typeof inputs.fontWeight === 'number' && Number.isFinite(inputs.fontWeight)) {
        next.fontWeight = inputs.fontWeight;
    } else {
        delete next.fontWeight;
    }
    return next;
};
