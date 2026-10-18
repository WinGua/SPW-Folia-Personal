/* The 14 lyric styles in Folia's shelf order (each entry's `order` ascending), with the real settings
 * panel its registry entry renders and the beat effects it declares. Only the panels are reused; the
 * style previews are static frames captured from the real renderers (poc/webview/server/out/styles). */
import React from 'react';
import {
    CappellaSettingsPanel,
    CladdaghSettingsPanel,
    ClassicSettingsPanel,
    DioramaSettingsPanel,
    FumeSettingsPanel,
    PartitaSettingsPanel,
    TiltSettingsPanel,
} from '@/components/visualizer/settingsPanels';
import SonnetSettingsPanel from '@/components/visualizer/sonnet/SonnetSettingsPanel';
import TemperaSettingsPanel from '@/components/visualizer/tempera/TemperaSettingsPanel';
import LumiereSettingsPanel from '@/components/visualizer/lumiere/LumiereSettingsPanel';
import PendoloSettingsPanel from '@/components/visualizer/pendolo/PendoloSettingsPanel';
import { MonetSettingsPanel } from '@/components/visualizer/monet/MonetSettingsPanel';
import { BEAT_EFFECT_IDS, type BeatEffectDef } from '@/components/../services/beatFx/beatEffects';
import type { StyleMode } from './settings';
import { stylePreviewUrl } from './assetBase';

export interface StyleEntry {
    mode: StyleMode;
    order: number;
    labelKey: string;
    labelFallback: string;
    /** Static preview frame in public/styles. */
    thumb: string;
    renderSettingsPanel?: (props: any) => React.ReactNode;
    ownFontSizeNoticeKey?: string;
    beatEffects?: readonly BeatEffectDef[];
}

const panel = (component: React.FC<any>) =>
    function StyleSettingsPanel(props: any) {
        return React.createElement(component, props);
    };

export const STYLE_ENTRIES: StyleEntry[] = [
    {
        mode: 'sonnet',
        order: 10,
        labelKey: 'ui.visualizerSonnet',
        labelFallback: '商籁',
        thumb: stylePreviewUrl('sonnet'),
        renderSettingsPanel: panel(SonnetSettingsPanel),
        ownFontSizeNoticeKey: 'options.sonnetFontSizeAutoNotice',
        beatEffects: [
            {
                id: BEAT_EFFECT_IDS.sonnetLensTear,
                nameKey: 'options.beatEffect_sonnetLensTear',
                descKey: 'options.beatEffect_sonnetLensTearDesc',
                source: 'beats',
            },
        ],
    },
    {
        mode: 'tempera',
        order: 20,
        labelKey: 'ui.visualizerTempera',
        labelFallback: '凝彩',
        thumb: stylePreviewUrl('tempera'),
        renderSettingsPanel: panel(TemperaSettingsPanel),
        ownFontSizeNoticeKey: 'options.temperaFontSizeAutoNotice',
    },
    {
        mode: 'lumiere',
        order: 25,
        labelKey: 'ui.visualizerLumiere',
        labelFallback: '绘光',
        thumb: stylePreviewUrl('lumiere'),
        renderSettingsPanel: panel(LumiereSettingsPanel),
        ownFontSizeNoticeKey: 'options.lumiereFontSizeAutoNotice',
    },
    {
        mode: 'classic',
        order: 30,
        labelKey: 'ui.visualizerClassic',
        labelFallback: '流光',
        thumb: stylePreviewUrl('classic'),
        renderSettingsPanel: panel(ClassicSettingsPanel),
    },
    {
        mode: 'cadenza',
        order: 40,
        labelKey: 'ui.visualizerCadenze',
        labelFallback: '心象',
        thumb: stylePreviewUrl('cadenza'),
    },
    {
        mode: 'partita',
        order: 50,
        labelKey: 'ui.visualizerPartita',
        labelFallback: '云阶',
        thumb: stylePreviewUrl('partita'),
        renderSettingsPanel: panel(PartitaSettingsPanel),
    },
    {
        mode: 'fume',
        order: 60,
        labelKey: 'ui.visualizerFume',
        labelFallback: '浮名',
        thumb: stylePreviewUrl('fume'),
        renderSettingsPanel: panel(FumeSettingsPanel),
    },
    {
        mode: 'tilt',
        order: 70,
        labelKey: 'ui.visualizerTilt',
        labelFallback: '倾诉',
        thumb: stylePreviewUrl('tilt'),
        renderSettingsPanel: panel(TiltSettingsPanel),
    },
    {
        mode: 'claddagh',
        order: 80,
        labelKey: 'ui.visualizerCladdagh',
        labelFallback: '回环',
        thumb: stylePreviewUrl('claddagh'),
        renderSettingsPanel: panel(CladdaghSettingsPanel),
    },
    {
        mode: 'monet',
        order: 90,
        labelKey: 'ui.visualizerMonet',
        labelFallback: '莫奈',
        thumb: stylePreviewUrl('monet'),
        renderSettingsPanel: panel(MonetSettingsPanel),
    },
    {
        mode: 'pendolo',
        order: 100,
        labelKey: 'ui.visualizerPendolo',
        labelFallback: '时计',
        thumb: stylePreviewUrl('pendolo'),
        renderSettingsPanel: panel(PendoloSettingsPanel),
        beatEffects: [
            {
                id: BEAT_EFFECT_IDS.pendoloDrumhead,
                nameKey: 'options.beatEffect_pendoloDrumhead',
                descKey: 'options.beatEffect_pendoloDrumheadDesc',
                source: 'drums',
            },
            {
                id: BEAT_EFFECT_IDS.pendoloGearBeats,
                nameKey: 'options.beatEffect_pendoloGearBeats',
                descKey: 'options.beatEffect_pendoloGearBeatsDesc',
                source: 'beats',
                retired: true,
            },
        ],
    },
    {
        mode: 'cappella',
        order: 110,
        labelKey: 'ui.visualizerCappella',
        labelFallback: '群唱',
        thumb: stylePreviewUrl('cappella'),
        renderSettingsPanel: panel(CappellaSettingsPanel),
    },
    {
        mode: 'diorama',
        order: 120,
        labelKey: 'ui.visualizerDiorama',
        labelFallback: '镜台',
        thumb: stylePreviewUrl('diorama'),
        renderSettingsPanel: panel(DioramaSettingsPanel),
        beatEffects: [
            {
                id: BEAT_EFFECT_IDS.dioramaRipple,
                nameKey: 'options.beatEffect_dioramaRipple',
                descKey: 'options.beatEffect_dioramaRippleDesc',
                source: 'beats',
            },
        ],
    },
    {
        mode: 'still',
        order: 130,
        labelKey: 'ui.visualizerStill',
        labelFallback: '静止',
        thumb: stylePreviewUrl('still'),
    },
];

export const getStyleEntry = (mode: StyleMode): StyleEntry =>
    STYLE_ENTRIES.find(entry => entry.mode === mode) ?? STYLE_ENTRIES[0];

export const STYLE_COUNT = STYLE_ENTRIES.length;
