import assert from 'node:assert/strict';
import test from 'node:test';
import { buildParagraphSentencePlan, reassembleParagraphs } from './translationChunker';

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

test('buildParagraphSentencePlan splits long paragraphs cleanly within 420 chars without dropping words', () => {
  const longPara =
    'The morning train crossed the iron viaduct above the misty valley, carrying travelers from three coastal towns. ' +
    'Crates of fresh bread and stacks of morning newspapers sat beside wooden trunks bound for Paris. ' +
    'Meanwhile, the conductor walked slowly down the corridor checking every ticket with quiet care. ' +
    'He greeted familiar passengers by name and nodded warmly toward the sunlit windows overlooking the river below. ' +
    'By noon the mist had lifted completely, revealing green orchards stretching all the way to the distant hills.';

  const plan = buildParagraphSentencePlan(longPara);
  assert.ok(plan.sentences.length >= 2);
  for (const s of plan.sentences) {
    assert.ok(s.length <= 420, `Block exceeded 420 chars: ${s.length}`);
  }
  const rejoined = reassembleParagraphs(plan.sentences, plan.paragraphOffsets);
  assert.equal(rejoined, longPara);
});
