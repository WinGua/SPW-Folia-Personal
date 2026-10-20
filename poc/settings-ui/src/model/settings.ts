/* The POC's configuration store. Field names and defaults mirror Folia's own settings store (its
 * `src/types.ts` defaults) so the reused settings panels can be handed the exact shape they expect;
 * only the persistence layer differs (memory + host bridge here). */
import { create } from 'zustand';
import {
    DEFAULT_CADENZA_TUNING,
    DEFAULT_CAPPELLA_TUNING,
    DEFAULT_CLADDAGH_TUNING,
    DEFAULT_CLASSIC_TUNING,
    DEFAULT_DIORAMA_TUNING,
    DEFAULT_FUME_TUNING,
    DEFAULT_LATENT_BACKGROUND_TUNING,
    DEFAULT_LUMIERE_TUNING,
    DEFAULT_MONET_BACKGROUND_TUNING,
    DEFAULT_MONET_TUNING,
    DEFAULT_NOMAND_BACKGROUND_TUNING,
    DEFAULT_PARTITA_TUNING,
    DEFAULT_PENDOLO_TUNING,
    DEFAULT_SMART_BEAT_SETTINGS,
    DEFAULT_SONNET_TUNING,
    DEFAULT_SORA_BACKGROUND_TUNING,
    DEFAULT_TEMPERA_TUNING,
    DEFAULT_TILT_TUNING,
    type SmartBeatSettings,
} from '@/types';
import { getStyleTransparencyCompat } from './transparencyCompat';

export type StyleMode =
    | 'sonnet'
    | 'tempera'
    | 'lumiere'
    | 'classic'
    | 'cadenza'
    | 'partita'
    | 'fume'
    | 'tilt'
    | 'claddagh'
    | 'monet'
    | 'pendolo'
    | 'cappella'
    | 'diorama'
    | 'still';

export type BackgroundMode = 'common' | 'monet' | 'nomand' | 'latent' | 'url' | 'sora';

export type SettingsSection = 'visualizer' | 'background' | 'common' | 'subtitle';

export type FontChoice = 'sans' | 'serif' | 'mono' | 'custom';

export type PreviewPlaceholderId = 'default' | 'reserved';

/** Each style's tuning defaults, imported from Folia so its own panel shows Folia's values. */
export const STYLE_TUNING_DEFAULTS: Record<StyleMode, Record<string, unknown>> = {
    sonnet: { ...DEFAULT_SONNET_TUNING },
    tempera: { ...DEFAULT_TEMPERA_TUNING },
    lumiere: { ...DEFAULT_LUMIERE_TUNING },
    classic: { ...DEFAULT_CLASSIC_TUNING },
    cadenza: { ...DEFAULT_CADENZA_TUNING },
    partita: { ...DEFAULT_PARTITA_TUNING },
    fume: { ...DEFAULT_FUME_TUNING },
    tilt: { ...DEFAULT_TILT_TUNING },
    claddagh: { ...DEFAULT_CLADDAGH_TUNING },
    monet: { ...DEFAULT_MONET_TUNING },
    pendolo: { ...DEFAULT_PENDOLO_TUNING },
    cappella: { ...DEFAULT_CAPPELLA_TUNING },
    diorama: { ...DEFAULT_DIORAMA_TUNING },
    still: {},
};

/** Folia's settings keys for each style's tuning: `settings.<key>` is what a style's panel sees. */
export const STYLE_TUNING_KEYS: Record<StyleMode, string> = {
    sonnet: 'sonnetTuning',
    tempera: 'temperaTuning',
    lumiere: 'lumiereTuning',
    classic: 'classicTuning',
    cadenza: 'cadenzaTuning',
    partita: 'partitaTuning',
    fume: 'fumeTuning',
    tilt: 'tiltTuning',
    claddagh: 'claddaghTuning',
    monet: 'monetTuning',
    pendolo: 'pendoloTuning',
    cappella: 'cappellaTuning',
    diorama: 'dioramaTuning',
    still: 'stillTuning',
};

export const BACKGROUND_TUNING_DEFAULTS: Record<'monet' | 'nomand' | 'latent' | 'sora', Record<string, unknown>> = {
    monet: { ...DEFAULT_MONET_BACKGROUND_TUNING },
    nomand: { ...DEFAULT_NOMAND_BACKGROUND_TUNING },
    latent: { ...DEFAULT_LATENT_BACKGROUND_TUNING },
    sora: { ...DEFAULT_SORA_BACKGROUND_TUNING },
};

export interface CommonBackgroundSettings {
    opacity: number;
    useCoverColorBg: boolean;
    disableVignette: boolean;
    disableGeometricBackground: boolean;
}

export interface AppearanceSettings {
    fontStyle: FontChoice;
    fontScale: number;
    fontWeight: number | null;
    visualizerOpacity: number;
    customFontFamily: string | null;
}

export interface SubtitleSettings {
    hideTranslationSubtitle: boolean;
    subtitleContentMode: 'translation' | 'romanization' | 'both' | 'none';
    subtitleOverlayOpacity: number;
    subtitleOverlayBackground: boolean;
    subtitleUpcomingLyricsBlur: boolean;
    showHarmonySubtitle: boolean;
    harmonySubtitleBackground: boolean;
    subtitleFontInheritsLyrics: boolean;
    subtitleFontStyle: FontChoice;
    subtitleFontWeight: number | null;
    subtitleFontScale: number;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
    fontStyle: 'sans',
    fontScale: 1,
    fontWeight: null,
    visualizerOpacity: 1,
    customFontFamily: null,
};

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
    hideTranslationSubtitle: false,
    subtitleContentMode: 'translation',
    subtitleOverlayOpacity: 0.6,
    subtitleOverlayBackground: true,
    subtitleUpcomingLyricsBlur: true,
    showHarmonySubtitle: true,
    harmonySubtitleBackground: true,
    subtitleFontInheritsLyrics: true,
    subtitleFontStyle: 'sans',
    subtitleFontWeight: null,
    subtitleFontScale: 1,
};

/** Mirrored Folia storage keys (canonical tree in packaging/testdata/default-settings.json). */
export const DEFAULT_LYRIC_MOTION = 0.8;
export const DEFAULT_TEXTURE_RESOLUTION = 1.5;

export const DEFAULT_COMMON_BACKGROUND: CommonBackgroundSettings = {
    opacity: 0.75,
    useCoverColorBg: false,
    disableVignette: false,
    disableGeometricBackground: false,
};

interface BeatEffectPatch {
    on?: boolean;
    strength?: number;
}

interface SettingsState {
    activeSection: SettingsSection;
    setActiveSection: (section: SettingsSection) => void;

    visualizerMode: StyleMode;
    setVisualizerMode: (mode: StyleMode) => void;

    previewPlaceholderId: PreviewPlaceholderId;
    setPreviewPlaceholderId: (id: PreviewPlaceholderId) => void;

    /** Folia storage keys mirrored for round-trip fidelity (no control in this window yet). */
    lyricMotion: number;
    setLyricMotion: (value: number) => void;
    textureResolution: number;
    setTextureResolution: (value: number) => void;

    smartBeat: SmartBeatSettings;
    handleSetSmartBeat: (patch: { enabled?: boolean; effects?: Record<string, BeatEffectPatch> }) => void;

    styleTunings: Record<StyleMode, Record<string, unknown>>;
    setStyleTuning: (mode: StyleMode, patch: Record<string, unknown>) => void;
    resetStyleTuning: (mode: StyleMode) => void;

    /** Folia player-page transparent background: the host window goes colour-key transparent so the
     *  desktop shows through (v0.1.7). */
    transparentPlayerBackground: boolean;
    setTransparentPlayerBackground: (value: boolean) => void;

    /** v0.1.9: while the player background is transparent, let the mouse fall through to the desktop
     *  (the bottom-right round button and the top-right gear stay clickable). */
    mousePassthrough: boolean;
    setMousePassthrough: (value: boolean) => void;

    /** v0.2.0: cover-derived theme lightness, mirrored from `useConfigPublisher` so the transparent
     *  window guard can tell whether lumiere's light-theme dark field floor applies. Not persisted. */
    isDaylightTheme: boolean;
    setIsDaylightTheme: (value: boolean) => void;

    backgroundMode: BackgroundMode;
    setBackgroundMode: (mode: BackgroundMode) => void;
    backgroundTunings: Record<'monet' | 'nomand' | 'latent' | 'sora', Record<string, unknown>>;
    setBackgroundTuning: (mode: 'monet' | 'nomand' | 'latent' | 'sora', patch: Record<string, unknown>) => void;
    resetBackgroundTuning: (mode: 'monet' | 'nomand' | 'latent' | 'sora') => void;
    commonBackground: CommonBackgroundSettings;
    setCommonBackground: (patch: Partial<CommonBackgroundSettings>) => void;

    appearance: AppearanceSettings;
    setAppearance: (patch: Partial<AppearanceSettings>) => void;
    resetAppearance: () => void;

    subtitle: SubtitleSettings;
    setSubtitle: (patch: Partial<SubtitleSettings>) => void;
    resetSubtitle: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
    activeSection: 'visualizer',
    setActiveSection: activeSection => set({ activeSection }),

    visualizerMode: 'sonnet',
    // v0.2.0: some styles paint a large semi-transparent plate (monet's portrait card, lumiere's
    // light-theme dark field) that the colour-key window would turn into a pink haze. Selecting one
    // of those turns the transparent window (and mouse pass-through) back off, so the style is
    // always usable — see `model/transparencyCompat.ts`.
    setVisualizerMode: visualizerMode =>
        set(state => {
            const compat = getStyleTransparencyCompat(visualizerMode, { isDaylight: state.isDaylightTheme });
            if (compat !== 'unsupported') return { visualizerMode };
            if (!state.transparentPlayerBackground) return { visualizerMode };
            return { visualizerMode, transparentPlayerBackground: false, mousePassthrough: false };
        }),

    previewPlaceholderId: 'default',
    setPreviewPlaceholderId: previewPlaceholderId => set({ previewPlaceholderId }),

    lyricMotion: DEFAULT_LYRIC_MOTION,
    setLyricMotion: lyricMotion => set({ lyricMotion }),
    textureResolution: DEFAULT_TEXTURE_RESOLUTION,
    setTextureResolution: textureResolution => set({ textureResolution }),

    // The reference window (screenshot 1) has 智能动感模式 on, so the injected window starts the same
    // way. Folia's own stored default is `false` (src/types.ts DEFAULT_SMART_BEAT_SETTINGS); this is a
    // deliberate presentation choice, documented in docs/settings-ui-impl.md.
    smartBeat: { enabled: true, effects: {} } as SmartBeatSettings,
    handleSetSmartBeat: patch =>
        set(state => {
            const next: SmartBeatSettings = {
                enabled: patch.enabled ?? state.smartBeat.enabled,
                effects: { ...state.smartBeat.effects },
            };
            if (patch.effects) {
                for (const [id, effectPatch] of Object.entries(patch.effects)) {
                    const current = next.effects[id] ?? { on: true, strength: 1 };
                    next.effects[id] = { on: effectPatch.on ?? current.on, strength: effectPatch.strength ?? current.strength };
                }
            }
            return { smartBeat: next };
        }),

    styleTunings: JSON.parse(JSON.stringify(STYLE_TUNING_DEFAULTS)),
    setStyleTuning: (mode, patch) =>
        set(state => ({
            styleTunings: { ...state.styleTunings, [mode]: { ...state.styleTunings[mode], ...patch } },
        })),
    resetStyleTuning: mode =>
        set(state => ({
            styleTunings: { ...state.styleTunings, [mode]: { ...STYLE_TUNING_DEFAULTS[mode] } },
        })),

    transparentPlayerBackground: false,
    // v0.2.0: never let the colour key be switched on for a style that cannot render it. The panel
    // disables the switch already; this also covers the host hotkey (Ctrl+Alt+B) and the dev console.
    setTransparentPlayerBackground: transparentPlayerBackground =>
        set(state => {
            if (!transparentPlayerBackground) return { transparentPlayerBackground, mousePassthrough: false };
            const blocked = getStyleTransparencyCompat(state.visualizerMode, {
                isDaylight: state.isDaylightTheme,
            }) === 'unsupported';
            return blocked
                ? { transparentPlayerBackground: false, mousePassthrough: false }
                : { transparentPlayerBackground };
        }),

    isDaylightTheme: false,
    // v0.2.0: `lumiere` only becomes unsupported once the cover-derived theme turns out to be a
    // light one, which is known after the config publisher derives the palette. Re-check here so a
    // light cover cannot leave the window transparent with a 94%-opaque dark field behind it.
    setIsDaylightTheme: isDaylightTheme =>
        set(state => {
            if (!state.transparentPlayerBackground) return { isDaylightTheme };
            if (getStyleTransparencyCompat(state.visualizerMode, { isDaylight: isDaylightTheme }) !== 'unsupported') {
                return { isDaylightTheme };
            }
            return { isDaylightTheme, transparentPlayerBackground: false, mousePassthrough: false };
        }),

    mousePassthrough: false,
    setMousePassthrough: mousePassthrough => set({ mousePassthrough }),

    backgroundMode: 'latent',
    setBackgroundMode: backgroundMode => set({ backgroundMode }),
    backgroundTunings: JSON.parse(JSON.stringify(BACKGROUND_TUNING_DEFAULTS)),
    setBackgroundTuning: (mode, patch) =>
        set(state => ({
            backgroundTunings: { ...state.backgroundTunings, [mode]: { ...state.backgroundTunings[mode], ...patch } },
        })),
    resetBackgroundTuning: mode =>
        set(state => ({
            backgroundTunings: { ...state.backgroundTunings, [mode]: { ...BACKGROUND_TUNING_DEFAULTS[mode] } },
        })),
    commonBackground: { ...DEFAULT_COMMON_BACKGROUND },
    setCommonBackground: patch => set(state => ({ commonBackground: { ...state.commonBackground, ...patch } })),

    appearance: { ...DEFAULT_APPEARANCE },
    setAppearance: patch => set(state => ({ appearance: { ...state.appearance, ...patch } })),
    resetAppearance: () => set({ appearance: { ...DEFAULT_APPEARANCE } }),

    subtitle: { ...DEFAULT_SUBTITLE_SETTINGS },
    setSubtitle: patch => set(state => ({ subtitle: { ...state.subtitle, ...patch } })),
    resetSubtitle: () => set({ subtitle: { ...DEFAULT_SUBTITLE_SETTINGS } }),
}));

/** The `VisualizerTuningSettings` bag handed to style panels: every tuning under its settings key. */
export const selectTuningSettings = (state: SettingsState): Record<string, unknown> => {
    const bag: Record<string, unknown> = {};
    for (const mode of Object.keys(STYLE_TUNING_KEYS) as StyleMode[]) {
        bag[STYLE_TUNING_KEYS[mode]] = state.styleTunings[mode];
    }
    bag.latentBackgroundTuning = state.backgroundTunings.latent;
    bag.monetBackgroundTuning = state.backgroundTunings.monet;
    bag.nomandBackgroundTuning = state.backgroundTunings.nomand;
    bag.soraBackgroundTuning = state.backgroundTunings.sora;
    bag.smartBeat = state.smartBeat;
    return bag;
};

/** Exactly what the UI persists through the host: Folia storage-key names, JSON-serialisable. */
export interface SettingsSnapshot {
    version: 1;
    styleId: StyleMode;
    smartBeat: SmartBeatSettings;
    styleTunings: Record<StyleMode, Record<string, unknown>>;
    backgroundMode: BackgroundMode;
    backgroundTunings: Record<'monet' | 'nomand' | 'latent' | 'sora', Record<string, unknown>>;
    commonBackground: CommonBackgroundSettings;
    appearance: AppearanceSettings;
    subtitle: SubtitleSettings;
    previewPlaceholderId: PreviewPlaceholderId;
    lyricMotion: number;
    textureResolution: number;
    transparentPlayerBackground: boolean;
    mousePassthrough: boolean;
}

export const snapshotFromState = (state: SettingsState): SettingsSnapshot => ({
    version: 1,
    styleId: state.visualizerMode,
    smartBeat: state.smartBeat,
    styleTunings: state.styleTunings,
    backgroundMode: state.backgroundMode,
    backgroundTunings: state.backgroundTunings,
    commonBackground: state.commonBackground,
    appearance: state.appearance,
    subtitle: state.subtitle,
    previewPlaceholderId: state.previewPlaceholderId,
    lyricMotion: state.lyricMotion,
    textureResolution: state.textureResolution,
    transparentPlayerBackground: state.transparentPlayerBackground,
    mousePassthrough: state.mousePassthrough,
});

/** Hydrates the store from a snapshot the plugin persisted (unknown/missing keys keep defaults). */
export const applySnapshot = (snapshot: Partial<SettingsSnapshot> | null | undefined): void => {
    if (!snapshot || typeof snapshot !== 'object') return;
    const clean = <T>(value: T | undefined, fallback: T): T => (value === undefined || value === null ? fallback : value);
    useSettingsStore.setState(state => {
        const visualizerMode = clean(snapshot.styleId, state.visualizerMode);
        // v0.2.0: a persisted snapshot may pair a style that cannot run transparent with the
        // transparent window on (e.g. the persisted store predates the guard, or the persisted
        // style was changed elsewhere). Never hydrate that combination.
        const transparentBlocked =
            clean(snapshot.transparentPlayerBackground, state.transparentPlayerBackground) &&
            getStyleTransparencyCompat(visualizerMode, { isDaylight: state.isDaylightTheme }) === 'unsupported';
        return {
            visualizerMode,
            smartBeat: clean(snapshot.smartBeat, state.smartBeat),
            styleTunings: { ...state.styleTunings, ...clean(snapshot.styleTunings, {} as Record<StyleMode, Record<string, unknown>>) },
            backgroundMode: clean(snapshot.backgroundMode, state.backgroundMode),
            backgroundTunings: { ...state.backgroundTunings, ...clean(snapshot.backgroundTunings, {} as Record<'monet' | 'nomand' | 'latent' | 'sora', Record<string, unknown>>) },
            commonBackground: { ...state.commonBackground, ...clean(snapshot.commonBackground, {} as CommonBackgroundSettings) },
            appearance: { ...state.appearance, ...clean(snapshot.appearance, {} as AppearanceSettings) },
            subtitle: { ...state.subtitle, ...clean(snapshot.subtitle, {} as SubtitleSettings) },
            previewPlaceholderId: clean(snapshot.previewPlaceholderId, state.previewPlaceholderId),
            lyricMotion: clean(snapshot.lyricMotion, state.lyricMotion),
            textureResolution: clean(snapshot.textureResolution, state.textureResolution),
            transparentPlayerBackground: transparentBlocked
                ? false
                : clean(snapshot.transparentPlayerBackground, state.transparentPlayerBackground),
            mousePassthrough: transparentBlocked ? false : clean(snapshot.mousePassthrough, state.mousePassthrough),
        };
    });
};

/** The `VisualizerBackgroundConfig` bag the background tab reads. */
export const selectBackgroundConfig = (state: SettingsState): Record<string, unknown> => ({
    mode: state.backgroundMode,
    common: state.commonBackground,
    monet: { tuning: state.backgroundTunings.monet },
    nomand: { tuning: state.backgroundTunings.nomand },
    latent: { tuning: state.backgroundTunings.latent },
    sora: { tuning: state.backgroundTunings.sora },
    url: { items: [], selectedId: null },
});

/** The `VisualizerBackgroundActions` bag: writes from the reused background cards. */
export const selectBackgroundActions = (state: SettingsState): Record<string, unknown> => ({
    onModeChange: state.setBackgroundMode,
    common: {
        onOpacityChange: (opacity: number) => state.setCommonBackground({ opacity }),
        onCoverColorChange: (useCoverColorBg: boolean) => state.setCommonBackground({ useCoverColorBg }),
        onDisableVignetteChange: (disableVignette: boolean) => state.setCommonBackground({ disableVignette }),
        onDisableGeometricChange: (disableGeometricBackground: boolean) =>
            state.setCommonBackground({ disableGeometricBackground }),
    },
    monet: {
        onTuningChange: (patch: Record<string, unknown>) => state.setBackgroundTuning('monet', patch),
        onResetTuning: () => state.resetBackgroundTuning('monet'),
    },
    nomand: {
        onTuningChange: (patch: Record<string, unknown>) => state.setBackgroundTuning('nomand', patch),
        onResetTuning: () => state.resetBackgroundTuning('nomand'),
    },
    latent: {
        onTuningChange: (patch: Record<string, unknown>) => state.setBackgroundTuning('latent', patch),
        onResetTuning: () => state.resetBackgroundTuning('latent'),
    },
    sora: {
        onTuningChange: (patch: Record<string, unknown>) => state.setBackgroundTuning('sora', patch),
        onResetTuning: () => state.resetBackgroundTuning('sora'),
    },
});
