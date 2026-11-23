import assert from 'node:assert/strict';
import test from 'node:test';
import { polishFrenchTitle, polishFrenchTranslation } from './frenchPolish';

test('polishFrenchTranslation refines common EN->FR calques and gender slips into natural French', () => {
  const raw =
    'Un gardien solitaire a monté les escaliers en spirale du phare, portant un lanterne en laiton. ' +
    'Une brume d\'argent flottait au-dessus de la jetée en pierre.\n\n' +
    'Derrière les fenêtres enroulées de la librairie d\'angle, des romans en tissu attendaient une voix chaude.';

  const polished = polishFrenchTranslation(raw);

  assert.ok(polished.includes('l’escalier en colimaçon'));
  assert.ok(polished.includes('une lanterne en laiton'));
  assert.ok(polished.includes('Une brume argentée'));
  assert.ok(polished.includes('jetée de pierre'));
  assert.ok(polished.includes('les vitres embuées'));
  assert.ok(polished.includes('la librairie du coin'));
  assert.ok(polished.includes('des romans reliés en toile'));
  assert.ok(polished.includes('une voix chaleureuse'));
  assert.ok(polished.includes('\n\n'), 'Must preserve paragraph separation');
});

test('polishFrenchTranslation enforces authentic French guillemets, contractions, and punctuation spacing', () => {
  const raw = 'Il a dit: "Cela fait du sens, que il revienne de la quai!"';
  const polished = polishFrenchTranslation(raw);

  assert.ok(polished.includes('dit\u00A0:'));
  assert.ok(polished.includes('«\u00A0Cela a du sens, qu’il revienne du quai\u00A0!\u00A0»'));
});

test('polishFrenchTitle normalizes chapter titles cleanly', () => {
  assert.equal(
    polishFrenchTitle('Chapitre 1: L\'aube sur le port'),
    'Chapitre 1\u00A0: L’aube sur le port'
  );
});

test('polishFrenchTranslation replaces English possessive body-part calques and idioms with natural French', () => {
  const raw =
    'Elle ferma ses yeux pour un moment, prit une profonde respiration, puis hocha sa tête. ' +
    'Après un moment, il haussa ses épaules comme si il voulait prendre un siège.';
  const polished = polishFrenchTranslation(raw);

  assert.ok(polished.includes('ferma les yeux un instant'));
  assert.ok(polished.includes('profonde inspiration'));
  assert.ok(polished.includes('hocha la tête'));
  assert.ok(polished.includes('Au bout d’un instant'));
  assert.ok(polished.includes('haussa les épaules'));
  assert.ok(polished.includes('comme s’il voulait prendre place'));
});
