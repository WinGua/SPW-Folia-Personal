/* fflate-backed zip import/export of Tempera layer images: not needed in the settings window, so
 * the module keeps the same exports without touching the filesystem. */
export class TemperaArchiveTooLargeError extends Error {}

export interface TemperaArchiveImportResult {
    images: unknown[];
    errors: string[];
}

export const createTemperaImageArchive = async (_images: unknown[], _name?: string): Promise<Blob> => new Blob();

export const readTemperaImageArchiveFile = async (_file: File): Promise<TemperaArchiveImportResult> => ({
    images: [],
    errors: [],
});
