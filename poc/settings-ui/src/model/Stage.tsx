/* The window's left stage: a static frame of the chosen style (Folia draws its preview live here)
 * and the 14-picture style shelf, laid out exactly like VisPlayground.tsx:425-530. StudioWindow
 * already wraps this in the stage <section>, so this component renders the two children only. */
import React from 'react';
import { PictureGrid } from '@/components/modal/settings/kit';
import { STYLE_COUNT, STYLE_ENTRIES, getStyleEntry, type StyleEntry } from './styles';
import StylePreview from './StylePreview';
import type { StyleMode } from './settings';
import { PREVIEW_THEME } from './theme';

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

const Stage: React.FC<StageProps> = ({ t, visualizerMode, onVisualizerModeChange }) => {
    return (
        <>
            {/* Big smoothed sample: in the desktop window this is the live renderer. */}
            <div
                className="relative min-h-[160px] flex-1 overflow-hidden rounded-xl shadow-[0_0_0_1px_var(--st-line)]"
                style={{ backgroundColor: PREVIEW_THEME.backgroundColor }}
            >
                <StylePreview mode={visualizerMode} />
                <button
                    type="button"
                    aria-label={t('ui.pause')}
                    className="st-t-fast absolute right-3 top-3 z-40 grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white hover:bg-black/65"
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <rect x="6" y="5" width="4" height="14" rx="1" />
                        <rect x="14" y="5" width="4" height="14" rx="1" />
                    </svg>
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
