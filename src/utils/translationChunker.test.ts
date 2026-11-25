import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLengthSortedBatches,
  buildParagraphSentencePlan,
  buildProgressiveBatches,
  estimateBatchMaxNewTokens,
  reassembleParagraphs,
  reassemblePartialParagraphs,
} from './translationChunker';

test('buildParagraphSentencePlan preserves multi-sentence paragraphs together for tense context', () => {
  const input =
    'The old stone lighthouse stood high above the cliffs. Every evening, the keeper climbed the stairs.\n\n' +
    'Outside, the wind howled! Was anyone still awake on shore?';

  const plan = buildParagraphSentencePlan(input);
  assert.equal(plan.paragraphOffsets.length, 2);
  assert.equal(plan.sentences.length, 2);
  assert.deepEqual(plan.paragraphOffsets, [
    { start: 0, count: 1 },
    { start: 1, count: 1 },
  ]);

  const rebuilt = reassembleParagraphs(
    [
      'Le vieux phare de pierre se dressait au-dessus des falaises. Chaque soir, le gardien montait les escaliers.',
      'Dehors, le vent hurlait ! Quelqu’un était-il encore éveillé sur la rive ?',
    ],
    plan.paragraphOffsets
  );

  assert.equal(
    rebuilt,
    'Le vieux phare de pierre se dressait au-dessus des falaises. Chaque soir, le gardien montait les escaliers.\n\n' +
      'Dehors, le vent hurlait ! Quelqu’un était-il encore éveillé sur la rive ?'
  );
});

test('buildParagraphSentencePlan splits long paragraphs cleanly within 220 chars without dropping words', () => {
  const longPara =
    'The morning train crossed the iron viaduct above the misty valley, carrying travelers from three coastal towns. ' +
    'Crates of fresh bread and stacks of morning newspapers sat beside wooden trunks bound for Paris. ' +
    'Meanwhile, the conductor walked slowly down the corridor checking every ticket with quiet care. ' +
    'He greeted familiar passengers by name and nodded warmly toward the sunlit windows overlooking the river below. ' +
    'By noon the mist had lifted completely, revealing green orchards stretching all the way to the distant hills.';

  const plan = buildParagraphSentencePlan(longPara);
  assert.ok(plan.sentences.length >= 3);
  for (const s of plan.sentences) {
    assert.ok(s.length <= 220, `Block exceeded 220 chars: ${s.length}`);
  }
  const rejoined = reassembleParagraphs(plan.sentences, plan.paragraphOffsets);
  assert.equal(rejoined, longPara);
});

test('buildProgressiveBatches and reassemblePartialParagraphs stream contiguous translated chunks in order', () => {
  const inputs = ['Title', 'Sentence A.', 'Sentence B.', 'Sentence C.'];
  const batches = buildProgressiveBatches(inputs, 2);
  assert.equal(batches.length, 2);
  assert.deepEqual(batches[0].items, ['Title', 'Sentence A.']);
  assert.deepEqual(batches[0].originalIndices, [0, 1]);
  assert.deepEqual(batches[1].items, ['Sentence B.', 'Sentence C.']);
  assert.deepEqual(batches[1].originalIndices, [2, 3]);

  const offsets = [
    { start: 0, count: 2 },
    { start: 2, count: 1 },
  ];
  assert.equal(reassemblePartialParagraphs(['Phrase A.', undefined, 'Phrase C.'], offsets), 'Phrase A.');
  assert.equal(
    reassemblePartialParagraphs(['Phrase A.', 'Phrase B.', undefined], offsets),
    'Phrase A. Phrase B.'
  );
  assert.equal(
    reassemblePartialParagraphs(['Phrase A.', 'Phrase B.', 'Phrase C.'], offsets),
    'Phrase A. Phrase B.\n\nPhrase C.'
  );
});

test('buildLengthSortedBatches groups similar-length blocks and restores original order cleanly', () => {
  const inputs = [
    'Chapter 1',
    'A very long descriptive paragraph about the coastal lighthouse standing above the rocky cliffs at dawn while ships sail by.',
    'Yes.',
    'Another long paragraph describing the quiet harbor, wooden fishing boats, and warm coffee poured inside the corner bookshop.',
    'The end.',
  ];

  const batches = buildLengthSortedBatches(inputs, 2);
  assert.equal(batches.length, 3);

  // Shortest inputs are grouped together first, longest inputs together last
  assert.deepEqual(batches[0].items, ['Yes.', 'The end.']);
  assert.deepEqual(batches[1].items, [
    'Chapter 1',
    inputs[1],
  ]);
  assert.deepEqual(batches[2].items, [inputs[3]]);

  // Short batch gets a tight token cap; longer batches scale up safely
  assert.equal(batches[0].maxNewTokens, 48);
  assert.ok(batches[2].maxNewTokens > batches[0].maxNewTokens);
  assert.ok(estimateBatchMaxNewTokens(['x'.repeat(1000)]) <= 280);

  // Mapping translated outputs back via originalIndices reconstructs exact original order
  const reconstructed = new Array<string>(inputs.length);
  for (const batch of batches) {
    batch.items.forEach((item, i) => {
      reconstructed[batch.originalIndices[i]] = `FR:${item}`;
    });
  }
  assert.deepEqual(
    reconstructed,
    inputs.map((item) => `FR:${item}`)
  );
});
