/* The settings window's store, but backed by the POC's own configuration store instead of Folia's
 * persisted app store: the reused cards read `smartBeat` / `handleSetSmartBeat` from here, which the
 * POC store exposes under the same names and shapes as Folia's visualizer settings store. */
import { useSettingsStore } from '../model/settings';

export const useVisualizerSettingsStore = useSettingsStore;
