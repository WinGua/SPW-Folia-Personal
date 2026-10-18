/* Cover art / custom pack assets that Folia's Monet and Cappella panels read from its main-process
 * asset store. The POC has no upload pipeline, so the store stays empty with stable setters. */
import { create } from 'zustand';

interface VisualizerAssetState {
    storedCappellaEmojiPack: unknown[];
    cappellaCustomEmojiImages: unknown[];
    isLoadingCappellaCustomEmojiPack: boolean;
    storedCappellaAvatarPack: unknown[];
    cappellaCustomAvatarImages: unknown[];
    isLoadingCappellaCustomAvatarPack: boolean;
    storedMonetBackgroundImage: unknown | null;
    monetBackgroundImage: unknown | null;
    isLoadingMonetBackgroundImage: boolean;
    storedMonetPortraitImage: unknown | null;
    monetPortraitImage: unknown | null;
    isLoadingMonetPortraitImage: boolean;
    setStoredCappellaEmojiPack: (pack: unknown[]) => void;
    setCappellaCustomEmojiImages: (images: unknown[]) => void;
    setIsLoadingCappellaCustomEmojiPack: (loading: boolean) => void;
    setStoredCappellaAvatarPack: (pack: unknown[]) => void;
    setCappellaCustomAvatarImages: (images: unknown[]) => void;
    setIsLoadingCappellaCustomAvatarPack: (loading: boolean) => void;
    setStoredMonetBackgroundImage: (image: unknown | null) => void;
    setMonetBackgroundImage: (image: unknown | null) => void;
    setIsLoadingMonetBackgroundImage: (loading: boolean) => void;
    setStoredMonetPortraitImage: (image: unknown | null) => void;
    setMonetPortraitImage: (image: unknown | null) => void;
    setIsLoadingMonetPortraitImage: (loading: boolean) => void;
}

export const useVisualizerAssetStore = create<VisualizerAssetState>(set => ({
    storedCappellaEmojiPack: [],
    cappellaCustomEmojiImages: [],
    isLoadingCappellaCustomEmojiPack: false,
    storedCappellaAvatarPack: [],
    cappellaCustomAvatarImages: [],
    isLoadingCappellaCustomAvatarPack: false,
    storedMonetBackgroundImage: null,
    monetBackgroundImage: null,
    isLoadingMonetBackgroundImage: false,
    storedMonetPortraitImage: null,
    monetPortraitImage: null,
    isLoadingMonetPortraitImage: false,
    setStoredCappellaEmojiPack: pack => set({ storedCappellaEmojiPack: pack }),
    setCappellaCustomEmojiImages: images => set({ cappellaCustomEmojiImages: images }),
    setIsLoadingCappellaCustomEmojiPack: loading => set({ isLoadingCappellaCustomEmojiPack: loading }),
    setStoredCappellaAvatarPack: pack => set({ storedCappellaAvatarPack: pack }),
    setCappellaCustomAvatarImages: images => set({ cappellaCustomAvatarImages: images }),
    setIsLoadingCappellaCustomAvatarPack: loading => set({ isLoadingCappellaCustomAvatarPack: loading }),
    setStoredMonetBackgroundImage: image => set({ storedMonetBackgroundImage: image }),
    setMonetBackgroundImage: image => set({ monetBackgroundImage: image }),
    setIsLoadingMonetBackgroundImage: loading => set({ isLoadingMonetBackgroundImage: loading }),
    setStoredMonetPortraitImage: image => set({ storedMonetPortraitImage: image }),
    setMonetPortraitImage: image => set({ monetPortraitImage: image }),
    setIsLoadingMonetPortraitImage: loading => set({ isLoadingMonetPortraitImage: loading }),
}));
