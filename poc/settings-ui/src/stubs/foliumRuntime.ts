/* Minimal stand-in for Folia's mod-host registry hook: the empty registries are stable snapshots,
 * so useSyncExternalStore can subscribe without looping. */
import { useSyncExternalStore } from 'react';

export interface FoliumHostRegistry {
    list: () => unknown;
    subscribe: (listener: () => void) => () => void;
}

export const useFoliumRegistryEntries = (registry: FoliumHostRegistry): unknown[] =>
    useSyncExternalStore(registry.subscribe, registry.list as () => unknown[], registry.list as () => unknown[]) as unknown[];
