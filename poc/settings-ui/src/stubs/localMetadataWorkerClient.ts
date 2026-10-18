/* Metadata worker: Folia parses embedded tags/cover hashes in a web worker with music-metadata.
 * The settings window never opens a local file's metadata, so the client keeps the async shape. */
export interface EmbeddedMetadataResult {
    hasCover: boolean;
    [key: string]: unknown;
}

export interface HashedLocalCoverResult {
    hash: string;
    [key: string]: unknown;
}

export const initMetadataWorker = (): Worker | null => null;

export const parseEmbeddedMetadataAsync = async (): Promise<EmbeddedMetadataResult | null> => null;

export const hashLocalCoverBlobAsync = async (): Promise<HashedLocalCoverResult | null> => null;
