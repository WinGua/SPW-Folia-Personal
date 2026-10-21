/* Theme + kit visual constants for the settings window, taken from Folia's preview defaults
 * (VisPlayground.tsx:288-303) so the reused cards look exactly like the desktop window. */
import type { Theme } from '@/types';
import { colorWithAlpha } from '@/components/visualizer/colorMix';

export const IS_DAYLIGHT = false;

/* v0.3.0: while the player window is transparent, the text colours follow the *system* colour
 * scheme (Windows dark/light mode), not the cover's darkness. The host injects no theme value of
 * its own (poc/webview only knows Folia's `"colorScheme": "default"`), so the page asks Chromium's
 * `prefers-color-scheme`, which WebView2 keeps in step with the Windows app mode. */

/** True when the system colour scheme is light (dark when matchMedia is unavailable). */
export const systemPrefersLight = (): boolean =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? !window.matchMedia('(prefers-color-scheme: dark)').matches
        : false;

/** Subscribes to system colour scheme flips; returns the unsubscribe function. */
export const onSystemSchemeChange = (listener: (isLight: boolean) => void): (() => void) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const notify = () => listener(!query.matches);
    query.addEventListener('change', notify);
    return () => query.removeEventListener('change', notify);
};

/** The preview song's theme (Folia draws the sample stage on the theme background colour). */
export const PREVIEW_THEME: Theme = {
    name: 'Midnight Default',
    backgroundColor: '#09090b',
    primaryColor: '#f4f4f5',
    accentColor: '#f4f4f5',
    secondaryColor: '#71717a',
    fontStyle: 'sans',
    animationIntensity: 'normal',
};

export const CONTROL_CARD_BG = colorWithAlpha(PREVIEW_THEME.backgroundColor, IS_DAYLIGHT ? 0.42 : 0.52);

/** Slider paint: the kit draws the track/thumb; the sample stage needs the same classes Folia uses. */
export const RANGE_INPUT_CLASS = [
    'w-full h-1.5 rounded-full appearance-none cursor-pointer',
    '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:hover:scale-125 [&::-webkit-slider-thumb]:transition-transform',
    '[&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:transition-transform',
    IS_DAYLIGHT
        ? 'bg-black/15 [&::-webkit-slider-thumb]:bg-zinc-700 [&::-moz-range-thumb]:bg-zinc-700'
        : 'bg-white/10 [&::-webkit-slider-thumb]:bg-white [&::-moz-range-thumb]:bg-white',
].join(' ');

export const FONT_SCALE_OPTIONS = [
    { label: '90%', value: 0.9 },
    { label: '100%', value: 1 },
    { label: '110%', value: 1.1 },
    { label: '125%', value: 1.25 },
];

export const FONT_WEIGHT_OPTIONS = [
    { label: '纤细', value: 300 },
    { label: '常规', value: 400 },
    { label: '粗体', value: 700 },
];
