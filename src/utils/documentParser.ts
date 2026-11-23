import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { BookSession } from '../types/walkman';
import {
  buildChapterItems,
  buildChaptersFromRawText,
  createBookSession,
} from './bookSplitter';
import { parseEpubArrayBuffer } from './epubParser';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function stripFileExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
}

async function parsePdfFile(
  file: File,
  onProgress?: (label: string) => void
): Promise<BookSession> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdf = await loadingTask.promise;

  const pageTexts: string[] = [];
  const totalPages = pdf.numPages;

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    if (onProgress && (pageNum === 1 || pageNum % 5 === 0 || pageNum === totalPages)) {
      onProgress(`Extraction PDF : page ${pageNum} / ${totalPages}…`);
    }
    const page = await pdf.getPage(pageNum);
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
      pageTexts.push(pageText);
    }
  }

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
}

async function parseEpubFile(
  file: File,
  onProgress?: (label: string) => void
): Promise<BookSession> {
  onProgress?.('Lecture de la structure EPUB…');
  const arrayBuffer = await file.arrayBuffer();
  const baseTitle = stripFileExtension(file.name) || 'Livre EPUB';
  const extracted = await parseEpubArrayBuffer(arrayBuffer, baseTitle);
  const chapters = buildChapterItems(extracted.chapters);

  return createBookSession({
    title: extracted.title || baseTitle,
    source: 'epub',
    fileName: file.name,
    chapters,
  });
}

async function parseTextFile(file: File): Promise<BookSession> {
  const text = (await file.text()).trim();
  if (!text) {
    throw new Error('Le fichier texte importé est vide.');
  }
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
  onProgress?: (label: string) => void
): Promise<BookSession> {
  const lower = file.name.toLowerCase();

  if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
    return parsePdfFile(file, onProgress);
  }
  if (lower.endsWith('.epub') || file.type === 'application/epub+zip') {
    return parseEpubFile(file, onProgress);
  }
  if (lower.endsWith('.txt') || lower.endsWith('.md') || file.type.startsWith('text/')) {
    return parseTextFile(file);
  }

  throw new Error(
    'Format non pris en charge. Importez un fichier PDF, EPUB ou TXT (ou collez votre texte directement).'
  );
}
