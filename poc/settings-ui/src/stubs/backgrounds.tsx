/* Background registry stand-in for the settings window: the six built-in backgrounds and their real
 * settings cards. Only the panels are reused here — this bundle renders no background itself. */
import React from 'react';
import {
    DEFAULT_LATENT_BACKGROUND_TUNING,
    DEFAULT_MONET_BACKGROUND_TUNING,
    DEFAULT_NOMAND_BACKGROUND_TUNING,
    DEFAULT_SORA_BACKGROUND_TUNING,
} from '@/types';
import CommonBackgroundSettingsCard from '@/components/visualizer/backgrounds/common/CommonBackgroundSettingsCard';
import LatentBackgroundSettingsCard from '@/components/visualizer/backgrounds/latent/LatentBackgroundSettingsCard';
import { MonetBackgroundSettingsCard } from '@/components/visualizer/backgrounds/monet/MonetBackgroundSettingsCard';
import NomandBackgroundSettingsCard from '@/components/visualizer/backgrounds/nomand/NomandBackgroundSettingsCard';
import SoraBackgroundSettingsCard from '@/components/visualizer/backgrounds/sora/SoraBackgroundSettingsCard';

export type VisualizerBackgroundMode = 'common' | 'monet' | 'nomand' | 'latent' | 'url' | 'sora';

export const DEFAULT_VISUALIZER_BACKGROUND_MODE: VisualizerBackgroundMode = 'latent';

interface BackgroundEntry {
    mode: VisualizerBackgroundMode;
    order: number;
    labelKey: string;
    labelFallback: string;
    /** The mode's 22px line glyph, copied from its entry.tsx; the picture draws it when no live
     * background can be rendered (exactly Folia's PictureFrame fallback). */
    glyph: React.ReactNode;
    renderSettingsPanel?: (props: any) => React.ReactNode;
    resetSettings?: (actions?: any) => void;
}

const glyph = (children: React.ReactNode): React.ReactNode => (
    <svg
        width={22}
        height={22}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
    >
        {children}
    </svg>
);

const drag = (props: any) => ({
    onSliderPointerDown: props.onSliderPointerDown,
    onSliderCommit: props.onSliderCommit,
});

const entries: BackgroundEntry[] = [
    {
        mode: 'common',
        order: 10,
        labelKey: 'options.visualizerBackgroundModeCommon',
        labelFallback: '通用',
        glyph: glyph(
            <>
                <path d="M4 17l5-8 5 8z" />
                <circle cx="17.5" cy="8.5" r="3" opacity="0.55" />
            </>
        ),
        renderSettingsPanel: props => <CommonBackgroundSettingsCard {...props} />,
        resetSettings: actions => {
            actions?.common?.onOpacityChange?.(0.75);
            actions?.common?.onCoverColorChange?.(false);
            actions?.common?.onDisableVignetteChange?.(false);
            actions?.common?.onDisableGeometricChange?.(false);
        },
    },
    {
        mode: 'monet',
        order: 20,
        labelKey: 'options.visualizerBackgroundModeMonet',
        labelFallback: '莫奈',
        glyph: glyph(
            <>
                <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
                <path d="M20.5 8.5L8 19.5" opacity="0.55" />
            </>
        ),
        renderSettingsPanel: props => (
            <MonetBackgroundSettingsCard
                t={props.t}
                tuning={props.config?.monet?.tuning ?? DEFAULT_MONET_BACKGROUND_TUNING}
                onTuningChange={props.actions?.monet?.onTuningChange}
                {...drag(props)}
            />
        ),
        resetSettings: actions => actions?.monet?.onResetTuning?.(),
    },
    {
        mode: 'nomand',
        order: 30,
        labelKey: 'options.visualizerBackgroundModeNomand',
        labelFallback: '漫游',
        glyph: glyph(
            <>
                <rect x="4" y="4" width="6.5" height="6.5" rx="0.8" />
                <rect x="13.5" y="4" width="6.5" height="6.5" rx="0.8" opacity="0.45" />
                <rect x="4" y="13.5" width="6.5" height="6.5" rx="0.8" opacity="0.45" />
                <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="0.8" />
            </>
        ),
        renderSettingsPanel: props => (
            <NomandBackgroundSettingsCard
                t={props.t}
                tuning={props.config?.nomand?.tuning ?? DEFAULT_NOMAND_BACKGROUND_TUNING}
                onTuningChange={props.actions?.nomand?.onTuningChange}
                {...drag(props)}
            />
        ),
        resetSettings: actions => actions?.nomand?.onResetTuning?.(),
    },
    {
        mode: 'latent',
        order: 35,
        labelKey: 'options.visualizerBackgroundModeLatent',
        labelFallback: '隐现',
        glyph: glyph(
            <>
                <path d="M4.5 7.5h.01M9 7.5h.01M13.5 7.5h.01M18 7.5h.01" strokeWidth="2.2" opacity="0.55" />
                <path d="M3 15c3-3.5 6-3.5 9 0s6 3.5 9 0" />
            </>
        ),
        renderSettingsPanel: props => (
            <LatentBackgroundSettingsCard
                t={props.t}
                tuning={props.config?.latent?.tuning ?? DEFAULT_LATENT_BACKGROUND_TUNING}
                onTuningChange={props.actions?.latent?.onTuningChange}
                {...drag(props)}
            />
        ),
        resetSettings: actions => actions?.latent?.onResetTuning?.(),
    },
    {
        mode: 'url',
        order: 40,
        labelKey: 'options.visualizerBackgroundModeUrl',
        labelFallback: '嵌入',
        glyph: glyph(
            <>
                <rect x="3.5" y="5" width="17" height="14" rx="2" />
                <path d="M3.5 9.5h17" opacity="0.55" />
            </>
        ),
    },
    {
        mode: 'sora',
        order: 50,
        labelKey: 'options.visualizerBackgroundModeSora',
        labelFallback: '空',
        glyph: glyph(
            <>
                <path d="M12 5.5l1.2 2.9 2.9 1.2-2.9 1.2L12 13.7l-1.2-2.9-2.9-1.2 2.9-1.2z" />
                <path d="M5.5 16.5h.01M18 15.5h.01M7 7h.01" strokeWidth="2.2" opacity="0.5" />
            </>
        ),
        renderSettingsPanel: props => (
            <SoraBackgroundSettingsCard
                t={props.t}
                tuning={props.config?.sora?.tuning ?? DEFAULT_SORA_BACKGROUND_TUNING}
                onTuningChange={props.actions?.sora?.onTuningChange}
            />
        ),
        resetSettings: actions => actions?.sora?.onResetTuning?.(),
    },
];

export const VISUALIZER_BACKGROUND_REGISTRY = entries;

export const hasVisualizerBackgroundMode = (mode: string): mode is VisualizerBackgroundMode =>
    entries.some(entry => entry.mode === mode);

export const getVisualizerBackgroundRegistryEntry = (mode: string): BackgroundEntry =>
    entries.find(entry => entry.mode === mode) ?? entries[0];

export const getVisualizerBackgroundModeLabel = (mode: string, t: (key: string) => string): string => {
    const entry = entries.find(item => item.mode === mode);
    if (!entry) return mode;
    return t(entry.labelKey) || entry.labelFallback;
};
