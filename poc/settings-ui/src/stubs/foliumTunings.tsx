/* Folia's mods/folium tuning cards: not installed in this POC, so the mod registry is empty. */
import type React from 'react';

const EMPTY = [] as const;

export const tuningsRegistry = {
    list: () => EMPTY,
    subscribe: (_listener: () => void) => () => {},
    get: (_id: string): unknown => undefined,
};

export const FoliumTuningCards: React.FC<Record<string, unknown>> = () => null;

export default { tuningsRegistry, FoliumTuningCards };
