import type {
  NeuralVoiceProfile,
  SampleScript,
} from '../types/walkman';

export const NEURAL_FRENCH_VOICES: NeuralVoiceProfile[] = [
  {
    id: 'fr-FR-DeniseNeural',
    name: 'Denise',
    gender: 'Féminine',
    timbre: 'Claire et naturelle',
    description: 'Voix neuronale française fluide et chaleureuse, rapide et très naturelle pour les livres longs.',
  },
  {
    id: 'fr-FR-HenriNeural',
    name: 'Henri',
    gender: 'Masculine',
    timbre: 'Grave et posé',
    description: 'Timbre masculin radiophonique naturel, idéal pour les essais, récits et documentaires.',
  },
  {
    id: 'fr-FR-VivienneMultilingualNeural',
    name: 'Vivienne',
    gender: 'Féminine',
    timbre: 'Narratrice HD',
    description: 'Voix neuronale haute définition très expressive, parfaite pour les romans et dialogues.',
  },
  {
    id: 'fr-FR-RemyMultilingualNeural',
    name: 'Rémy',
    gender: 'Masculine',
    timbre: 'Conteur HD',
    description: 'Voix masculine haute définition au phrasé vivant, idéale pour une écoute immersive.',
  },
  {
    id: 'fr-FR-EloiseNeural',
    name: 'Éloïse',
    gender: 'Féminine',
    timbre: 'Douce et vive',
    description: 'Diction légère et articulée, agréable pour les articles et récits contemporains.',
  },
];

export const FRENCH_SAMPLE_SCRIPTS: SampleScript[] = [
  {
    id: 'carnet-chapitres',
    title: 'Carnet de voyage (FR)',
    language: 'fr',
    text: `Chapitre 1 : L'aube sur le port

À six heures du matin, le port respire encore le calme de la nuit. Les coques en bois grincent doucement contre les amarres pendant que la brume se lève au-dessus des jetées. Un premier chalutier quitte le bassin dans un bourdonnement régulier.

Chapitre 2 : La librairie du quai

Derrière les vitrines embuées, les rayons débordent de romans anciens et de carnets reliés de toile. Le libraire prépare son café en feuilletant une édition de poche, convaincu qu'une voix posée donne à chaque page une seconde vie.`,
  },
  {
    id: 'coastal-lighthouse-en',
    title: 'The Coastal Lighthouse (EN → FR)',
    language: 'en',
    text: `Chapter 1: Dawn Over the Harbor

At six in the morning, the coastal harbor still breathed the quiet of the night. Wooden hulls creaked softly against their moorings while a silver mist rose above the stone pier.

A solitary keeper climbed the spiral stairs of the lighthouse, carrying a brass lantern and a leather notebook filled with weather observations.

Chapter 2: The Bookshop on the Pier

Behind the fogged windows of the corner bookshop, tall wooden shelves overflowed with sea charts and clothbound novels. The bookseller poured hot coffee and smiled, convinced that a warm voice gives every printed page a second life.`,
  },
  {
    id: 'essai-acoustique',
    title: 'Essai — Le baladeur (FR)',
    language: 'fr',
    text: `Introduction : Le son nomade

Lorsque les premiers baladeurs à cassette apparaissent à la fin des années soixante-dix, l'écoute devient soudain mobile et intime. On glisse un livre audio ou un album dans sa poche, on appuie sur une touche mécanique franche, et le monde extérieur s'efface.`,
  },
];

export function getNeuralVoiceById(id: string): NeuralVoiceProfile {
  return NEURAL_FRENCH_VOICES.find((v) => v.id === id) ?? NEURAL_FRENCH_VOICES[0];
}
