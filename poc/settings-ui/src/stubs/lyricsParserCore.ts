/* Lyric text parser: Folia runs the real LRC/YRC/QRC parsers in a worker; the settings window only
 * consumes finished lyric lines from the host, so the pure helpers below are shape-compatible
 * stand-ins. Kept as a named-export surface so Folia modules that import it still link. */
type Line = { fullText: string };

export type LyricParseFormat = string;

export const INTERLUDE_FULL_TEXT = '......';

export const isInterludeLine = (line: Pick<Line, 'fullText'>): boolean => line.fullText === INTERLUDE_FULL_TEXT;

export const attachInterludes = (lines: Line[]): Line[] => lines;

export const finalizeParsedLyricLines = <T>(lines: T[]): T[] => lines;

export const findTranslationsForSortedStartTimes = <T>(): T[] => [];

export const parseLRC = <T>(): T[] => [];

export const parseYRC = <T>(): T[] => [];

export const parseQRC = <T>(): T[] => [];

export const parseVTT = <T>(): T[] => [];

export const parseTTML = <T>(): T[] => [];

export const parseEnhancedLRC = <T>(): T[] => [];

export const parseKRC = <T>(): T[] => [];

export const parseAwlrc = <T>(): T[] => [];

export const parseLyricsByFormat = <T>(): T[] => [];
