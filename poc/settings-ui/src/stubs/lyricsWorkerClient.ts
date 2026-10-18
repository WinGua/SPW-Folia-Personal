/* Lyric processing worker: Folia parses LRC/YRC/QRC/TTML off the main thread. The settings window
 * never parses lyrics (the plugin hands finished lines over the bridge), so this keeps the API. */
export type LyricParseFormat = string;

export interface TimedTextEntry {
    text: string;
    startTime: number;
    endTime: number;
}

export const toWorkerLyricProcessingOptions = (options: unknown): unknown => options;

export const initLyricsWorker = (): Worker | null => null;

export const parseLyricsAsync = async (): Promise<{ lines: never[] }> => ({ lines: [] });
