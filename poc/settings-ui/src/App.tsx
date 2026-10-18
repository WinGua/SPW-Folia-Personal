/* The injected settings window: Folia's own StudioWindow frame + lyric-style window layout, wired to
 * the POC's configuration store (model/settings.ts) instead of Folia's persisted app store. */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import StudioWindow from '@/components/shared/StudioWindow';
import VisPlaygroundSettingsPanel from '@/components/visualizer/window/VisPlaygroundSettingsPanel';
import type { FontChoice } from '@/components/visualizer/window/FontTiles';
import type { StyleDraft } from '@/components/visualizer/window/useTuningDrafts';
import type { VisPlaygroundEditSection } from '@/components/visualizer/window/VisPlaygroundPreviewHotspots';
import type { PreviewPlaceholderId } from '@/components/visualizer/PreviewPlaceholder';
import type { SubtitleContentMode, Theme, VisualizerMode } from '@/types';
import {
    selectBackgroundActions,
    selectBackgroundConfig,
    selectTuningSettings,
    snapshotFromState,
    useSettingsStore,
    type SettingsSection,
    type StyleMode,
} from '~/model/settings';
import Stage from '~/model/Stage';
import { getStyleEntry } from '~/model/styles';
import {
    CONTROL_CARD_BG,
    FONT_SCALE_OPTIONS,
    FONT_WEIGHT_OPTIONS,
    IS_DAYLIGHT,
    PREVIEW_THEME,
    RANGE_INPUT_CLASS,
} from '~/model/theme';
import {
    registerSettingsUiController,
    setSettingsUiOpenState,
    subscribeSettingsRoundTrip,
} from '~/bridge';
import { useConfigPublisher } from '~/useConfigPublisher';

interface AppProps {
    injected: boolean;
}

const App: React.FC<AppProps> = ({ injected }) => {
    const { t } = useTranslation();
    const state = useSettingsStore();
    const [open, setOpen] = useState(() => !injected);
    /** protocol §7.5 v1 chrome: the gear fades out together with the cursor after 2.5 s idle. */
    const [chromeVisible, setChromeVisible] = useState(true);
    const visualizerMode = state.visualizerMode;

    useConfigPublisher();

    // Folia's settings window tints all of its text from the global --text-primary the app shell
    // sets from the current theme; the injected bundle owns that variable for the overlay subtree.
    useEffect(() => {
        const root = document.documentElement;
        const previous = root.style.getPropertyValue('--text-primary');
        root.style.setProperty('--text-primary', PREVIEW_THEME.primaryColor);
        return () => {
            if (previous) root.style.setProperty('--text-primary', previous);
            else root.style.removeProperty('--text-primary');
        };
    }, []);

    useEffect(() => subscribeSettingsRoundTrip(), []);
    useEffect(() => setSettingsUiOpenState(open), [open]);

    const close = useCallback(() => {
        setOpen(false);
        // The host owns the tray/toggle; it only observes whether the panel is open through
        // `__SPW_FOLIA_UI__`/F1, so closing stays local (no `ui` echo, which would re-enter the
        // `ui` listener and toggle the panel back open).
    }, []);

    useEffect(() => registerSettingsUiController({ open: () => setOpen(true), close }), [close]);

    useEffect(() => {
        if (!open) return undefined;
        // protocol §7.5: while the overlay is open the page owns ESC; capture + stopPropagation keeps
        // the host's own Escape (close window) out of the way. When closed this listener is absent, so
        // ESC falls through to the host exactly like a normal Folia player window.
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            close();
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [open, close]);

    useEffect(() => {
        let timer = 0;
        const show = () => {
            setChromeVisible(true);
            window.clearTimeout(timer);
            timer = window.setTimeout(() => setChromeVisible(false), 2500);
        };
        show();
        window.addEventListener('pointermove', show, { passive: true });
        window.addEventListener('pointerdown', show, { passive: true });
        window.addEventListener('keydown', show);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener('pointermove', show);
            window.removeEventListener('pointerdown', show);
            window.removeEventListener('keydown', show);
        };
    }, []);

    const styleEntry = getStyleEntry(visualizerMode);
    const styleDraft: StyleDraft = useMemo(() => ({
        tuning: state.styleTunings[visualizerMode],
        change: (patch: Record<string, unknown>) => state.setStyleTuning(visualizerMode, patch),
        reset: () => state.resetStyleTuning(visualizerMode),
    }), [state, visualizerMode]);

    const tuningSettings = useMemo(() => selectTuningSettings(state), [state]);
    const backgroundConfig = useMemo(() => selectBackgroundConfig(state), [state]);
    const backgroundActions = useMemo(() => selectBackgroundActions(state), [state]);

    const fontStyleOptions = useMemo(() => ([
        { label: t('options.fontSans'), value: 'sans' as FontChoice },
        { label: t('options.fontSerif'), value: 'serif' as FontChoice },
        { label: t('options.fontMono'), value: 'mono' as FontChoice },
        {
            label: state.appearance.customFontFamily ?? t('options.customFont'),
            value: 'custom' as FontChoice,
        },
    ]), [t, state.appearance.customFontFamily]);

    const previewPlaceholderOptions = useMemo(() => ([
        { label: t('options.previewTextDefault'), value: 'default' as PreviewPlaceholderId },
        { label: t('options.previewTextReserved'), value: 'reserved' as PreviewPlaceholderId },
    ]), [t]);

    return (
        <>
            <button
                type="button"
                className="spw-chrome-btn"
                data-spw-chrome="settings"
                data-visible={chromeVisible && !open ? 'true' : 'false'}
                aria-label={t('options.lyricsStyleSettings')}
                title={t('options.lyricsStyleSettings')}
                onClick={() => setOpen(true)}
            >
                <Settings size={20} strokeWidth={1.75} />
            </button>
            <div
                className="font-sans"
                style={{
                    position: 'fixed',
                    inset: 0,
                    pointerEvents: open ? 'auto' : 'none',
                    display: open ? 'block' : 'none',
                    ['--text-primary' as string]: PREVIEW_THEME.primaryColor,
                }}
                data-spw-settings-ui
                data-open={open ? 'true' : 'false'}
            >
            <StudioWindow
                title={t('options.lyricsStyleSettings')}
                onBack={close}
                backLabel={t('ui.back')}
                isDaylight={IS_DAYLIGHT}
                theme={PREVIEW_THEME}
                stage={(
                    <Stage
                        t={t}
                        visualizerMode={visualizerMode}
                        onVisualizerModeChange={mode => state.setVisualizerMode(mode)}
                    />
                )}
            >
                <VisPlaygroundSettingsPanel
                    activeSection={state.activeSection as VisPlaygroundEditSection}
                    onSectionChange={(section: VisPlaygroundEditSection) => state.setActiveSection(section as SettingsSection)}
                    t={t}
                    isDaylight={IS_DAYLIGHT}
                    theme={PREVIEW_THEME}
                    visualizerMode={visualizerMode as VisualizerMode}
                    visualizerEntry={styleEntry as never}
                    styleDraft={styleDraft}
                    settings={tuningSettings as never}
                    controlCardBg={CONTROL_CARD_BG}
                    rangeInputClass={RANGE_INPUT_CLASS}
                    visualizerOpacity={state.appearance.visualizerOpacity}
                    onVisualizerOpacityChange={opacity => state.setAppearance({ visualizerOpacity: opacity })}
                    backgroundConfig={backgroundConfig as never}
                    backgroundActions={backgroundActions as never}
                    previewPlaceholderId={state.previewPlaceholderId}
                    previewPlaceholderOptions={previewPlaceholderOptions}
                    onPreviewPlaceholderChange={id => state.setPreviewPlaceholderId(id)}
                    fontStyleValue={state.appearance.fontStyle as FontChoice}
                    fontStyleOptions={fontStyleOptions}
                    subtitleFontStyleOptions={fontStyleOptions}
                    onFontStyleChange={fontStyle => state.setAppearance({ fontStyle })}
                    customFontFamily={state.appearance.customFontFamily}
                    currentFontLabel={state.appearance.customFontFamily ?? t('options.customFont')}
                    fontScale={state.appearance.fontScale}
                    fontScaleOptions={FONT_SCALE_OPTIONS}
                    onFontScaleChange={fontScale => state.setAppearance({ fontScale })}
                    subtitleFontScale={state.subtitle.subtitleFontScale}
                    onSubtitleFontScaleChange={subtitleFontScale => state.setSubtitle({ subtitleFontScale })}
                    fontWeight={state.appearance.fontWeight}
                    fontWeightOptions={FONT_WEIGHT_OPTIONS}
                    onFontWeightChange={fontWeight => state.setAppearance({ fontWeight })}
                    onFontWeightFollowChange={follow => state.setAppearance({ fontWeight: follow ? null : 400 })}
                    onResetCommonSettings={() => {
                        state.resetAppearance();
                        state.setPreviewPlaceholderId('default');
                    }}
                    hideTranslationSubtitle={state.subtitle.hideTranslationSubtitle}
                    onToggleHideTranslationSubtitle={hideTranslationSubtitle => state.setSubtitle({ hideTranslationSubtitle })}
                    onToggleShowSubtitleTranslation={shown => state.setSubtitle({ subtitleContentMode: shown ? 'translation' : 'none' })}
                    subtitleContentMode={state.subtitle.subtitleContentMode as SubtitleContentMode}
                    onSubtitleContentModeChange={subtitleContentMode => state.setSubtitle({ subtitleContentMode })}
                    subtitleOverlayOpacity={state.subtitle.subtitleOverlayOpacity}
                    onSubtitleOverlayOpacityChange={subtitleOverlayOpacity => state.setSubtitle({ subtitleOverlayOpacity })}
                    subtitleOverlayBackground={state.subtitle.subtitleOverlayBackground}
                    onToggleSubtitleOverlayBackground={subtitleOverlayBackground => state.setSubtitle({ subtitleOverlayBackground })}
                    subtitleUpcomingLyricsBlur={state.subtitle.subtitleUpcomingLyricsBlur}
                    onToggleSubtitleUpcomingLyricsBlur={subtitleUpcomingLyricsBlur => state.setSubtitle({ subtitleUpcomingLyricsBlur })}
                    showHarmonySubtitle={state.subtitle.showHarmonySubtitle}
                    onToggleShowHarmonySubtitle={showHarmonySubtitle => state.setSubtitle({ showHarmonySubtitle })}
                    harmonySubtitleBackground={state.subtitle.harmonySubtitleBackground}
                    onToggleHarmonySubtitleBackground={harmonySubtitleBackground => state.setSubtitle({ harmonySubtitleBackground })}
                    subtitleFontInheritsLyrics={state.subtitle.subtitleFontInheritsLyrics}
                    onSubtitleFontInheritsLyricsChange={subtitleFontInheritsLyrics => state.setSubtitle({ subtitleFontInheritsLyrics })}
                    subtitleFontStyle={state.subtitle.subtitleFontStyle as Theme['fontStyle']}
                    subtitleFontWeight={state.subtitle.subtitleFontWeight}
                    onSubtitleFontStyleChange={subtitleFontStyle => state.setSubtitle({ subtitleFontStyle })}
                    onSubtitleFontWeightChange={subtitleFontWeight => state.setSubtitle({ subtitleFontWeight })}
                    onSubtitleFontWeightFollowChange={follow => state.setSubtitle({ subtitleFontWeight: follow ? null : 400 })}
                    subtitleFontFamily={null}
                    onSubtitleFontFamilyChange={() => undefined}
                    onOpenSubtitleFontPicker={() => undefined}
                    onResetSubtitleSettings={() => state.resetSubtitle()}
                />
            </StudioWindow>
            </div>
        </>
    );
};

export default App;
