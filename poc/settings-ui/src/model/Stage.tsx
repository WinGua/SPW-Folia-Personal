/* The window's left stage: the live sample of the chosen style and the 14-picture style shelf,
 * laid out exactly like VisPlayground.tsx:425-530. StudioWindow already wraps this in the stage
 * <section>, so this component renders the two children only.
 *
 * The sample is Folia's real renderer running in the same-origin `preview.html` iframe
 * (docs/live-preview-iframe.md); the settings overlay injects the iframe and pumps it with a
 * `buildConfig` payload for one of the two placeholder songs, so the sample animates for real and
 * reacts to every style/tuning/background/font change. If the iframe never reports ready (older
 * bundle without preview.html, missing child shim) Stage falls back to the captured-frame sample
 * (StylePreview, Ken Burns) — the pause button drives whichever sample is showing. */
import React, { useMemo, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { PictureGrid } from '@/components/modal/settings/kit';
import { STYLE_COUNT, STYLE_ENTRIES, getStyleEntry, type StyleEntry } from './styles';
import StylePreview from './StylePreview';
import LivePreview from './LivePreview';
import { snapshotFromState, useSettingsStore, type StyleMode } from './settings';
import { IS_DAYLIGHT, PREVIEW_THEME } from './theme';
import { getPreviewPlaceholder, previewStartOffsetFor, previewTrackFor } from './previewSong';
import { buildConfig } from '~/publisher/config';
import { getLastPublishedSubtitleTheme, getLastPublishedTheme } from '~/useConfigPublisher';

interface StageProps {
    t: (key: string) => string;
    visualizerMode: StyleMode;
    onVisualizerModeChange: (mode: StyleMode) => void;
}

const StylePicture: React.FC<{ mode: StyleMode; state: { visible: boolean } }> = ({ mode, state }) => (
    <img
        src={getStyleEntry(mode).thumb}
        alt={getStyleEntry(mode).labelFallback}
        draggable={false}
        className="absolute inset-0 h-full w-full object-cover"
        style={{ opacity: state.visible ? 1 : 0 }}
    />
);

/** Placeholder covers live beside preview.html at the bundle root (`/preview/`). */
const previewCoverBase = () => `${window.location.origin}/preview`;

const Stage: React.FC<StageProps> = ({ t, visualizerMode, onVisualizerModeChange }) => {
    const [paused, setPaused] = useState(false);
    const [liveFailed, setLiveFailed] = useState(false);
    const settingsState = useSettingsStore();

    const placeholder = getPreviewPlaceholder(settingsState.previewPlaceholderId);
    // The live publisher already applied the 字体/字幕字体 selections to the theme; reuse the exact
    // theme it published (falling back to the window's sample theme before its effect has run).
    const theme = getLastPublishedTheme() ?? PREVIEW_THEME;
    const subtitleTheme = getLastPublishedSubtitleTheme() ?? theme;

    const config = useMemo(
        () => buildConfig({
            settings: snapshotFromState(settingsState),
            track: previewTrackFor(settingsState.previewPlaceholderId, previewCoverBase()),
            theme,
            subtitleTheme,
            isDaylight: IS_DAYLIGHT,
        }),
        // settingsState is the store object: any settings change rebuilds the payload.
        [settingsState, theme, subtitleTheme],
    );

    const startOffset = previewStartOffsetFor(visualizerMode, placeholder.loopDuration);

    return (
        <>
            {/* Big sample: Folia's real renderer in a scaled 1920x1080 iframe; pause/play drives it. */}
            <div
                className="relative min-h-[160px] flex-1 overflow-hidden rounded-xl shadow-[0_0_0_1px_var(--st-line)]"
                style={{ backgroundColor: theme.backgroundColor }}
            >
                {liveFailed
                    ? <StylePreview mode={visualizerMode} paused={paused} />
                    : (
                        <LivePreview
                            paused={paused}
                            config={config}
                            loopDuration={placeholder.loopDuration}
                            startOffset={startOffset}
                            onError={() => setLiveFailed(true)}
                        />
                    )}
                <button
                    type="button"
                    aria-label={t(paused ? 'options.resumePreview' : 'options.pausePreview')}
                    title={t(paused ? 'options.resumePreview' : 'options.pausePreview')}
                    onClick={() => setPaused(previous => !previous)}
                    className="st-t-fast absolute right-3 top-3 z-40 grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white hover:bg-black/65"
                >
                    {paused
                        ? <Play size={14} fill="currentColor" aria-hidden="true" />
                        : <Pause size={14} fill="currentColor" aria-hidden="true" />}
                </button>
            </div>

            {/* Style shelf: 7 columns in the wide window, the count beside the heading. */}
            <div className="flex shrink-0 flex-col">
                <h3 className="mb-2 flex min-h-6 items-center px-1 text-[13px] font-semibold leading-5 text-[color:var(--st-t2)]">
                    {t('options.lyricStyles')}
                    <span className="ml-1.5 font-normal text-[color:var(--st-t3)]">{STYLE_COUNT}</span>
                </h3>
                <PictureGrid<StyleMode>
                    value={visualizerMode}
                    options={STYLE_ENTRIES.map((entry: StyleEntry) => ({
                        value: entry.mode,
                        label: t(entry.labelKey) || entry.labelFallback,
                    }))}
                    picture={(mode, state) => <StylePicture mode={mode} state={state} />}
                    columns={7}
                    onChange={onVisualizerModeChange}
                    label={t('ui.animationMode')}
                    maxHeight={250}
                    className="-mx-4"
                />
            </div>
        </>
    );
};

export default Stage;
