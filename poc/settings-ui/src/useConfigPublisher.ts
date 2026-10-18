/* Feeds the config publisher from every input the page owns: the persisted settings, the host's
 * track/lyrics events, and the cover-derived theme (protocol §4). */
import { useEffect } from 'react';
import {
    getBridge,
    bridgeOn,
    bridgeIsInjected,
    DEMO_TRACK,
    DEMO_THEME,
    type BridgeTrackMessage,
} from '~/bridge';
import { snapshotFromState, useSettingsStore } from '~/model/settings';
import { ConfigPublisher, type PublisherLyricLine, type PublisherTrack } from '~/publisher/config';
import { deriveThemeFromCover } from '~/publisher/deriveTheme';
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
        coverUrl: source.coverUrl ?? null,
        lyrics,
    };
};

export interface ConfigPublisherHandle {
    republish: () => void;
}

export const useConfigPublisher = (): void => {
    useEffect(() => {
        const bridge = getBridge();
        let theme: Theme = DEMO_THEME;
        let isDaylight = false;
        let lyrics: PublisherLyricLine[] = toPublisherLyrics(bridge.inputs?.lyrics);
        let track = toPublisherTrack(bridge.inputs?.track, lyrics);
        let disposed = false;

        const publisher = new ConfigPublisher({ pushConfig: config => bridge.pushConfig(config) }, {
            settings: snapshotFromState(useSettingsStore.getState()),
            track,
            lyricOffsetMs: bridge.inputs?.state?.lyricOffsetMs ?? 0,
            playerState: bridge.inputs?.state?.playerState ?? 'IDLE',
            theme,
            isDaylight,
        });

        const refreshTheme = async () => {
            const result = await deriveThemeFromCover(track?.coverUrl ?? null, track?.title);
            if (disposed) return;
            theme = result.theme;
            isDaylight = result.isDaylight;
            publisher.update({ theme, isDaylight, subtitleTheme: theme });
        };

        const applyTrack = (nextTrack: BridgeTrackMessage | null | undefined, nextLyrics: PublisherLyricLine[] | null) => {
            const previousCover = track?.coverUrl ?? null;
            track = toPublisherTrack(nextTrack, nextLyrics);
            publisher.update({ track });
            if ((track?.coverUrl ?? null) !== previousCover) void refreshTheme();
        };

        const unsubscribeStore = useSettingsStore.subscribe(state => {
            publisher.update({ settings: snapshotFromState(state) });
        });

        const offTrack = bridgeOn<BridgeTrackMessage>('track', payload => applyTrack(payload, lyrics));
        const offLyrics = bridgeOn<unknown>('lyrics', payload => {
            lyrics = toPublisherLyrics(payload);
            applyTrack(bridge.inputs?.track ?? null, lyrics);
        });
        const offSettings = bridgeOn('settings', () => publisher.invalidate());
        const offConfig = bridgeOn('hello', () => publisher.invalidate());

        void refreshTheme();
        publisher.update({ settings: snapshotFromState(useSettingsStore.getState()), track, lyricOffsetMs: bridge.inputs?.state?.lyricOffsetMs ?? 0 });

        // A settings UI only pushes when something moved; this first flush publishes the initial state.
        publisher.flush();

        return () => {
            disposed = true;
            unsubscribeStore();
            offTrack();
            offLyrics();
            offSettings();
            offConfig();
            publisher.dispose();
        };
    }, []);
};

export const publisherDebug = (): { injected: boolean } => ({ injected: bridgeIsInjected() });
