/* Local cover assets: the injected settings page has no local music library, so the cover cache
 * pipeline is inert. Folia's library services link against these names; they simply no-op here. */
export const initLocalCoverAssets = async (): Promise<void> => undefined;

export const cancelLocalCoverAssetMigration = (): void => undefined;

export const resetLocalCoverAssetRuntime = (): void => undefined;

export const migrateLegacyLocalCoverAssetsInBackground = async (): Promise<void> => undefined;

export const deleteUnreferencedLocalCoverAssets = async (): Promise<void> => undefined;

export const getLocalCoverAssetUrl = async (): Promise<null> => null;

export const clearLocalCoverAssets = async (): Promise<void> => undefined;
