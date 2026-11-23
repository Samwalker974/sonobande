/**
 * Post-processes EN -> FR translations to remove parasitic characters and ensure
 * natural French phrasing, idiomatic expressions, proper French contractions,
 * and authentic typography optimized for both reading and French TTS delivery.
 */
import { stripParasiticCharacters } from './speechSanitizer';

function preserveLeadingCase(source: string, replacement: string): string {
  if (!source || !replacement) return replacement;
  const first = source[0];
  if (first === first.toUpperCase() && first !== first.toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

interface PhrasingRule {
  pattern: RegExp;
  replace: string | ((match: string, ...args: string[]) => string);
}

const FRENCH_PHRASING_RULES: PhrasingRule[] = [
  // Common literal English -> French calques in fiction & non-fiction
  {
    pattern: /\bles escaliers en spirale\b/gi,
    replace: (m) => preserveLeadingCase(m, "l'escalier en colimaçon"),
  },
  {
    pattern: /\bun escalier en spirale\b/gi,
    replace: (m) => preserveLeadingCase(m, 'un escalier en colimaçon'),
  },
  {
    pattern: /\bl['’]escalier en spirale\b/gi,
    replace: (m) => preserveLeadingCase(m, "l'escalier en colimaçon"),
  },
  {
    pattern: /\bdes romans en tissu\b/gi,
    replace: (m) => preserveLeadingCase(m, 'des romans reliés en toile'),
  },
  {
    pattern: /\bde romans en tissu\b/gi,
    replace: (m) => preserveLeadingCase(m, 'de romans reliés en toile'),
  },
  {
    pattern: /\bun roman en tissu\b/gi,
    replace: (m) => preserveLeadingCase(m, 'un roman relié en toile'),
  },
  {
    pattern: /\bune brume d['’]argent\b/gi,
    replace: (m) => preserveLeadingCase(m, 'une brume argentée'),
  },
  {
    pattern: /\bune voix chaude\b/gi,
    replace: (m) => preserveLeadingCase(m, 'une voix chaleureuse'),
  },
  {
    pattern: /\b(?:des|les) fenêtres enroulées\b/gi,
    replace: (m) => preserveLeadingCase(m, 'les vitres embuées'),
  },
  {
    pattern: /\b(?:des|les) fenêtres brouillées\b/gi,
    replace: (m) => preserveLeadingCase(m, 'les vitres embuées'),
  },
  {
    pattern: /\b(?:des|les) fenêtres fictives\b/gi,
    replace: (m) => preserveLeadingCase(m, 'les vitres embuées'),
  },
  {
    pattern: /\b(?:des|les) coques en bois grimpaient\b/gi,
    replace: (m) => preserveLeadingCase(m, 'les coques en bois grinçaient'),
  },
  {
    pattern: /\bla librairie d['’]angle\b/gi,
    replace: (m) => preserveLeadingCase(m, 'la librairie du coin'),
  },
  {
    pattern: /\bjetée en pierre\b/gi,
    replace: (m) => preserveLeadingCase(m, 'jetée de pierre'),
  },
  {
    pattern: /\bfait du sens\b/gi,
    replace: (m) => preserveLeadingCase(m, 'a du sens'),
  },
  {
    pattern: /\bfaisait du sens\b/gi,
    replace: (m) => preserveLeadingCase(m, 'avait du sens'),
  },
  {
    pattern: /\bfaire du sens\b/gi,
    replace: (m) => preserveLeadingCase(m, 'avoir du sens'),
  },
  {
    pattern: /\bdans le milieu de\b/gi,
    replace: (m) => preserveLeadingCase(m, 'au milieu de'),
  },
  {
    pattern: /\bpour la première fois dans sa vie\b/gi,
    replace: (m) => preserveLeadingCase(m, 'pour la première fois de sa vie'),
  },
  {
    pattern: /\bpour la première fois dans ma vie\b/gi,
    replace: (m) => preserveLeadingCase(m, 'pour la première fois de ma vie'),
  },
  {
    pattern: /\btomber en amour\b/gi,
    replace: (m) => preserveLeadingCase(m, 'tomber amoureux'),
  },
  {
    pattern: /\bil y a quelques moments\b/gi,
    replace: (m) => preserveLeadingCase(m, 'il y a quelques instants'),
  },
  {
    pattern: /\bà la fin de la journée,/gi,
    replace: (m) => preserveLeadingCase(m, 'au bout du compte,'),
  },
  {
    pattern: /\bsur une base quotidienne\b/gi,
    replace: (m) => preserveLeadingCase(m, 'au quotidien'),
  },
  {
    pattern: /\ben face de la baie\b/gi,
    replace: (m) => preserveLeadingCase(m, 'au-dessus de la baie'),
  },
  {
    pattern: /\ba encore respiré\b/gi,
    replace: (m) => preserveLeadingCase(m, 'respirait encore'),
  },

  // Universal English-to-French literary & narrative phrasing improvements
  {
    pattern: /\b(ferma|fermé|fermait|ouvrit|ouvert|ouvrait|leva|levé|levait|baissa|baissé|baissait) ses yeux\b/gi,
    replace: (_m, verb) => `${verb} les yeux`,
  },
  {
    pattern: /\b(hocha|hoché|hochait|secoua|secoué|secouait|tourna|tourné|tournait|inclina|incliné|inclinait|pencha|penché|penchait|releva|relevé|relevait|baissa|baissé|baissait) sa tête\b/gi,
    replace: (_m, verb) => `${verb} la tête`,
  },
  {
    pattern: /\b(haussa|haussé|haussait) ses épaules\b/gi,
    replace: (_m, verb) => `${verb} les épaules`,
  },
  {
    pattern: /\b(croisa|croisé|croisait) ses bras\b/gi,
    replace: (_m, verb) => `${verb} les bras`,
  },
  {
    pattern: /\b(leva|levé|levait|tendit|tendu|tendait|glissa|glissé|glissait|posa|posé|posait) sa main\b/gi,
    replace: (_m, verb) => `${verb} la main`,
  },
  {
    pattern: /\b(ferma|fermé|ouvrit|ouvert) sa bouche\b/gi,
    replace: (_m, verb) => `${verb} la bouche`,
  },
  {
    pattern: /\bprofonde respiration\b/gi,
    replace: (m) => preserveLeadingCase(m, 'profonde inspiration'),
  },
  {
    pattern: /\ben aucun temps\b/gi,
    replace: (m) => preserveLeadingCase(m, 'en un rien de temps'),
  },
  {
    pattern: /\baprès un moment\b/gi,
    replace: (m) => preserveLeadingCase(m, 'au bout d’un instant'),
  },
  {
    pattern: /\bpour un moment\b/gi,
    replace: (m) => preserveLeadingCase(m, 'un instant'),
  },
  {
    pattern: /\bpour un long moment\b/gi,
    replace: (m) => preserveLeadingCase(m, 'un long moment'),
  },
  {
    pattern: /\bpour quelques secondes\b/gi,
    replace: (m) => preserveLeadingCase(m, 'quelques secondes'),
  },
  {
    pattern: /\bpour quelques instants\b/gi,
    replace: (m) => preserveLeadingCase(m, 'quelques instants'),
  },
  {
    pattern: /\bpour une seconde\b/gi,
    replace: (m) => preserveLeadingCase(m, 'une seconde'),
  },
  {
    pattern: /\bbeaucoup de fois\b/gi,
    replace: (m) => preserveLeadingCase(m, 'bien des fois'),
  },
  {
    pattern: /\bprendre un siège\b/gi,
    replace: (m) => preserveLeadingCase(m, 'prendre place'),
  },

  // Frequent small-NMT gender, elision & contraction slips
  {
    pattern: /\bun lanterne\b/gi,
    replace: (m) => preserveLeadingCase(m, 'une lanterne'),
  },
  {
    pattern: /\bde la quai\b/gi,
    replace: (m) => preserveLeadingCase(m, 'du quai'),
  },
  {
    pattern: /\bà la quai\b/gi,
    replace: (m) => preserveLeadingCase(m, 'au quai'),
  },
  {
    pattern: /\bla quai\b/gi,
    replace: (m) => preserveLeadingCase(m, 'le quai'),
  },
  {
    pattern: /\bsi (il|ils)\b/gi,
    replace: (m, pronoun) => preserveLeadingCase(m, `s’${pronoun.toLowerCase()}`),
  },
  {
    pattern: /\bde le ([bcdfghjklmnpqrstvwxz])/gi,
    replace: (m, nextChar) => preserveLeadingCase(m, `du ${nextChar}`),
  },
  {
    pattern: /\bà le ([bcdfghjklmnpqrstvwxz])/gi,
    replace: (m, nextChar) => preserveLeadingCase(m, `au ${nextChar}`),
  },
  {
    pattern: /\bde les ([a-zàâäéèêëîïôöùûüç])/gi,
    replace: (m, nextChar) => preserveLeadingCase(m, `des ${nextChar}`),
  },
  {
    pattern: /\bque (il|ils|elle|elles|on|un|une)\b/gi,
    replace: (m, pronoun) => preserveLeadingCase(m, `qu’${pronoun.toLowerCase()}`),
  },
];

function polishFrenchTypography(text: string): string {
  let out = text;

  // Convert balanced straight English quotation marks into authentic French guillemets
  out = out.replace(/"([^"\n]{2,})"/g, (_m, inner: string) => `«\u00A0${inner.trim()}\u00A0»`);

  // Normalize straight apostrophes inside French words to typographic apostrophe for cleaner reading
  out = out.replace(/([A-Za-zÀ-ÿ])'([A-Za-zÀ-ÿ])/g, '$1’$2');

  // Remove stray spaces before commas and periods
  out = out.replace(/\s+([,.])/g, '$1');

  // Enforce clean French spacing before double punctuation (: ; ! ?)
  // Avoid breaking time formats like 12:30 or URLs (https://)
  out = out.replace(/([^\s\d])\s*([;!?])/g, '$1\u00A0$2');
  out = out.replace(/(\S)\s*:(?!\/\/|\d)/g, '$1\u00A0:');

  // Ensure a space after punctuation when followed by a word letter
  out = out.replace(/([,;!?])([A-Za-zÀ-ÿ])/g, '$1 $2');
  out = out.replace(/:([A-Za-zÀ-ÿ])/g, ': $1');

  // Clean accidental duplicate spaces on each line without collapsing paragraph breaks
  out = out
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n');

  return out.trim();
}

/**
 * Refines a translated French chapter text by stripping parasitic characters,
 * applying natural French phrasing and idiomatic turns, and enforcing clean
 * French punctuation while preserving paragraph breaks.
 */
export function polishFrenchTranslation(text: string): string {
  if (!text.trim()) return text;

  let result = stripParasiticCharacters(text);
  if (!result) return '';

  for (const rule of FRENCH_PHRASING_RULES) {
    if (typeof rule.replace === 'string') {
      result = result.replace(rule.pattern, rule.replace);
    } else {
      result = result.replace(rule.pattern, rule.replace);
    }
  }

  return polishFrenchTypography(result);
}

/**
 * Refines a translated French chapter title (single line, clean colon spacing).
 */
export function polishFrenchTitle(title: string): string {
  if (!title.trim()) return title;
  return polishFrenchTranslation(stripParasiticCharacters(title).replace(/\s+/g, ' ').trim())
    .replace(/^["«\u00A0]+|["»\u00A0]+$/g, '')
    .trim();
}
