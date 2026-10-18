/* Status messages: the reused panels never surface one in the POC, but the store must exist. */
import { create } from 'zustand';

interface StatusMessageState {
    message: string | null;
    setMessage: (message: string) => void;
    clearMessage: () => void;
}

export const useStatusMessageStore = create<StatusMessageState>(set => ({
    message: null,
    setMessage: (message: string) => set({ message }),
    clearMessage: () => set({ message: null }),
}));

export const setStatusMessage = (message: string) => useStatusMessageStore.getState().setMessage(message);
