import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { BookSession } from '../types/walkman';
import {
  buildChapterItems,
  buildChaptersFromRawText,
  createBookSession,
} from './bookSplitter';
import {
  getDocumentTextSizeError,
  getImportFileSizeError,
} from './documentLimits';
import { parseEpubArrayBuffer } from './epubParser';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface DocumentImportProgress {
  label: string;
  completed?: number;
  total?: number;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Import annulé', 'AbortError');
  }
}

function stripFileExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
}

async function parsePdfFile(
  file: File,
  onProgress?: (progress: DocumentImportProgress) => void,
  signal?: AbortSignal
): Promise<BookSession> {
  throwIfAborted(signal);
  const arrayBuffer = await file.arrayBuffer();
  throwIfAborted(signal);
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });

  try {
    const pdf = await loadingTask.promise;
    throwIfAborted(signal);
    const pageTexts: string[] = [];
    const totalPages = pdf.numPages;
    let extractedCharacters = 0;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      throwIfAborted(signal);
      if (onProgress && (pageNum === 1 || pageNum % 5 === 0 || pageNum === totalPages)) {
        onProgress({
          label: `Extraction PDF : page ${pageNum} / ${totalPages}…`,
          completed: pageNum,
          total: totalPages,
        });
      }
      const page = await pdf.getPage(pageNum);
      throwIfAborted(signal);
      const textContent = await page.getTextContent();

      let lastY: number | null = null;
      const lines: string[] = [];
      let currentLine = '';

      for (const item of textContent.items) {
        if (!('str' in item)) continue;
        const str = item.str;
        const y = Array.isArray(item.transform) ? Math.round(item.transform[5]) : null;

        if (lastY !== null && y !== null && Math.abs(y - lastY) > 6) {
          if (currentLine.trim()) lines.push(currentLine.trim());
          currentLine = str;
        } else {
          currentLine += currentLine && str && !currentLine.endsWith(' ') && !str.startsWith(' ')
            ? ` ${str}`
            : str;
        }
        if (y !== null) lastY = y;
      }

      if (currentLine.trim()) lines.push(currentLine.trim());
      const pageText = lines.join('\n').trim();
      if (pageText) {
        extractedCharacters += pageText.length;
        const sizeError = getDocumentTextSizeError(extractedCharacters);
        if (sizeError) throw new Error(sizeError);
        pageTexts.push(pageText);
      }
    }

    throwIfAborted(signal);
    const fullText = pageTexts.join('\n\n').trim();
    if (!fullText) {
      throw new Error(
        "Ce PDF ne contient pas de texte sélectionnable (il s'agit peut-être d'un document scanné en images)."
      );
    }

    const baseTitle = stripFileExtension(file.name) || 'Livre PDF';
    const chapters = buildChaptersFromRawText(fullText, baseTitle);

    return createBookSession({
      title: baseTitle,
      source: 'pdf',
      fileName: file.name,
      chapters,
    });
  } finally {
    await loadingTask.destroy();
  }
}

async function parseEpubFile(
  file: File,
  onProgress?: (progress: DocumentImportProgress) => void,
  signal?: AbortSignal
): Promise<BookSession> {
  throwIfAborted(signal);
  onProgress?.({ label: 'Lecture de la structure EPUB…' });
  const arrayBuffer = await file.arrayBuffer();
  throwIfAborted(signal);
  const baseTitle = stripFileExtension(file.name) || 'Livre EPUB';
  const extracted = await parseEpubArrayBuffer(arrayBuffer, baseTitle);
  throwIfAborted(signal);
  const chapters = buildChapterItems(extracted.chapters);

  return createBookSession({
    title: extracted.title || baseTitle,
    source: 'epub',
    fileName: file.name,
    chapters,
  });
}

async function parseTextFile(file: File, signal?: AbortSignal): Promise<BookSession> {
  throwIfAborted(signal);
  const text = (await file.text()).trim();
  throwIfAborted(signal);
  if (!text) {
    throw new Error('Le fichier texte importé est vide.');
  }
  const sizeError = getDocumentTextSizeError(text.length);
  if (sizeError) throw new Error(sizeError);
  const baseTitle = stripFileExtension(file.name) || 'Document texte';
  const chapters = buildChaptersFromRawText(text, baseTitle);

  return createBookSession({
    title: baseTitle,
    source: 'txt',
    fileName: file.name,
    chapters,
  });
}

/**
 * Parses a PDF, EPUB, TXT, or Markdown file 100% locally in browser RAM.
 */
export async function importDocumentFile(
  file: File,
  onProgress?: (progress: DocumentImportProgress) => void,
  signal?: AbortSignal
): Promise<BookSession> {
  throwIfAborted(signal);
  const lower = file.name.toLowerCase();
  const isPdf = lower.endsWith('.pdf') || file.type === 'application/pdf';
  const isEpub = lower.endsWith('.epub') || file.type === 'application/epub+zip';
  const isText =
    lower.endsWith('.txt') || lower.endsWith('.md') || file.type.startsWith('text/');

  if (!isPdf && !isEpub && !isText) {
    throw new Error(
      'Format non pris en charge. Importez un fichier PDF, EPUB ou TXT (ou collez votre texte directement).'
    );
  }

  const fileSizeError = getImportFileSizeError(file.size);
  if (fileSizeError) throw new Error(fileSizeError);

  if (isPdf) {
    return parsePdfFile(file, onProgress, signal);
  }
  if (isEpub) {
    return parseEpubFile(file, onProgress, signal);
  }
  if (isText) {
    return parseTextFile(file, signal);
  }

  throw new Error('Impossible de déterminer le format du document.');
}
