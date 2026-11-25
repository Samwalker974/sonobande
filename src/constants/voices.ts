import type {
  NeuralVoiceId,
  NeuralVoiceProfile,
  SampleScript,
} from '../types/walkman';

export const DEFAULT_NEURAL_VOICE_ID: NeuralVoiceId = 'fr_FR-siwis-medium';

export const NEURAL_FRENCH_VOICES: NeuralVoiceProfile[] = [
  {
    id: 'fr_FR-siwis-medium',
    name: 'Siwis',
    gender: 'Féminine',
    quality: 'Medium',
    approxSizeMb: 63,
    timbre: 'Claire et équilibrée',
    description: 'Voix polyvalente très nette pour les romans, articles et essais.',
  },
  {
    id: 'fr_FR-upmc-medium',
    name: 'UPMC',
    gender: 'Féminine',
    quality: 'Medium',
    approxSizeMb: 63,
    timbre: 'Douce et posée',
    description: 'Timbre fluide et naturel, particulièrement agréable en écoute prolongée.',
  },
  {
    id: 'fr_FR-tom-medium',
    name: 'Tom',
    gender: 'Masculine',
    quality: 'Medium',
    approxSizeMb: 63,
    timbre: 'Grave et calme',
    description: 'Voix masculine posée, idéale pour les essais, récits et documentaires.',
  },
  {
    id: 'fr_FR-mls-medium',
    name: 'MLS',
    gender: 'Féminine',
    quality: 'Medium',
    approxSizeMb: 63,
    timbre: 'Multi-locuteurs (expérimental)',
    description: 'Modèle multi-locuteurs pouvant produire des artefacts ; préférez Siwis, UPMC ou Tom pour une lecture nette.',
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
