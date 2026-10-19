// Vite config for the injected spw-folia settings UI.
//
// The UI is a React island on top of Folia's own settings-kit components: it imports them straight
// out of the Folia checkout (work/folia/folia-major-main/src) instead of copying them, so the
// injected page looks exactly like Folia's own 歌词样式 window. Everything that Folia's components
// touch outside a browser (stores, registries, analysis models) is mapped to a stub under ./src/stubs
// by the `folia-stubs` plugin: the stubs keep the same selector/return shapes but read from this
// page's own settings store.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(here, '../..');
const foliaSrc = path.join(workspaceRoot, 'work/folia/folia-major-main/src');
const stubs = path.join(here, 'src/stubs');

/** Folia module specifier -> stub file. Applied only when the importer is a Folia source file. */
const STUB_RULES: Array<[RegExp, string]> = [
    // Tail-matched on purpose: Folia imports these both through '@/...' and through relative
    // specifiers, so the patterns cannot assume a full path from src/.
    [/useVisualizerSettingsStore$/, 'useVisualizerSettingsStore.ts'],
    [/usePlayerChromeSettingsStore$/, 'usePlayerChromeSettingsStore.ts'],
    [/useVisualizerAssetStore$/, 'useVisualizerAssetStore.ts'],
    [/useStatusMessageStore$/, 'useStatusMessageStore.ts'],
    [/useThemeSettingsStore$/, 'useThemeSettingsStore.ts'],
    [/useSmartBeatAvailability$/, 'useSmartBeatAvailability.ts'],
    [/services\/analysis\/modelAvailability$/, 'modelAvailability.ts'],
    [/visualizer\/backgrounds\/registry$/, 'backgrounds.tsx'],
    [/(?:^|\/)backgrounds\/registry$/, 'backgrounds.tsx'],
    [/preview\/BackgroundPicture$/, 'BackgroundPicture.tsx'],
    [/mods\/folium\/registries\/tunings$/, 'foliumTunings.tsx'],
    [/mods\/folium\/registries\/backgrounds$/, 'foliumBackgrounds.tsx'],
    [/mods\/folium\/registries\/visualizers$/, 'foliumVisualizers.ts'],
    [/mods\/runtime\/registry$/, 'foliumRuntime.ts'],
    [/mods\/runtime\/missingEntries$/, 'foliumMissingEntries.ts'],
    [/services\/temperaImageArchive$/, 'temperaImageArchive.ts'],
    [/visualizer\/tempera\/TemperaImageLayerDialog$/, 'TemperaImageLayerDialog.tsx'],
    // Local-file pipelines: the injected page has no local library, no tag parser worker and no
    // IndexedDB image cache, but some settings panels import their helpers transitively.
    [/localMetadataWorkerClient$/, 'localMetadataWorkerClient.ts'],
    [/lyrics\/workerClient$/, 'lyricsWorkerClient.ts'],
    [/lyrics\/parserCore$/, 'lyricsParserCore.ts'],
    [/services\/db$/, 'db.ts'],
    [/services\/localCoverAssetService$/, 'localCoverAssetService.ts'],
    [/services\/localMusicService$/, 'localMusicService.ts'],
];

const foliaSrcPosix = foliaSrc.replace(/\\/g, '/');

const foliaStubs = (): Plugin => ({
    name: 'spw-folia-stubs',
    enforce: 'pre',
    resolveId(source, importer) {
        // Ids reach this hook with forward slashes on every platform; compare in that form.
        if (!importer || !importer.replace(/\\/g, '/').startsWith(foliaSrcPosix)) {
            return null;
        }
        for (const [pattern, file] of STUB_RULES) {
            if (pattern.test(source)) {
                return path.join(stubs, file);
            }
        }
        return null;
    },
});

/** Injects the built CSS into the entry module: the host adds only one <script> tag, so a separate
 *  stylesheet would never be requested — the window must carry its own styles. */
const inlineCssIntoEntry = (): Plugin => ({
    name: 'spw-inline-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
        const cssKeys = Object.keys(bundle).filter(key => key.endsWith('.css'));
        if (cssKeys.length === 0) return;
        const css = cssKeys
            .map(key => {
                const asset = bundle[key];
                return asset && asset.type === 'asset' ? String(asset.source) : '';
            })
            .join('\n');
        for (const key of cssKeys) delete bundle[key];
        for (const chunk of Object.values(bundle)) {
            if (chunk.type !== 'chunk' || !chunk.isEntry) continue;
            chunk.code = `(function(){if(typeof document==='undefined')return;if(document.querySelector('style[data-spw-settings-ui-css]'))return;var s=document.createElement('style');s.setAttribute('data-spw-settings-ui-css','');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})();\n${chunk.code}`;
        }
    },
});

const debugWhoImports = (): Plugin => ({
    name: 'spw-debug-importer',
    enforce: 'pre',
    resolveId(source, importer) {
        const pattern = process.env.SPW_DEBUG_IMPORTERS;
        if (pattern && new RegExp(pattern).test(source)) {
            console.log('[importer]', source, '<-', importer);
        }
        return null;
    },
});

/** Removes Folia's 智能动感模式 card from the reused settings panel.
 *
 *  Folia renders that card from SmartBeatSettingsCard inside VisPlaygroundSettingsPanel; the card
 *  only makes sense when the beat-analysis models (beat_this / htdemucs WebGPU) are present. Folia's
 *  desktop app ships them; the injected page has no such models and no beat stream, so the switch
 *  could never take effect — spw-folia v0.1.2 removes it instead of showing a dead toggle (the
 *  per-effect 动感效果 rows stay visible and are documented as unavailable in this integration).
 *  The transform fails the build when the marker is gone so a future Folia source update cannot
 *  silently bring the switch back. */
const stripSmartBeatCard = (): Plugin => ({
    name: 'spw-folia-strip-smart-beat',
    enforce: 'pre',
    transform(code, id) {
        const normalized = id.replace(/\\/g, '/');
        if (!normalized.endsWith('/components/visualizer/window/VisPlaygroundSettingsPanel.tsx')) return null;
        const marker = '<SmartBeatSettingsCard t={t} />';
        if (!code.includes(marker)) {
            throw new Error('[spw-folia-strip-smart-beat] SmartBeatSettingsCard marker not found — Folia source changed, update the strip transform');
        }
        const replacement = '{/* spw-folia: the 智能动感模式 switch is removed here — beat models are unavailable in the injected page (v0.1.2). */}';
        let next = code.replace(marker, replacement);
        // Drop the now-unused import so the card's module and its stores are not pulled into the bundle.
        next = next.replace(/^import SmartBeatSettingsCard from '[^']*';\r?\n/m, '');
        return { code: next, map: null };
    },
});

export default defineConfig({
    base: './',
    plugins: [stripSmartBeatCard(), react(), foliaStubs(), debugWhoImports(), inlineCssIntoEntry(), tailwindcss()],
    resolve: {
        alias: [
            { find: /^@\//, replacement: `${foliaSrc}/` },
            { find: /^~\//, replacement: path.join(here, 'src') + '/' },
        ],
        // Folia's source has no node_modules of its own: every bare import resolves from this project.
        dedupe: ['react', 'react-dom', 'framer-motion', 'lucide-react', 'i18next', 'react-i18next', 'zustand', 'react-colorful', 'react-window', 'dexie'],
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        target: 'chrome110',
        assetsInlineLimit: 0,
        cssCodeSplit: false,
        rollupOptions: {
            // The injected page loads exactly one module: the settings window bundle. HTML pages are
            // dev-only (`pnpm dev`), because the host page is Folia's own dist index.html.
            input: { settings: path.join(here, 'src/main.tsx') },
            output: {
                format: 'es',
                entryFileNames: 'settings-ui.js',
                chunkFileNames: 'assets/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash][extname]',
            },
        },
    },
    server: { port: 18090, strictPort: true },
    preview: { port: 18091, strictPort: true },
});
