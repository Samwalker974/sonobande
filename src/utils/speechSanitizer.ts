/**
 * Removes parasitic / non-literary characters from translated or extracted book text
 * and prepares clean, natural French text for both comfortable reading (#liseuse)
 * and natural TTS speech transcription (retranscription pour la lecture).
 */

const HTML_ENTITY_MAP: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
  '&laquo;': '«',
  '&raquo;': '»',
  '&hellip;': '…',
  '&mdash;': '—',
  '&ndash;': '–',
  '&lt;': ' ',
  '&gt;': ' ',
};

// Common UTF-8 bytes misdecoded as Windows-1252 / Latin-1 in PDFs, EPUBs, and web novels
const MOJIBAKE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/ï»¿/g, ''],
  [/â€™/g, '’'],
  [/â€˜/g, '’'],
  [/â€œ/g, '« '],
  [/â€\u009d/g, ' »'],
  [/â€”/g, '—'],
  [/â€“/g, '–'],
  [/â€¦/g, '…'],
  [/â€¢/g, ' '],
  [/Ã©/g, 'é'],
  [/Ã¨/g, 'è'],
  [/Ãª/g, 'ê'],
  [/Ã«/g, 'ë'],
  [/Ã /g, 'à'],
  [/Ã¢/g, 'â'],
  [/Ã¤/g, 'ä'],
  [/Ã§/g, 'ç'],
  [/Ã´/g, 'ô'],
  [/Ã¶/g, 'ö'],
  [/Ã®/g, 'î'],
  [/Ã¯/g, 'ï'],
  [/Ã¹/g, 'ù'],
  [/Ã»/g, 'û'],
  [/Ã¼/g, 'ü'],
  [/Ã‰/g, 'É'],
  [/Ãˆ/g, 'È'],
  [/ÃŠ/g, 'Ê'],
  [/Ã€/g, 'À'],
  [/Ã‡/g, 'Ç'],
  [/Å“/g, 'œ'],
  [/Å’/g, 'Œ'],
  [/Â«/g, '«'],
  [/Â»/g, '»'],
  [/Â\u00A0/g, ' '],
  [/Â(?=[ \u00A0.,;:!?»])/g, ''],
];

const PDF_LIGATURES: Array<[RegExp, string]> = [
  [/\uFB00/g, 'ff'],
  [/\uFB01/g, 'fi'],
  [/\uFB02/g, 'fl'],
  [/\uFB03/g, 'ffi'],
  [/\uFB04/g, 'ffl'],
  [/\uFB05/g, 'st'],
  [/\uFB06/g, 'st'],
];

function decodeNumericHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d{2,6});/g, (_m, dec: string) => {
      const code = Number.parseInt(dec, 10);
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return ' ';
      try {
        return String.fromCodePoint(code);
      } catch {
        return ' ';
      }
    })
    .replace(/&#x([0-9a-f]{2,5});/gi, (_m, hex: string) => {
      const code = Number.parseInt(hex, 16);
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return ' ';
      try {
        return String.fromCodePoint(code);
      } catch {
        return ' ';
      }
    });
}

/**
 * Strips parasitic symbols, mojibake, PDF ligatures, tokenizer/HTML/markdown artifacts,
 * footnote markers, non-Latin hallucinations, decorative divider lines, and invisible
 * Unicode characters from text while keeping authentic French prose intact.
 */
export function stripParasiticCharacters(text: string): string {
  if (!text) return '';

  let out = text.replace(/\r\n?/g, '\n');

  // 1. Repair common UTF-8-as-Latin-1 mojibake and PDF ligatures
  for (const [pattern, replacement] of MOJIBAKE_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of PDF_LIGATURES) {
    out = out.replace(pattern, replacement);
  }

  // 2. Strip invisible / control / replacement / private-use Unicode characters
  // eslint-disable-next-line no-control-regex
  out = out.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ');
  // Soft hyphens split words across PDF lines -> remove without inserting a space
  out = out.replace(/\u00AD/g, '');
  // Zero-width spaces, directional marks, BOM, replacement chars, private-use glyphs
  out = out.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\uFFFD\uE000-\uF8FF]/g, '');

  // 3. Decode HTML entities (numeric + named) and strip raw HTML/XML tags & NMT control tokens
  out = decodeNumericHtmlEntities(out);
  out = out.replace(
    /&(?:nbsp|amp|quot|apos|#39|rsquo|lsquo|ldquo|rdquo|laquo|raquo|hellip|mdash|ndash|lt|gt);/gi,
    (entity) => HTML_ENTITY_MAP[entity.toLowerCase()] ?? ' '
  );
  // NMT special tokens like <pad>, </s>, <unk>, >>fr<<, SentencePiece ▁, WordPiece ##
  out = out.replace(/>>[a-z]{2,4}<</gi, ' ');
  out = out.replace(
    /<\/?(?:pad|s|unk|bos|eos|sep|cls|mask|br|p|i|b|em|strong|span|div|sup|sub|a|h[1-6]|font|blockquote|section|article|header|footer)(?:\s[^>]*)?>/gi,
    ' '
  );
  // Strip any remaining angle-bracketed markup tokens like <0x0A> or <tag>
  out = out.replace(/<[^>\n]{1,40}>/g, ' ');
  out = out.replace(/▁/g, ' ');
  out = out.replace(/(?<=\p{L})##(?=\p{L})/gu, '');

  // 4. Normalize fullwidth / CJK punctuation occasionally emitted by EPUBs or NMT models
  out = out
    .replace(/[【「『《〈〔［｛]/g, ' ')
    .replace(/[】」』》〉〕］｝]/g, ' ')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/，/g, ',')
    .replace(/。/g, '.')
    .replace(/！/g, '!')
    .replace(/？/g, '?')
    .replace(/：/g, ':')
    .replace(/；/g, ';')
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘‚‛´`]/g, '’');

  // 5. Rejoin PDF line-break hyphenated words (e.g. "extra-\nordinaire" -> "extraordinaire")
  out = out.replace(/(\p{L})-\n(\p{L})/gu, '$1$2');

  // 6. Unwrap Markdown formatting (*italic*, **bold**, _underline_, `code`, ~~strike~~)
  out = out.replace(/\*{1,3}([^*\n]+?)\*{1,3}/g, '$1');
  out = out.replace(/_{1,3}([^_\n]+?)_{1,3}/g, '$1');
  out = out.replace(/~~([^~\n]+?)~~/g, '$1');
  out = out.replace(/`+([^`\n]+?)`+/g, '$1');
  // Strip Markdown heading/blockquote prefixes at start of lines
  out = out.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  out = out.replace(/^[ \t]*>[ \t]*/gm, '');

  // 7. Remove numeric/symbolic footnote markers ([1], [12], [*], [a], superscripts ¹²³)
  out = out.replace(/\[(?:\d{1,4}|[*†‡§#a-z])\]/gi, '');
  out = out.replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]+/g, '');

  // 8. Strict Latin-French prose whitelist: strip ALL non-Latin scripts (CJK, Cyrillic, Greek,
  // Arabic, emojis, pictographs, dingbats, box-drawing, arrows, math & technical symbols)
  // while keeping Latin letters (with all French diacritics), digits, whitespace, and French prose punctuation.
  out = out.replace(
    /[^\p{Script=Latin}\p{Nd}\n \t\u00A0.,;:!?…'’\-—–«»"()€$%°/&]/gu,
    ' '
  );

  // Strip stray standalone symbols not attached to meaningful prose/numbers
  out = out.replace(/(?<!\d[ \u00A0]?)[°%€$](?![ \u00A0]?\d)/g, ' ');
  out = out.replace(/(?<!\p{L})\/(?!\p{L})/gu, ' ');

  // 9. Clean empty brackets, empty quotes & empty guillemets
  out = out.replace(/\(\s*\)/g, ' ');
  out = out.replace(/«[\s\u00A0]*»/g, ' ');
  out = out.replace(/"[\s\u00A0]*"/g, ' ');
  out = out.replace(/’’+/g, '’');
  out = out.replace(/''+/g, "'");

  // 10. Normalize duplicate / runaway punctuation
  out = out.replace(/\.{4,}/g, '…');
  out = out.replace(/\.{3}/g, '…');
  out = out.replace(/\.{2}(?!\.)/g, '.');
  out = out.replace(/,{2,}/g, ',');
  out = out.replace(/;{2,}/g, ';');
  out = out.replace(/:{2,}/g, ':');
  out = out.replace(/!{2,}/g, '!');
  out = out.replace(/\?{2,}/g, '?');
  out = out.replace(/[!?]{2,}/g, '?');
  out = out.replace(/-{3,}/g, ' ');
  out = out.replace(/—{2,}/g, '—');

  // 11. Clean each line and drop purely decorative / symbol-only lines (e.g. "* * *", "---", "==")
  const cleanedLines = out
    .split('\n')
    .map((line) =>
      line
        .replace(/[ \t]{2,}/g, ' ')
        // Strip stray leading junk punctuation (keep dialogue dashes « — and opening parenthesis)
        .replace(/^[,;:.)»\]/\\&]+\s*/, '')
        .trim()
    )
    .filter((line, idx, arr) => {
      // Preserve intentional blank paragraph separators (single empty line)
      if (line === '') {
        return idx > 0 && idx < arr.length - 1 && arr[idx - 1] !== '';
      }
      // Drop lines that contain zero Latin letters or digits (pure symbol/punctuation noise)
      return /[\p{Script=Latin}\p{Nd}]/u.test(line);
    });

  return cleanedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Prepares French text specifically for natural oral speech synthesis (retranscription
 * pour la lecture audio / export MP3). Strips all parasitic symbols, quotes, brackets,
 * URLs, and technical characters that TTS engines otherwise read aloud literally,
 * while preserving natural French pauses and pronunciation.
 */
export function sanitizeTextForSpeech(text: string): string {
  if (!text) return '';

  // Strip raw URLs and bare email addresses BEFORE general sanitization so domain dots/slashes vanish cleanly
  let out = text
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, ' ');

  out = stripParasiticCharacters(out);

  // Expand common inline symbols into natural spoken French words
  out = out.replace(/(\d)\s*°\s*C\b/gi, '$1 degrés Celsius');
  out = out.replace(/(\d)\s*°\s*F\b/gi, '$1 degrés Fahrenheit');
  out = out.replace(/(\d)\s*°/g, '$1 degrés');
  out = out.replace(/(\d)\s*%/g, '$1 pour cent');
  out = out.replace(/(\d)\s*€/g, '$1 euros');
  out = out.replace(/€\s*(\d)/g, '$1 euros');
  out = out.replace(/(\d)\s*\$/g, '$1 dollars');
  out = out.replace(/\$\s*(\d)/g, '$1 dollars');
  out = out.replace(/\s+&\s+/g, ' et ');
  out = out.replace(/&/g, ' et ');

  // Convert word/word slashes into spoken "ou" (e.g. "et/ou" -> "et ou", "jour/nuit" -> "jour ou nuit")
  out = out.replace(/\bet\s*\/\s*ou\b/gi, 'et ou');
  out = out.replace(/(\p{Script=Latin}+)\s*\/\s*(\p{Script=Latin}+)/gu, '$1 ou $2');
  out = out.replace(/\//g, ' ');

  // Strip quotation marks (guillemets & straight/curly quotes) so TTS never says "guillemet"
  out = out.replace(/[«»‹›"“”„‟]/g, ' ');

  // Turn parenthetical asides into comma-buffered pauses instead of spoken brackets
  out = out.replace(/\(\s*([^()]+?)\s*\)/g, ', $1, ');
  out = out.replace(/[()]/g, ' ');

  // Replace dialogue / pause dashes with clean spoken pauses (preserve intra-word hyphens like "peut-être")
  out = out.replace(/^[ \t]*[—–-][ \t]+/gm, '');
  out = out.replace(/[ \t]*[—–][ \t]*/g, ', ');
  out = out.replace(/[ \t]+-[ \t]+/g, ', ');
  out = out.replace(/(^|\s)-(?=\s|$)/g, ' ');

  // Remove any leftover stray symbols outside French letters, digits, whitespace,
  // apostrophes, intra-word hyphens, and natural prosody punctuation
  out = out.replace(/[^\p{Script=Latin}\p{Nd}\s'’\-.,;:!?…]/gu, ' ');

  // Clean awkward punctuation collisions produced by stripping quotes/parentheses/dashes
  out = out.replace(/\u00A0/g, ' ');
  out = out.replace(/\s+([,.;:!?…])/g, '$1');
  out = out.replace(/([,;:])\s*([,.;:!?…])/g, '$2');
  out = out.replace(/([.!?…])\s*,/g, '$1');
  out = out.replace(/^[ \t]*[,;:.]+\s*/gm, '');
  out = out.replace(/\s+/g, ' ').trim();

  // Final check: must contain at least one pronounceable letter or digit
  if (!/[\p{Script=Latin}\p{Nd}]/u.test(out)) {
    return '';
  }

  return out;
}
