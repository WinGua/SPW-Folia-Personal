/* Folia's mods/folium visual styles: not installed in this POC. */
const EMPTY = [] as const;

export const visualizersRegistry = {
    list: () => EMPTY,
    subscribe: (_listener: () => void) => () => {},
    get: (_mode: string): unknown => undefined,
};

export default { visualizersRegistry };
