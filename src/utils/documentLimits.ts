export const MAX_IMPORT_FILE_SIZE_BYTES = 20 * 1024 * 1024;
export const MAX_DOCUMENT_TEXT_CHARS = 2_000_000;
export const MAX_AUTO_SAVED_DOCUMENT_CHARS = 1_500_000;

export function getImportFileSizeError(fileSize: number): string | null {
  if (fileSize <= MAX_IMPORT_FILE_SIZE_BYTES) return null;
  return 'Ce fichier dépasse la limite de 20 Mo. Découpez-le en plusieurs fichiers plus petits pour éviter de bloquer le navigateur.';
}

export function getDocumentTextSizeError(characterCount: number): string | null {
  if (characterCount <= MAX_DOCUMENT_TEXT_CHARS) return null;
  return 'Ce document contient plus de 2 millions de caractères. Découpez-le en parties plus petites pour que le navigateur reste réactif.';
}
