export interface ParagraphSentencePlan {
  /** Compact 1-2 sentence chunks (<= 220 chars) for fast, progressive neural translation */
  sentences: string[];
  paragraphOffsets: Array<{ start: number; count: number }>;
}

const MAX_BLOCK_CHARS = 220;

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

export interface LengthSortedTranslationBatch {
  items: string[];
  originalIndices: number[];
  maxNewTokens: number;
}

/**
 * Estimates a safe, tight `max_new_tokens` cap for an EN -> FR translation batch
 * based on its longest input block, avoiding wasted decoding steps on short lines.
 */
export function estimateBatchMaxNewTokens(items: readonly string[], hardCap = 280): number {
  let maxChars = 0;
  for (const item of items) {
    if (item.length > maxChars) {
      maxChars = item.length;
    }
  }
  return Math.min(hardCap, Math.max(48, Math.ceil(maxChars * 0.45) + 32));
}

/**
 * Groups translation inputs into length-sorted batches so short titles/sentences
 * aren't padded to the length of long paragraphs during neural decoding.
 */
export function buildLengthSortedBatches(
  inputs: readonly string[],
  batchSize: number
): LengthSortedTranslationBatch[] {
  if (inputs.length === 0) return [];
  const safeBatchSize = Math.max(1, Math.floor(batchSize));

  const orderedIndices = inputs.map((_, index) => index);
  orderedIndices.sort((a, b) => inputs[a].length - inputs[b].length || a - b);

  const batches: LengthSortedTranslationBatch[] = [];
  for (let offset = 0; offset < orderedIndices.length; offset += safeBatchSize) {
    const originalIndices = orderedIndices.slice(offset, offset + safeBatchSize);
    const items = originalIndices.map((idx) => inputs[idx]);
    batches.push({
      items,
      originalIndices,
      maxNewTokens: estimateBatchMaxNewTokens(items),
    });
  }
  return batches;
}

/**
 * Builds small sequential batches in document order so translation streams
 * progressively from the start of the chapter ("par petit bout") with minimal latency.
 */
export function buildProgressiveBatches(
  inputs: readonly string[],
  batchSize: number
): LengthSortedTranslationBatch[] {
  if (inputs.length === 0) return [];
  const safeBatchSize = Math.max(1, Math.floor(batchSize));

  const batches: LengthSortedTranslationBatch[] = [];
  for (let offset = 0; offset < inputs.length; offset += safeBatchSize) {
    const end = Math.min(offset + safeBatchSize, inputs.length);
    const originalIndices: number[] = [];
    const items: string[] = [];
    for (let i = offset; i < end; i++) {
      originalIndices.push(i);
      items.push(inputs[i]);
    }
    batches.push({
      items,
      originalIndices,
      maxNewTokens: estimateBatchMaxNewTokens(items),
    });
  }
  return batches;
}

/**
 * Reassembles only the contiguous translated prefix so partial results can be displayed
 * cleanly in the reader while remaining blocks are still translating.
 */
export function reassemblePartialParagraphs(
  translatedBlocks: readonly (string | undefined)[],
  paragraphOffsets: Array<{ start: number; count: number }>
): string {
  const paragraphs: string[] = [];
  for (const { start, count } of paragraphOffsets) {
    const slice: string[] = [];
    let hasMissing = false;
    for (let i = start; i < start + count; i++) {
      const value = translatedBlocks[i]?.trim();
      if (!value) {
        hasMissing = true;
        break;
      }
      slice.push(value);
    }
    if (slice.length > 0) {
      paragraphs.push(slice.join(' '));
    }
    if (hasMissing) {
      break;
    }
  }
  return paragraphs.join('\n\n');
}
