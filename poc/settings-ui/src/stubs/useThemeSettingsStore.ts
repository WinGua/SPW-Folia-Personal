/* Theme settings store: the settings window only reads a couple of desktop-only switches. */
import { create } from 'zustand';

interface ThemeSettingsState {
    disableAnimations: boolean;
    useSystemTheme: boolean;
}

export const useThemeSettingsStore = create<ThemeSettingsState>(() => ({
    disableAnimations: false,
    useSystemTheme: true,
}));
