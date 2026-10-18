/* Cover → Theme derivation, done in the page from the cover data URL (protocol §4): the host only
 * hands over bytes, the page picks the colours with a canvas so the palette matches the artwork. */
import type { Theme } from '@/types';

const DARK_FALLBACK: Theme = {
    name: 'Midnight Default',
    backgroundColor: '#09090b',
    primaryColor: '#f4f4f5',
    accentColor: '#f4f4f5',
    secondaryColor: '#71717a',
    fontStyle: 'sans',
    animationIntensity: 'normal',
};

interface Rgb {
    r: number;
    g: number;
    b: number;
}

const clampByte = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

const toHex = ({ r, g, b }: Rgb) =>
    `#${clampByte(r).toString(16).padStart(2, '0')}${clampByte(g).toString(16).padStart(2, '0')}${clampByte(b).toString(16).padStart(2, '0')}`;

const luminance = ({ r, g, b }: Rgb) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

const saturation = ({ r, g, b }: Rgb) => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max === 0 ? 0 : (max - min) / max;
};

const mix = (a: Rgb, b: Rgb, amount: number): Rgb => ({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
});

const scale = (color: Rgb, factor: number): Rgb => ({ r: color.r * factor, g: color.g * factor, b: color.b * factor });

/** The average colour of a canvas' pixels, plus its most saturated bucket (the accent). */
const sampleColors = (canvas: HTMLCanvasElement): { average: Rgb; accent: Rgb } => {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return { average: { r: 9, g: 9, b: 11 }, accent: { r: 244, g: 244, b: 245 } };
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    const buckets = new Map<string, { sum: Rgb; n: number; sat: number }>();
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        const color = { r: data[i], g: data[i + 1], b: data[i + 2] };
        r += color.r;
        g += color.g;
        b += color.b;
        count += 1;
        const key = `${color.r >> 5}-${color.g >> 5}-${color.b >> 5}`;
        const bucket = buckets.get(key) ?? { sum: { r: 0, g: 0, b: 0 }, n: 0, sat: 0 };
        bucket.sum.r += color.r;
        bucket.sum.g += color.g;
        bucket.sum.b += color.b;
        bucket.n += 1;
        buckets.set(key, bucket);
    }
    if (count === 0) return { average: { r: 9, g: 9, b: 11 }, accent: { r: 244, g: 244, b: 245 } };
    const average = { r: r / count, g: g / count, b: b / count };
    let accent = average;
    let best = -1;
    for (const bucket of buckets.values()) {
        const mean = { r: bucket.sum.r / bucket.n, g: bucket.sum.g / bucket.n, b: bucket.sum.b / bucket.n };
        const score = saturation(mean) * Math.log2(bucket.n + 2);
        if (score > best) {
            best = score;
            accent = mean;
        }
    }
    return { average, accent };
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('cover image failed to load'));
        image.src = src;
    });

/** Builds a Folia Theme from a cover image; `isDaylight` says whether the result is a light theme. */
export const deriveThemeFromCover = async (coverUrl: string | null | undefined, name?: string): Promise<{ theme: Theme; isDaylight: boolean }> => {
    if (!coverUrl) return { theme: DARK_FALLBACK, isDaylight: false };
    try {
        const image = await loadImage(coverUrl);
        const canvas = document.createElement('canvas');
        canvas.width = 48;
        canvas.height = 48;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return { theme: DARK_FALLBACK, isDaylight: false };
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const { average, accent } = sampleColors(canvas);
        const isLight = luminance(average) > 0.55;
        const background = isLight ? mix(average, { r: 255, g: 255, b: 255 }, 0.45) : scale(average, 0.28);
        const primary = isLight ? scale(background, 0.16) : mix(average, { r: 255, g: 255, b: 255 }, 0.9);
        const accentColor = saturation(accent) < 0.12 ? mix(primary, accent, 0.4) : mix(accent, { r: 255, g: 255, b: 255 }, 0.15);
        const secondary = mix(primary, background, 0.55);
        const theme: Theme = {
            name: name ?? 'Cover Theme',
            backgroundColor: toHex(background),
            primaryColor: toHex(primary),
            accentColor: toHex(accentColor),
            secondaryColor: toHex(secondary),
            fontStyle: 'sans',
            animationIntensity: 'normal',
        };
        return { theme, isDaylight: isLight };
    } catch {
        return { theme: DARK_FALLBACK, isDaylight: false };
    }
};

export const DEFAULT_THEME = DARK_FALLBACK;
