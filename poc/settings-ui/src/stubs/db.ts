/* IndexedDB cache shim: Folia's visualizer image asset store (莫奈's portrait, 凝彩's layers) sits
 * on top of this database. The POC has no upload pipeline, so every cache read misses. */
export const getFromCache = async (): Promise<null> => null;

export const saveToCache = async (): Promise<void> => undefined;

export const removeFromCache = async (): Promise<void> => undefined;

export const applyLocalLibrarySnapshot = async (): Promise<void> => undefined;

export const readSession = async (): Promise<null> => null;

export const clearSessionValues = async (): Promise<void> => undefined;
