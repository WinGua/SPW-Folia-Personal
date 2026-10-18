/* Local music library: the injected settings page renders settings only, never an imported song,
 * so the local file service is inert here. */
export const initLocalMusicService = async (): Promise<void> => undefined;

export const pickLocalMusicFiles = async (): Promise<never[]> => [];

export const importLocalMusicFiles = async (): Promise<never[]> => [];

export const readLocalMusicFile = async (): Promise<null> => null;

export const removeLocalMusic = async (): Promise<void> => undefined;

export const disposeLocalMusicService = (): void => undefined;
