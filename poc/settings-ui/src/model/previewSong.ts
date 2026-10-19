/* The two placeholder songs Folia's playground samples with (work/folia/.../PreviewPlaceholder.ts).
 *
 * Hand-copied on purpose: importing that Folia module pulls the renderer graph (three/pixi lazy
 * chunks) into the injected bundle, which v0.1.5 broke on (MISSING_EXPORT / React #185). Only the
 * lyrics data is needed here — the live renderer itself runs in the preview iframe.
 *
 * Times below are milliseconds because the settings-ui publisher speaks `PublisherLyricLine`;
 * word boundaries are generated the same way Folia does it (per character for CJK, per token for
 * space-separated scripts). Background-vocal (harmony) data is intentionally not carried over: the
 * injected config always disables the harmony overlay (publisher/config.ts). */
import type { PublisherLyricLine, PublisherTrack, PublisherWord } from '~/publisher/config';
import type { PreviewPlaceholderId, StyleMode } from './settings';

const characterWords = (text: string, startMs: number, endMs: number): PublisherWord[] => {
    const chars = Array.from(text);
    const step = Math.max(0, endMs - startMs) / Math.max(1, chars.length);
    return chars.map((char, index) => ({
        text: char,
        startMs: Math.round(startMs + step * index),
        endMs: Math.round(startMs + step * (index + 1)),
    }));
};

const tokenWords = (tokens: string[], startMs: number, endMs: number): PublisherWord[] => {
    const step = Math.max(0, endMs - startMs) / Math.max(1, tokens.length);
    return tokens.map((token, index) => ({
        text: token,
        startMs: Math.round(startMs + step * index),
        endMs: Math.round(startMs + step * (index + 1)),
    }));
};

export interface PreviewPlaceholderSong {
    id: PreviewPlaceholderId;
    title: string;
    /** One loop of the sampled lyric section, in seconds (Folia's playground loops it). */
    loopDuration: number;
    /** Placeholder cover file name under `/preview/` in the host bundle (stage-web.mjs copies it). */
    coverFile: string;
    lines: PublisherLyricLine[];
}

const SHINBUN_LINES: PublisherLyricLine[] = [
    {
        startMs: 700,
        endMs: 3600,
        main: '詩情を持たずとも、あなたを現実へと導くその神文の詩を紡ぐ。',
        sub: '编织那没有诗意，却能将你带到现实的神文之诗。',
        romanization: 'Shijō o motazu tomo, anata o genjitsu e to michibiku sono shinbun no shi o tsumugu.',
        words: characterWords('詩情を持たずとも、あなたを現実へと導くその神文の詩を紡ぐ。', 700, 3600),
    },
    {
        startMs: 4200,
        endMs: 7200,
        main: 'Weave that prosaic divine poem that leads you to reality.',
        sub: '编织那没有诗意，却能将你带到现实的神文之诗。',
        romanization: 'Weave that prosaic divine poem that leads you to reality.',
        words: tokenWords(
            ['Weave', 'that', 'prosaic', 'divine', 'poem', 'that', 'leads', 'you', 'to', 'reality.'],
            4200,
            7200,
        ),
    },
    {
        startMs: 7800,
        endMs: 10900,
        main: 'Tisse ce poème divin sans poésie qui te mène au réel.',
        sub: '编织那没有诗意，却能将你带到现实的神文之诗。',
        romanization: 'Tisse ce poème divin sans poésie qui te mène au réel.',
        words: tokenWords(
            ['Tisse', 'ce', 'poème', 'divin', 'sans', 'poésie', 'qui', 'te', 'mène', 'au', 'réel.'],
            7800,
            10900,
        ),
    },
    {
        startMs: 11500,
        endMs: 14400,
        main: '编织那没有诗意，却能将你带到现实的神文之诗。',
        sub: '编织那没有诗意，却能将你带到现实的神文之诗。',
        romanization: 'Biānzhī nà méiyǒu shīyì, què néng jiāng nǐ dài dào xiànshí de shénwén zhī shī.',
        words: characterWords('编织那没有诗意，却能将你带到现实的神文之诗。', 11500, 14400),
    },
];

const WILD_SESAME_LINES: PublisherLyricLine[] = [
    {
        startMs: 0,
        endMs: 3100,
        main: 'You and the others who think',
        sub: '你和那些自以为如此的人',
        romanization: 'You and the others who think',
        words: tokenWords(['You', 'and', 'the', 'others', 'who', 'think'], 0, 3100),
    },
    {
        startMs: 3600,
        endMs: 6900,
        main: '真実のために生きていると思う人たち、',
        sub: '那些自以为为真理而活的人，',
        romanization: 'Shinjitsu no tame ni ikite iru to omou hitotachi,',
        words: characterWords('真実のために生きていると思う人たち、', 3600, 6900),
    },
    {
        startMs: 7400,
        endMs: 10300,
        main: 'et, par extension, qui aiment',
        sub: '并因此爱上一切……',
        romanization: 'et, par extension, ki em',
        words: tokenWords(['et,', 'par', 'extension,', 'qui', 'aiment'], 7400, 10300),
    },
    {
        startMs: 10800,
        endMs: 13600,
        main: '一切冰冷的事物。',
        sub: 'all that is cold.',
        romanization: 'Yīqiè bīnglěng de shìwù.',
        words: characterWords('一切冰冷的事物。', 10800, 13600),
    },
];

export const PREVIEW_PLACEHOLDERS: Record<PreviewPlaceholderId, PreviewPlaceholderSong> = {
    default: {
        id: 'default',
        title: '神文之诗',
        loopDuration: 14.4,
        coverFile: 'placeholder_cover.jpg',
        lines: SHINBUN_LINES,
    },
    reserved: {
        id: 'reserved',
        title: '野芝麻',
        loopDuration: 13.6,
        coverFile: 'placeholder_cover-2.jpg',
        lines: WILD_SESAME_LINES,
    },
};

export const DEFAULT_PREVIEW_PLACEHOLDER_ID: PreviewPlaceholderId = 'default';

/** The 预览文本 control's sample song (falls back to the default when a stored id is unknown). */
export const getPreviewPlaceholder = (id: PreviewPlaceholderId | null | undefined): PreviewPlaceholderSong =>
    PREVIEW_PLACEHOLDERS[id ?? DEFAULT_PREVIEW_PLACEHOLDER_ID] ?? PREVIEW_PLACEHOLDERS[DEFAULT_PREVIEW_PLACEHOLDER_ID];

/** `coverBaseUrl` is the host origin + `/preview` (the folder stage-web.mjs fills). */
export const previewTrackFor = (
    id: PreviewPlaceholderId | null | undefined,
    coverBaseUrl: string,
): PublisherTrack => {
    const song = getPreviewPlaceholder(id);
    return {
        id: `preview-${song.id}`,
        title: song.title,
        artist: null,
        album: null,
        coverUrl: `${coverBaseUrl.replace(/\/+$/, '')}/${song.coverFile}`,
        durationMs: Math.round(song.loopDuration * 1000),
        lyrics: song.lines,
    };
};

/** Folia's per-style `previewStartOffset` modulo the placeholder loop (fume is the only non-zero). */
export const previewStartOffsetFor = (mode: StyleMode, loopDuration: number): number => {
    if (mode !== 'fume') return 0;
    const offset = 18.4 % Math.max(loopDuration, 0.001);
    return Number.isFinite(offset) ? offset : 0;
};
