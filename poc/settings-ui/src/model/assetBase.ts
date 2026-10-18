/* Resolves files shipped next to the built entry (dist/styles/*.jpg). The host injects the entry as
 * https://spw-folia-settings.local/settings-ui.js while the page origin is Folia's
 * https://spw-folia.local, so a root-relative '/styles/x.jpg' would resolve against the wrong
 * origin. The bundle base therefore comes from the injected <script> tag itself; dev.html (plain
 * Vite server, no host) falls back to the dev-origin root, where `public/styles` is served. */

const BUNDLE_ENTRY_PATTERN = /\/settings-ui(?:-[^/]*)?\.js(?:\?|$)/;

let cachedBase: string | null = null;

const resolveBundleBase = (): string => {
    if (cachedBase) return cachedBase;
    const script = Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'))
        .map(item => item.src)
        .find(src => BUNDLE_ENTRY_PATTERN.test(src));
    cachedBase = script ? new URL('.', script).href : `${location.origin}/`;
    return cachedBase;
};

/** Absolute URL of an asset inside the settings bundle (e.g. 'styles/sonnet.jpg'). */
export const resolveBundleAsset = (path: string): string => {
    const clean = path.replace(/^\.?\//, '');
    try {
        return new URL(clean, resolveBundleBase()).href;
    } catch {
        return `./${clean}`;
    }
};

/** Static preview frame for one lyric style (built from the real renderer, see doc). */
export const stylePreviewUrl = (mode: string): string => resolveBundleAsset(`thumbs/${mode}.jpg`);
