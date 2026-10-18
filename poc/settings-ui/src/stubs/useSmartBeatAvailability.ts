/* Smart-beat availability: Folia answers this from the desktop runtime (WebGPU + analysis models).
 * This page is the settings face of an environment that does host the beat pipeline (the plugin's
 * host exe feeds audio and beat data), so it reports ready exactly like a desktop Folia install. */

export type SmartBeatAvailability = 'ready' | 'desktopOnly' | 'noGpu';

export const useSmartBeatAvailability = (_enabled?: boolean): SmartBeatAvailability => 'ready';

export const isBeatFxReady = (): boolean => true;
