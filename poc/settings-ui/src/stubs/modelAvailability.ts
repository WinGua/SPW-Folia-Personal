/* Analysis model availability: BeatEffectsGroup asks whether the drums model is present before
 * showing its drums-only notice. The injected page cannot run the analysis models, so — exactly
 * like Folia's browser build — it answers "absent" and never changes. */

export type AutomixModelName = 'beat_this' | 'htdemucs' | 'htdemucs_gpu';

export type AutomixModelsPresent = Readonly<Record<AutomixModelName, boolean>>;

const ABSENT: AutomixModelsPresent = Object.freeze({
    beat_this: false,
    htdemucs: false,
    htdemucs_gpu: false,
});

const listeners = new Set<() => void>();

export const subscribeModelAvailability = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

export const modelsPresent = (): AutomixModelsPresent => ABSENT;

export const modelCanRun = (_name: AutomixModelName): boolean => false;

export const refreshModelAvailability = async (): Promise<AutomixModelsPresent> => ABSENT;

export const resetModelAvailability = (): void => undefined;
