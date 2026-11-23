export interface ParagraphSentencePlan {
  /** Context-preserving chunks (whole paragraphs or 2-3 sentence groups up to 420 chars) */
  sentences: string[];
  paragraphOffsets: Array<{ start: number; count: number }>;
}

const MAX_BLOCK_CHARS = 420;

function splitLongSentence(sentence: string, maxChars: number): string[] {
  const trimmed = sentence.trim();
  if (trimmed.length <= maxChars) return [trimmed];

  const parts = trimmed.split(/(?<=[;:,—])\s+/);
  const out: string[] = [];
  let current = '';

  const flush = () => {
    if (current.trim()) {
      out.push(current.trim());
      current = '';
    }
  };

  for (const part of parts) {
    if ((current ? `${current} ${part}` : part).length <= maxChars) {
      current = current ? `${current} ${part}` : part;
      continue;
    }

    flush();
    if (part.length <= maxChars) {
      current = part;
      continue;
    }

    const words = part.split(/\s+/);
    for (const word of words) {
      if ((current ? `${current} ${word}` : word).length <= maxChars) {
        current = current ? `${current} ${word}` : word;
      } else {
        flush();
        current = word;
      }
    }
  }

  flush();
  return out.length > 0 ? out : [trimmed];
}

/**
 * Groups paragraphs into context-rich blocks (up to 420 chars) so the neural
 * translator sees multi-sentence narrative flow and maintains natural French
 * tenses (imparfait / passé composé) rather than translating isolated fragments.
 */
export function buildParagraphSentencePlan(text: string): ParagraphSentencePlan {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return { sentences: [], paragraphOffsets: [] };
  }

  const rawParagraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const blocks: string[] = [];
  const paragraphOffsets: Array<{ start: number; count: number }> = [];

  for (const para of rawParagraphs) {
    const start = blocks.length;

    if (para.length <= MAX_BLOCK_CHARS) {
      blocks.push(para);
    } else {
      const rawSentences = para.match(/[^.!?…]+[.!?…]+["”’»)]*|[^.!?…]+$/g) ?? [para];
      let currentBlock = '';

      const flushBlock = () => {
        if (currentBlock.trim()) {
          blocks.push(currentBlock.trim());
          currentBlock = '';
        }
      };

      for (const raw of rawSentences) {
        const cleaned = raw.trim();
        if (!cleaned) continue;

        if ((currentBlock ? `${currentBlock} ${cleaned}` : cleaned).length <= MAX_BLOCK_CHARS) {
          currentBlock = currentBlock ? `${currentBlock} ${cleaned}` : cleaned;
        } else {
          flushBlock();
          if (cleaned.length <= MAX_BLOCK_CHARS) {
            currentBlock = cleaned;
          } else {
            const pieces = splitLongSentence(cleaned, MAX_BLOCK_CHARS);
            blocks.push(...pieces);
          }
        }
      }
      flushBlock();
    }

    const count = blocks.length - start;
    if (count > 0) {
      paragraphOffsets.push({ start, count });
    }
  }

  return { sentences: blocks, paragraphOffsets };
}

/**
 * Reassembles translated blocks back into the original paragraph layout.
 */
export function reassembleParagraphs(
  translatedBlocks: string[],
  paragraphOffsets: Array<{ start: number; count: number }>
): string {
  const paragraphs: string[] = [];
  for (const { start, count } of paragraphOffsets) {
    const slice = translatedBlocks
      .slice(start, start + count)
      .map((s) => s.trim())
      .filter(Boolean);
    if (slice.length > 0) {
      paragraphs.push(slice.join(' '));
    }
  }
  return paragraphs.join('\n\n');
}
