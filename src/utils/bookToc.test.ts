import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChapterItems } from './bookSplitter';
import {
  buildBookToc,
  formatTocCompactBadge,
  formatTocCompositionSummary,
  formatTocLocationLabel,
} from './bookToc';

test('buildBookToc classifies front-matter info pages without calling them Chapitre and nests chapters under Parties', () => {
  const chapters = buildChapterItems([
    {
      title: 'Chapitre 1',
      text: 'Le Voyage d’Hiver — par Claire Martin. Tous droits réservés. © Éditions du Nord, 2024. ISBN 978-2-00000-000-1.',
    },
    {
      title: 'Chapitre 2',
      text: 'Pour mes parents, qui m’ont appris à aimer les trains de nuit.',
    },
    {
      title: 'Partie I — Le Départ',
      text: 'Première grande étape du voyage vers le nord enneigé.',
    },
    {
      title: 'Chapitre 1 : La gare de Lyon',
      text: 'Le quai résonnait sous les pas pressés des voyageurs du soir.',
    },
    {
      title: 'Chapitre 2 : La frontière',
      text: 'Les montagnes apparaissaient derrière les vitres embuées du wagon.',
    },
    {
      title: 'Partie II — Le Retour',
      text: 'Seconde partie du récit, au printemps suivant.',
    },
    {
      title: 'Chapitre 3 : Le port',
      text: 'La mer retrouvait sa couleur d’ardoise calme sous le vent.',
    },
    {
      title: 'Épilogue',
      text: 'Des années plus tard, le carnet de voyage restait sur la table.',
    },
  ]);

  const toc = buildBookToc(chapters, 'Le Voyage d’Hiver');

  assert.equal(toc.frontmatterCount, 2);
  assert.equal(toc.partCount, 2);
  assert.equal(toc.chapterCount, 3);
  assert.equal(toc.backmatterCount, 1);
  assert.equal(toc.hasParts, true);

  // Front-matter info pages are NEVER called "Chapitre"
  assert.equal(toc.entries[0].kind, 'frontmatter');
  assert.equal(toc.entries[0].displayTitle, 'Mentions & édition');
  assert.equal(toc.entries[0].chapterNumber, null);
  assert.equal(formatTocLocationLabel(toc, 0), 'Mentions & édition');
  assert.equal(formatTocCompactBadge(toc, 0), 'Infos');

  assert.equal(toc.entries[1].kind, 'frontmatter');
  assert.equal(toc.entries[1].displayTitle, 'Dédicace');

  // Part I and its indented chapters
  assert.equal(toc.entries[2].kind, 'part');
  assert.equal(toc.entries[2].depth, 0);
  assert.equal(toc.entries[3].kind, 'chapter');
  assert.equal(toc.entries[3].chapterNumber, 1);
  assert.equal(toc.entries[3].depth, 1);
  assert.equal(toc.entries[3].parentPartTitle, 'Partie I — Le Départ');
  assert.equal(formatTocLocationLabel(toc, 3), 'Chapitre 1 / 3');

  assert.equal(toc.entries[4].kind, 'chapter');
  assert.equal(toc.entries[4].chapterNumber, 2);
  assert.equal(toc.entries[4].depth, 1);

  // Part II and its indented chapter
  assert.equal(toc.entries[5].kind, 'part');
  assert.equal(toc.entries[6].kind, 'chapter');
  assert.equal(toc.entries[6].chapterNumber, 3);
  assert.equal(toc.entries[6].parentPartTitle, 'Partie II — Le Retour');

  // Backmatter outside Part II
  assert.equal(toc.entries[7].kind, 'backmatter');
  assert.equal(toc.entries[7].depth, 0);
  assert.equal(toc.entries[7].parentPartTitle, null);

  assert.equal(
    formatTocCompositionSummary(toc),
    '2 parties · 3 chapitres · 2 pages d’infos · 1 annexe'
  );
});

test('buildBookToc treats auto-split plain text Partie 1 / Partie 2 without chapters as flat playable sections', () => {
  const chapters = buildChapterItems([
    { title: 'Partie 1', text: 'Un long texte collé sans titres de chapitres explicites.' },
    { title: 'Partie 2', text: 'La suite du même texte découpé automatiquement.' },
  ]);

  const toc = buildBookToc(chapters, 'Texte collé');
  assert.equal(toc.hasParts, false);
  assert.equal(toc.chapterCount, 2);
  assert.equal(toc.entries[0].kind, 'chapter');
  assert.equal(toc.entries[0].depth, 0);
});
