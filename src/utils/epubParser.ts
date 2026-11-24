import JSZip from 'jszip';
import { getDocumentTextSizeError } from './documentLimits';

export interface ExtractedEpubBook {
  title: string;
  chapters: Array<{ title: string; text: string }>;
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  laquo: '«',
  raquo: '»',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  oelig: 'œ',
  OElig: 'Œ',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  agrave: 'à',
  acirc: 'â',
  ccedil: 'ç',
  ocirc: 'ô',
  ucirc: 'û',
  ugrave: 'ù',
  icirc: 'î',
  iuml: 'ï',
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    return HTML_ENTITIES[entity] ?? ' ';
  });
}

function stripXmlTags(input: string): string {
  return decodeEntities(input.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function extractReadableTextFromXhtml(xhtml: string): { heading: string | null; text: string } {
  const bodyMatch = xhtml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : xhtml;

  const withoutHidden = body
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '');

  const headingMatch = withoutHidden.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i);
  const heading = headingMatch ? stripXmlTags(headingMatch[1]) : null;

  const withBreaks = withoutHidden
    .replace(/<(?:br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|h[1-6]|li|blockquote|section|article|tr)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');

  const decoded = decodeEntities(withBreaks);
  const paragraphs = decoded
    .split(/\n{2,}/)
    .map((p) => p.replace(/[ \t]+/g, ' ').replace(/\n+/g, ' ').trim())
    .filter(Boolean);

  return {
    heading: heading && heading.length <= 120 ? heading : null,
    text: paragraphs.join('\n\n'),
  };
}

function resolveRelativePath(baseDir: string, href: string): string {
  const cleanHref = decodeURIComponent(href.split('#')[0]).replace(/^\/+/, '');
  if (!baseDir) return cleanHref;
  const baseParts = baseDir.split('/').filter(Boolean);
  const relParts = cleanHref.split('/').filter(Boolean);
  for (const part of relParts) {
    if (part === '..') {
      baseParts.pop();
    } else if (part !== '.') {
      baseParts.push(part);
    }
  }
  return baseParts.join('/');
}

function getAttr(tag: string, attrName: string): string | null {
  const regex = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const match = tag.match(regex);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

/**
 * Pure TypeScript EPUB extractor (100% client-side, works in browser and Node).
 * Reads container.xml -> OPF spine -> manifest XHTML chapters in exact reading order.
 */
export async function parseEpubArrayBuffer(
  buffer: ArrayBuffer | Uint8Array,
  fallbackTitle = 'Livre EPUB'
): Promise<ExtractedEpubBook> {
  const zip = await JSZip.loadAsync(buffer);

  // 1. Locate OPF path from META-INF/container.xml
  let opfPath: string | null = null;
  const containerFile = zip.file('META-INF/container.xml');
  if (containerFile) {
    const containerXml = await containerFile.async('text');
    const rootfileMatch = containerXml.match(/<rootfile\b[^>]*>/i);
    if (rootfileMatch) {
      opfPath = getAttr(rootfileMatch[0], 'full-path');
    }
  }

  if (!opfPath) {
    // Fallback: locate any .opf file in the archive
    const opfEntry = Object.keys(zip.files).find((name) => name.toLowerCase().endsWith('.opf'));
    if (!opfEntry) {
      throw new Error("Fichier EPUB invalide : descripteur OPF introuvable.");
    }
    opfPath = opfEntry;
  }

  const opfFile = zip.file(opfPath);
  if (!opfFile) {
    throw new Error("Impossible de lire le manifeste du livre EPUB.");
  }

  const opfXml = await opfFile.async('text');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';

  // 2. Book title from dc:title
  const titleMatch = opfXml.match(/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i);
  const bookTitle = titleMatch ? stripXmlTags(titleMatch[1]) || fallbackTitle : fallbackTitle;

  // 3. Parse manifest id -> href
  const manifest = new Map<string, { href: string; mediaType: string }>();
  const itemMatches = opfXml.matchAll(/<item\b[^>]*>/gi);
  for (const m of itemMatches) {
    const tag = m[0];
    const id = getAttr(tag, 'id');
    const href = getAttr(tag, 'href');
    const mediaType = getAttr(tag, 'media-type') ?? '';
    if (id && href) {
      manifest.set(id, { href, mediaType });
    }
  }

  // 4. Parse spine order
  const spineIds: string[] = [];
  const itemrefMatches = opfXml.matchAll(/<itemref\b[^>]*>/gi);
  for (const m of itemrefMatches) {
    const idref = getAttr(m[0], 'idref');
    if (idref) spineIds.push(idref);
  }

  const orderedFiles: string[] = [];
  for (const idref of spineIds) {
    const entry = manifest.get(idref);
    if (!entry) continue;
    if (
      entry.mediaType.includes('html') ||
      /\.(x?html?|xml)$/i.test(entry.href)
    ) {
      orderedFiles.push(resolveRelativePath(opfDir, entry.href));
    }
  }

  // Fallback if spine was empty
  if (orderedFiles.length === 0) {
    for (const fileName of Object.keys(zip.files).sort()) {
      if (/\.(x?html?)$/i.test(fileName) && !fileName.toLowerCase().includes('nav')) {
        orderedFiles.push(fileName);
      }
    }
  }

  // 5. Extract readable chapters
  const chapters: Array<{ title: string; text: string }> = [];
  let extractedCharacters = 0;
  for (const filePath of orderedFiles) {
    const zipEntry = zip.file(filePath);
    if (!zipEntry) continue;
    const xhtml = await zipEntry.async('text');
    const { heading, text } = extractReadableTextFromXhtml(xhtml);
    // Skip empty/cover-only pages with fewer than 20 characters
    if (text.length < 20) continue;
    extractedCharacters += text.length;
    const sizeError = getDocumentTextSizeError(extractedCharacters);
    if (sizeError) throw new Error(sizeError);
    chapters.push({
      title: heading || `Chapitre ${chapters.length + 1}`,
      text,
    });
  }

  if (chapters.length === 0) {
    throw new Error("Aucun texte lisible n'a été trouvé dans ce fichier EPUB (vérifiez qu'il n'est pas protégé par DRM).");
  }

  return {
    title: bookTitle,
    chapters,
  };
}
