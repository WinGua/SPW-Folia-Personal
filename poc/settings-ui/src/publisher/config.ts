/* Builds the `config` event the host page receives (protocol §4) and pushes it at most 10 Hz.
 * The payload is Folia's own `ObsBrowserSourceConfig`, assembled from our settings store + the
 * plugin's track/lyrics inputs, so the page can hand it to its visualizer untouched. */
import type { Line, LyricData, Theme, Word } from '@/types';
import type { ObsBrowserSourceConfig } from '@/types/obsBrowserSource';
import type { VisualizerTuningBundle } from '@/components/visualizer/tuningRegistry';
import {
    type BackgroundMode,
    type SettingsSnapshot,
    type StyleMode,
    BACKGROUND_TUNING_DEFAULTS,
    DEFAULT_COMMON_BACKGROUND,
} from '~/model/settings';
import { transparentStyleTuning } from '~/model/transparencyCompat';
import { DEFAULT_THEME } from './deriveTheme';

export const CONFIG_MIN_INTERVAL_MS = 100; // ≤10 Hz, protocol §4
export const CONFIG_JUMP_THRESHOLD_SEC = 0.35; // OBS_CLOCK_JUMP_THRESHOLD_SEC
export const CONFIG_SEED_FALLBACK = 'sonnet';

export type PlayerStateName = 'IDLE' | 'PLAYING' | 'PAUSED';
export type SubtitleContentMode = 'translation' | 'romanization' | 'both' | 'none';

export interface PublisherWord {
    text: string;
    startMs: number;
    endMs: number;
}

export interface PublisherLyricLine {
    startMs: number;
    endMs: number;
    main: string;
    sub?: string;
    romanization?: string;
    id?: string;
    words?: PublisherWord[];
}

export interface PublisherTrack {
    id: string;
    title: string;
    artist?: string | null;
    album?: string | null;
    coverUrl?: string | null;
    durationMs?: number;
    lyrics?: PublisherLyricLine[] | null;
}

export interface PublisherInputs {
    settings: SettingsSnapshot;
    track: PublisherTrack | null;
    lyricOffsetMs: number;
    playerState: PlayerStateName;
    theme: Theme;
    subtitleTheme?: Theme;
    isDaylight: boolean;
    seed?: string;
}

export interface ConfigPublisherBridge {
    pushConfig: (config: ObsBrowserSourceConfig) => void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const toSeconds = (ms: number) => Math.max(0, ms) / 1000;

/** Splits a line into per-character words when the plugin sent no finer boundaries (Folia renders
 *  word-by-word styles from `words`, and a missing array would leave the line unanimated). */
const fallbackWords = (text: string, startMs: number, endMs: number): Word[] => {
    const chars = Array.from(text);
    if (chars.length === 0) return [];
    const step = Math.max(0, endMs - startMs) / chars.length;
    return chars.map((char, index) => ({
        text: char,
        startTime: toSeconds(startMs + step * index),
        endTime: toSeconds(startMs + step * (index + 1)),
    }));
};

const toWord = (word: PublisherWord, lineStartMs: number, lineEndMs: number): Word => ({
    text: word.text,
    startTime: toSeconds(word.startMs || lineStartMs),
    endTime: toSeconds(word.endMs || lineEndMs),
});

export const buildLine = (line: PublisherLyricLine): Line => {
    const startTime = toSeconds(line.startMs);
    const endTime = toSeconds(Math.max(line.endMs, line.startMs));
    const source = line.words && line.words.length > 0 ? line.words : null;
    const words = source
        ? source.map(word => toWord(word, line.startMs, line.endMs))
        : fallbackWords(line.main, line.startMs, line.endMs);
    return {
        words,
        startTime,
        endTime,
        fullText: line.main,
        ...(line.sub ? { translation: line.sub } : {}),
        ...(line.romanization ? { romanization: line.romanization } : {}),
        ...(line.id ? { id: line.id } : {}),
    };
};

export const buildLyricData = (track: PublisherTrack | null): LyricData | null => {
    if (!track || !track.lyrics || track.lyrics.length === 0) return null;
    return {
        lines: track.lyrics.map(buildLine),
        ...(track.title ? { title: track.title } : {}),
        ...(track.artist ? { artist: track.artist } : {}),
        isWordByWord: true,
    };
};

/** The background config Folia's renderer reads (mode + per-mode tuning bags). */
export const buildBackgroundConfig = (settings: SettingsSnapshot) => {
    const tuning = (mode: keyof typeof BACKGROUND_TUNING_DEFAULTS) => ({
        tuning: { ...BACKGROUND_TUNING_DEFAULTS[mode], ...settings.backgroundTunings[mode] },
    });
    return {
        mode: settings.backgroundMode,
        // v0.1.7: the player page runs the real renderer, so transparency is a real window property
        // (host colour-key) plus `background.transparent` for Folia's own background renderer.
        transparent: settings.transparentPlayerBackground === true,
        common: { ...DEFAULT_COMMON_BACKGROUND, ...settings.commonBackground },
        latent: tuning('latent'),
        monet: tuning('monet'),
        nomand: tuning('nomand'),
        sora: tuning('sora'),
        url: { items: [], selectedId: null },
    };
};

/** Every style's tuning, keyed by mode exactly as Folia's `VisualizerTuningBundle` expects.
 *
 *  v0.1.11: while the player window is transparent, styles that paint a large semi-transparent
 *  plate get a render-only override merged in (see `model/transparencyCompat.ts`). The override is
 *  applied here and not in the settings store, so it disappears as soon as transparency is off and
 *  the user's own tuning values are never touched. */
export const buildTuningBundle = (
    settings: SettingsSnapshot,
    options?: { transparent?: boolean; isDaylight?: boolean },
): VisualizerTuningBundle => {
    const bundle: Record<string, Record<string, unknown>> = {};
    for (const [mode, tuning] of Object.entries(settings.styleTunings)) {
        if (mode === 'still') continue;
        bundle[mode] = tuning;
    }
    if (options?.transparent === true) {
        const styleMode = settings.styleId as StyleMode;
        const override = transparentStyleTuning(styleMode, { isDaylight: options.isDaylight === true });
        if (override) bundle[styleMode] = { ...bundle[styleMode], ...override };
    }
    return bundle as VisualizerTuningBundle;
};

export const buildConfig = ({ settings, track, theme, subtitleTheme, isDaylight, seed }: PublisherInputs): ObsBrowserSourceConfig => {
    const appearance = settings.appearance;
    const subtitle = settings.subtitle;
    const lyrics = buildLyricData(track);
    // v0.1.3: the injected page only receives translation data from the plugin, so a persisted
    // romanization / both selection degrades to translation instead of rendering nothing.
    const subtitleContentMode: SubtitleContentMode = subtitle.subtitleContentMode === 'romanization'
        || subtitle.subtitleContentMode === 'both'
        ? 'translation'
        : subtitle.subtitleContentMode as SubtitleContentMode;
    const coverUrl = track?.coverUrl ?? null;
    const config: ObsBrowserSourceConfig = {
        activePlaybackContext: 'main',
        stageSource: null,
        hasTrack: Boolean(track),
        song: track ? { id: track.id, name: track.title } : null,
        songArtist: track?.artist ?? null,
        songAlbum: track?.album ?? null,
        coverUrl,
        lyrics,
        theme: theme ?? DEFAULT_THEME,
        subtitleTheme: subtitleTheme ?? theme ?? DEFAULT_THEME,
        isDaylight,
        visualizerMode: settings.styleId as ObsBrowserSourceConfig['visualizerMode'],
        visualizerTunings: buildTuningBundle(settings, {
            transparent: settings.transparentPlayerBackground === true,
            isDaylight,
        }),
        background: buildBackgroundConfig(settings) as ObsBrowserSourceConfig['background'],
        lyricsFontScale: clamp(appearance.fontScale, 0.85, 1.4),
        subtitleFontScale: clamp(subtitle.subtitleFontScale, 0.85, 1.4),
        visualizerOpacity: clamp(appearance.visualizerOpacity, 0.2, 1),
        subtitleOverlayOpacity: clamp(subtitle.subtitleOverlayOpacity, 0.2, 1),
        subtitleOverlayBackground: subtitle.subtitleOverlayBackground,
        subtitleUpcomingLyricsBlur: subtitle.subtitleUpcomingLyricsBlur,
        // No harmony data arrives from the plugin, so the harmony overlay is always off (v0.1.3).
        showHarmonySubtitle: false,
        harmonySubtitleBackground: false,
        staticMode: false,
        hideTranslationSubtitle: subtitle.hideTranslationSubtitle,
        showSubtitleTranslation: !subtitle.hideTranslationSubtitle && subtitleContentMode !== 'none',
        subtitleContentMode,
        seed: seed ?? track?.id ?? CONFIG_SEED_FALLBACK,
        updatedAt: Date.now(),
    };
    return config;
};

/** Everything the config depends on except the timestamp: equal signatures mean nothing to push. */
export const configSignature = (config: ObsBrowserSourceConfig): string => {
    const { updatedAt: _updatedAt, ...rest } = config;
    return JSON.stringify(rest);
};

/** Debounces pushes into one per `CONFIG_MIN_INTERVAL_MS` and drops identical payloads. */
export class ConfigPublisher {
    private readonly bridge: ConfigPublisherBridge;
    private inputs: PublisherInputs;
    private lastSignature = '';
    private lastPushAt = 0;
    private timer: number | null = null;
    private disposed = false;

    constructor(bridge: ConfigPublisherBridge, inputs: PublisherInputs) {
        this.bridge = bridge;
        this.inputs = inputs;
    }

    update(patch: Partial<PublisherInputs>): void {
        this.inputs = { ...this.inputs, ...patch };
        this.schedule();
    }

    /** Push now if the payload changed (hosts call this after a drag ends). */
    flush(): void {
        if (this.disposed) return;
        const config = buildConfig(this.inputs);
        const signature = configSignature(config);
        if (signature === this.lastSignature) return;
        this.lastSignature = signature;
        this.lastPushAt = performance.now();
        this.bridge.pushConfig({ ...config, updatedAt: Date.now() });
    }

    /** Forces the next flush through even when the payload is unchanged (host asks for a repaint). */
    invalidate(): void {
        this.lastSignature = '';
        this.schedule();
    }

    dispose(): void {
        this.disposed = true;
        if (this.timer != null) window.clearTimeout(this.timer);
        this.timer = null;
    }

    private schedule(): void {
        if (this.disposed || this.timer != null) return;
        const wait = Math.max(0, CONFIG_MIN_INTERVAL_MS - (performance.now() - this.lastPushAt));
        this.timer = window.setTimeout(() => {
            this.timer = null;
            this.flush();
        }, wait);
    }
}
