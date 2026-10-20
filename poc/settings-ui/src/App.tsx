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
import { getStyleTransparencyCompat } from '~/model/transparencyCompat';
import {
    CONTROL_CARD_BG,
    FONT_SCALE_OPTIONS,
    FONT_WEIGHT_OPTIONS,
    IS_DAYLIGHT,
    PREVIEW_THEME,
    RANGE_INPUT_CLASS,
} from '~/model/theme';
import {
    forceEmitSettings,
    registerSettingsUiController,
    reportHitRegions,
    setSettingsUiOpenState,
    subscribeSettingsRoundTrip,
    type HitRegion,
} from '~/bridge';
import PlayerBackgroundControl from '~/chrome/PlayerBackgroundControl';
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
    /** v0.1.7: bottom-right panel holding the player-page transparent-background switch. */
    const [playerPanelOpen, setPlayerPanelOpen] = useState(false);
    const visualizerMode = state.visualizerMode;
    /** v0.1.7: with the player background transparent the page is click-through on its keyed pixels,
     *  so the chrome buttons must stay pinned on screen — otherwise they could never be clicked again. */
    const chromeAlwaysOn = state.transparentPlayerBackground === true;

    useConfigPublisher();

    /* v0.1.7: the transparent player background makes the host window click-through, so the host
     * turns it back off with a global hotkey (Ctrl+Alt+B) and calls this hook to keep the switch and
     * the persisted setting in sync.
     * v0.1.11: the store refuses transparency for styles that cannot render it (monet, lumiere on a
     * light theme). The host has already keyed the window by the time this runs, so push the
     * corrected settings back explicitly instead of waiting for a store change that never happens. */
    useEffect(() => {
        const target = window as unknown as {
            __spwFoliaSetTransparent?: (on: boolean) => void;
        };
        target.__spwFoliaSetTransparent = on => {
            const store = useSettingsStore.getState();
            store.setTransparentPlayerBackground(on);
            if (on && !useSettingsStore.getState().transparentPlayerBackground) forceEmitSettings();
        };
        return () => {
            delete target.__spwFoliaSetTransparent;
        };
    }, []);

    /* v0.1.9: "mouse passthrough" only exists inside a transparent session. Leaving transparency
     * always releases the mouse, so the next opaque session starts with every control clickable. */
    useEffect(() => {
        if (!state.transparentPlayerBackground && state.mousePassthrough) {
            state.setMousePassthrough(false);
        }
    }, [state.transparentPlayerBackground, state.mousePassthrough]);

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

    /* v0.1.11: styles that cannot run under the colour key (see model/transparencyCompat.ts) are
     * patched through CSS instead — the root flag lets app.css drop the one full-screen plate that a
     * style has no tuning switch for (currently only `still`'s vignette). */
    useEffect(() => {
        const root = document.documentElement;
        root.dataset.spwTransparent = state.transparentPlayerBackground ? 'true' : 'false';
        return () => {
            delete root.dataset.spwTransparent;
        };
    }, [state.transparentPlayerBackground]);

    useEffect(() => subscribeSettingsRoundTrip(), []);
    useEffect(() => setSettingsUiOpenState(open), [open]);

    const close = useCallback(() => {
        setOpen(false);
        // The host owns the tray/toggle; it only observes whether the panel is open through
        // `__SPW_FOLIA_UI__`/F1, so closing stays local (no `ui` echo, which would re-enter the
        // `ui` listener and toggle the panel back open).
    }, []);

    useEffect(() => registerSettingsUiController({ open: () => setOpen(true), close }), [close]);

    // The settings overlay covers the stage; fold the small player-background panel away with it.
    useEffect(() => {
        if (open) setPlayerPanelOpen(false);
    }, [open]);
    /* v0.1.9: the host can put the transparent player window into mouse-passthrough mode, where every
     * click falls through to the desktop except over the chrome. Report those rectangles (CSS px) so the
     * bottom-right round button and the top-right gear stay clickable at all times. */
    useEffect(() => {
        const collect = () => {
            const rects: HitRegion[] = [];
            const push = (el: Element | null) => {
                if (!(el instanceof HTMLElement)) return;
                const rect = el.getBoundingClientRect();
                if (rect.width < 2 || rect.height < 2) return;
                rects.push({ x: rect.left, y: rect.top, w: rect.width, h: rect.height });
            };
            push(document.querySelector('[data-spw-chrome="settings"]'));
            push(document.querySelector('[data-spw-chrome="player-background"]'));
            push(document.querySelector('[data-spw-chrome="player-background-panel"][data-open="true"]'));
            push(document.querySelector('[data-spw-settings-overlay="true"]'));
            reportHitRegions(rects);
        };
        collect();
        const settle = window.setTimeout(collect, 120);
        window.addEventListener('resize', collect);
        return () => {
            window.clearTimeout(settle);
            window.removeEventListener('resize', collect);
        };
    }, [state.transparentPlayerBackground, state.mousePassthrough, playerPanelOpen, open, chromeVisible]);

    // v0.1.7: while the player-background panel is open it owns ESC (panel first, window second) —
    // window-capture + stopPropagation keeps both our settings listener and the host's Escape out.
    useEffect(() => {
        if (!playerPanelOpen) return undefined;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            setPlayerPanelOpen(false);
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [playerPanelOpen]);

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

    // A settings file written before v0.1.3 may still select removed options; normalise it once so
    // the reused panel renders sane values (custom font -> sans, romanization/both -> translation).
    useEffect(() => {
        const current = useSettingsStore.getState();
        if (current.appearance.fontStyle === 'custom') current.setAppearance({ fontStyle: 'sans' });
        if (current.subtitle.subtitleFontStyle === 'custom') current.setSubtitle({ subtitleFontStyle: 'sans' });
        const mode = current.subtitle.subtitleContentMode;
        if (mode === 'romanization' || mode === 'both') current.setSubtitle({ subtitleContentMode: 'translation' });
        if ((current.backgroundMode as string) === 'url') current.setBackgroundMode('latent');
    }, []);

    const styleEntry = getStyleEntry(visualizerMode);
    /** v0.1.11: does the selected style survive the transparent window, and does it need a downgrade? */
    const styleCompat = getStyleTransparencyCompat(visualizerMode, { isDaylight: state.isDaylightTheme });
    const styleLabel = t(styleEntry.labelKey) || styleEntry.labelFallback;
    const compatNote = styleCompat === 'unsupported'
        ? `当前样式「${styleLabel}」无法在透明窗口下显示（会留下大片键色区域），已自动关闭透明背景。切换其他样式后可重新开启。`
        : styleCompat === 'tuned' && state.transparentPlayerBackground
            ? `透明模式下已简化「${styleLabel}」的大面积装饰，关闭透明背景后自动恢复。`
            : null;
    const styleDraft: StyleDraft = useMemo(() => ({
        tuning: state.styleTunings[visualizerMode],
        change: (patch: Record<string, unknown>) => state.setStyleTuning(visualizerMode, patch),
        reset: () => state.resetStyleTuning(visualizerMode),
    }), [state, visualizerMode]);

    const tuningSettings = useMemo(() => selectTuningSettings(state), [state]);
    const backgroundConfig = useMemo(() => selectBackgroundConfig(state), [state]);
    const backgroundActions = useMemo(() => selectBackgroundActions(state), [state]);

    // v0.1.3: custom font families are removed — the injected page has no font source, so the tile
    // could never produce a working font. Only Folia's built-in sans/serif/mono remain.
    const fontStyleOptions = useMemo(() => ([
        { label: t('options.fontSans'), value: 'sans' as FontChoice },
        { label: t('options.fontSerif'), value: 'serif' as FontChoice },
        { label: t('options.fontMono'), value: 'mono' as FontChoice },
    ]), [t]);

    const previewPlaceholderOptions = useMemo(() => ([
        { label: t('options.previewTextDefault'), value: 'default' as PreviewPlaceholderId },
        { label: t('options.previewTextReserved'), value: 'reserved' as PreviewPlaceholderId },
    ]), [t]);

    return (
        <>
            {/* v0.1.7: Folia's own player-chrome row, reachable from the player's bottom-right corner. */}
            <PlayerBackgroundControl
                visible={chromeAlwaysOn || ((chromeVisible || playerPanelOpen) && !open)}
                open={playerPanelOpen}
                onOpenChange={setPlayerPanelOpen}
                enabled={state.transparentPlayerBackground}
                onToggle={value => state.setTransparentPlayerBackground(value)}
                label={t('options.transparentPlayerBackground')}
                hint={t('options.transparentPlayerBackgroundDesc')}
                passthrough={state.mousePassthrough}
                onTogglePassthrough={value => state.setMousePassthrough(value)}
                passthroughLabel="鼠标穿透（操作桌面）"
                passthroughHint="开启后点击落到桌面，两个浮标仍可点"
                compat={styleCompat}
                compatNote={compatNote}
            />
            <button
                type="button"
                className="spw-chrome-btn"
                data-spw-chrome="settings"
                data-visible={chromeAlwaysOn || (chromeVisible && !open) ? 'true' : 'false'}
                /* v0.1.7: backdrop-filter layers are dropped by the colour-key host window, so the
                 * chrome falls back to a flat background while the player page is transparent. */
                data-flat={chromeAlwaysOn ? 'true' : 'false'}
                aria-label={t('options.lyricsStyleSettings')}
                title={t('options.lyricsStyleSettings')}
                onClick={() => setOpen(true)}
            >
                <Settings size={20} strokeWidth={1.75} />
            </button>
            <div
                className="font-sans"
                data-spw-settings-overlay={open ? 'true' : 'false'}
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
