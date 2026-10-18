/* Player chrome settings: the reused panels only read the native-blur toggle for a notice. */
import { create } from 'zustand';

interface PlayerChromeSettingsState {
    enablePlayerPageNativeBlur: boolean;
    playerChromeVisibilityMode: 'auto' | 'always' | 'hover';
}

export const usePlayerChromeSettingsStore = create<PlayerChromeSettingsState>(() => ({
    enablePlayerPageNativeBlur: false,
    playerChromeVisibilityMode: 'auto',
}));
