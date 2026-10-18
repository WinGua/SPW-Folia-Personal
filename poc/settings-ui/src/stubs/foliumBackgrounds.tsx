/* Folia's mods/folium background cards: not installed in this POC. */
import type React from 'react';

const EMPTY = [] as const;

export const backgroundsRegistry = {
    list: () => EMPTY,
    subscribe: (_listener: () => void) => () => {},
    get: (_mode: string): unknown => undefined,
};

export const FoliumBackgroundCards: React.FC<Record<string, unknown>> = () => null;

export default { backgroundsRegistry, FoliumBackgroundCards };
