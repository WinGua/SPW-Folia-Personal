/* Feeds the config publisher from every input the page owns: the persisted settings, the host's
 * track/lyrics events, and the cover-derived theme (protocol §4). */
import { useEffect } from 'react';
import {
    getBridge,
    bridgeOn,
    bridgeIsInjected,
    bridgeTrackCover,
    DEMO_TRACK,
    type BridgeTrackMessage,
} from '~/bridge';
import { snapshotFromState, useSettingsStore } from '~/model/settings';
import { onSystemSchemeChange, systemPrefersLight } from '~/model/theme';
import { ConfigPublisher, type PublisherLyricLine, type PublisherTrack } from '~/publisher/config';
import { sampleCover, themeFromSample, type CoverSample } from '~/publisher/deriveTheme';
import { applyThemeFonts } from '~/publisher/themeFonts';
import type { Theme } from '@/types';

const isLyricLine = (value: unknown): value is { startMs: number; endMs: number; main: string } =>
    Boolean(value) && typeof value === 'object' && typeof (value as { main?: unknown }).main === 'string';

/** The `lyrics` event payload as the host page hands it over: our line shape, or Folia's LyricData. */
const toPublisherLyrics = (payload: unknown): PublisherLyricLine[] | null => {
    if (!payload || typeof payload !== 'object') return null;
    const lines = (payload as { lines?: unknown }).lines;
    if (!Array.isArray(lines)) return null;
    const mapped: PublisherLyricLine[] = [];
    for (const line of lines) {
        if (isLyricLine(line)) {
            mapped.push({
                startMs: line.startMs,
                endMs: line.endMs,
                main: line.main,
                ...(typeof (line as { sub?: unknown }).sub === 'string' ? { sub: (line as { sub: string }).sub } : {}),
                ...(typeof (line as { id?: unknown }).id === 'string' ? { id: (line as { id: string }).id } : {}),
            });
            continue;
        }
        // Folia LyricData line: times in seconds, text in fullText.
        const folia = line as { startTime?: number; endTime?: number; fullText?: string; translation?: string; id?: string };
        if (typeof folia.fullText === 'string' && typeof folia.startTime === 'number' && typeof folia.endTime === 'number') {
            mapped.push({
                startMs: folia.startTime * 1000,
                endMs: folia.endTime * 1000,
                main: folia.fullText,
                ...(folia.translation ? { sub: folia.translation } : {}),
                ...(folia.id ? { id: folia.id } : {}),
            });
        }
    }
    return mapped.length > 0 ? mapped : null;
};

const toPublisherTrack = (track: BridgeTrackMessage | null | undefined, lyrics: PublisherLyricLine[] | null): PublisherTrack | null => {
    if (!track && !lyrics) return null;
    const source = track ?? DEMO_TRACK;
    return {
        id: source.id ?? 'unknown',
        title: source.title ?? 'Unknown Track',
        artist: source.artist ?? null,
        album: source.album ?? null,
        // Accept both `coverUrl` and the plugin-side `coverDataUrl` spelling (see bridge.ts).
        coverUrl: bridgeTrackCover(source),
        lyrics,
    };
};

export interface ConfigPublisherHandle {
    republish: () => void;
}

/** The theme the live publisher last used (font settings already applied). The live preview inside
 *  the settings window renders with the same theme, so it must not guess: it asks for this. */
let lastPublishedTheme: Theme | null = null;
let lastPublishedSubtitleTheme: Theme | null = null;

export const getLastPublishedTheme = (): Theme | null => lastPublishedTheme;
export const getLastPublishedSubtitleTheme = (): Theme | null => lastPublishedSubtitleTheme;

export const useConfigPublisher = (): void => {
    useEffect(() => {
        const bridge = getBridge();
        // The last cover sample (v0.3.0): the base theme is rebuilt synchronously from it, with the
        // 字体 settings applied on top (v0.1.3) and the effective lightness chosen per mode.
        let coverSample: CoverSample | null = null;
        let lyrics: PublisherLyricLine[] = toPublisherLyrics(bridge.inputs?.lyrics);
        let track = toPublisherTrack(bridge.inputs?.track, lyrics);
        // The raw track message, kept so a lyrics event can re-apply it without inventing a track.
        let trackMessage = bridge.inputs?.track ?? null;
        // Guards out-of-order async theme derivations (cover A resolving after cover B).
        let themeToken = 0;
        let disposed = false;

        /** settings + theme + subtitleTheme, with the persisted 字体/字幕字体 selections applied. */
        const themedInputs = () => {
            const state = useSettingsStore.getState();
            // v0.3.0: while the player window is transparent the text colours follow the system
            // colour scheme (dark system → light text), not the cover's darkness. The cover still
            // supplies the hue; the non-transparent window keeps the cover-driven palette.
            const derived = themeFromSample(
                coverSample,
                track?.title,
                state.transparentPlayerBackground ? systemPrefersLight() : undefined,
            );
            const theme = applyThemeFonts(derived.theme, state.appearance);
            const subtitleTheme = state.subtitle.subtitleFontInheritsLyrics
                ? theme
                : applyThemeFonts(derived.theme, {
                    fontStyle: state.subtitle.subtitleFontStyle,
                    fontWeight: state.subtitle.subtitleFontWeight,
                });
            lastPublishedTheme = theme;
            lastPublishedSubtitleTheme = subtitleTheme;
            return { settings: snapshotFromState(state), theme, subtitleTheme, isDaylight: derived.isDaylight };
        };

        const publisher = new ConfigPublisher({ pushConfig: config => bridge.pushConfig(config) }, {
            ...themedInputs(),
            track,
            lyricOffsetMs: bridge.inputs?.state?.lyricOffsetMs ?? 0,
            playerState: bridge.inputs?.state?.playerState ?? 'IDLE',
        });

        /** Publishes the effective inputs and mirrors the effective lightness into the store, where
         *  the transparent-window guards (and their auto-close fallback) consume it. */
        const sync = () => {
            let inputs = themedInputs();
            const store = useSettingsStore.getState();
            if (store.isDaylightTheme !== inputs.isDaylight) {
                store.setIsDaylightTheme(inputs.isDaylight);
                // The mirror can flip transparency back off (lumiere on a light scheme); recompute.
                inputs = themedInputs();
            }
            publisher.update(inputs);
        };

        const refreshTheme = async () => {
            const cover = track?.coverUrl ?? null;
            const token = ++themeToken;
            // A switched song reports its track before the new cover is loaded (v0.1.8): keep the
            // previous palette instead of flashing the dark fallback, then derive once the cover
            // data URL actually arrives.
            if (!cover) return;
            const sample = await sampleCover(cover);
            if (disposed || token !== themeToken) return;
            coverSample = sample;
            // v0.2.0: the transparent-window compatibility of `lumiere` depends on the theme being
            // light or dark (v0.3.0: cover-derived when opaque, system-derived while transparent),
            // so the store mirrors the effective flag for the panel/switch logic.
            sync();
        };

        const applyTrack = (nextTrack: BridgeTrackMessage | null | undefined, nextLyrics: PublisherLyricLine[] | null) => {
            const previousCover = track?.coverUrl ?? null;
            track = toPublisherTrack(nextTrack, nextLyrics);
            publisher.update({ track });
            if ((track?.coverUrl ?? null) !== previousCover) void refreshTheme();
        };

        const unsubscribeStore = useSettingsStore.subscribe(() => {
            sync();
        });

        const offTrack = bridgeOn<BridgeTrackMessage>('track', payload => {
            trackMessage = payload ?? null;
            applyTrack(trackMessage, lyrics);
        });
        const offLyrics = bridgeOn<unknown>('lyrics', payload => {
            lyrics = toPublisherLyrics(payload);
            if (trackMessage) applyTrack(trackMessage, lyrics);
        });
        const offSettings = bridgeOn('settings', () => publisher.invalidate());
        const offConfig = bridgeOn('hello', () => publisher.invalidate());
        // v0.3.0: a system dark/light flip while the window is transparent re-tints the text.
        const offScheme = onSystemSchemeChange(() => sync());

        void refreshTheme();
        publisher.update({ ...themedInputs(), track, lyricOffsetMs: bridge.inputs?.state?.lyricOffsetMs ?? 0 });

        // A settings UI only pushes when something moved; this first flush publishes the initial state.
        publisher.flush();

        return () => {
            disposed = true;
            unsubscribeStore();
            offTrack();
            offLyrics();
            offSettings();
            offConfig();
            offScheme();
            publisher.dispose();
        };
    }, []);
};

export const publisherDebug = (): { injected: boolean } => ({ injected: bridgeIsInjected() });
