// Normalized language codes per UI language (used by tracks/subtitles/audio).
// Módulo leaf compartilhado: projects.ts e media-service.ts importam daqui
// (media-service NÃO pode importar de projects.ts — ciclo).

export const LANG_TO_CODES: Record<string, string[]> = {
  'pt-br': ['por', 'pt', 'pt-br', 'ptbr', 'bra', 'pob', 'portuguese', 'portugues', 'dublado'],
  'en': ['eng', 'en', 'en-us', 'english'],
  'es': ['spa', 'es', 'es-419', 'spanish', 'castellano'],
  'fr': ['fre', 'fra', 'fr', 'french'],
  'de': ['ger', 'deu', 'de', 'german'],
  'ja': ['jpn', 'ja', 'japanese'],
  'it': ['ita', 'it', 'italian'],
  'ru': ['rus', 'ru', 'russian'],
  'ko': ['kor', 'ko', 'korean'],
  'zh': ['zho', 'chi', 'zh', 'chinese'],
};

export function buildCodeToLang(): Record<string, string> {
  const codeToLang: Record<string, string> = {};
  for (const [lang, codes] of Object.entries(LANG_TO_CODES)) {
    for (const c of codes) codeToLang[c] = lang;
  }
  return codeToLang;
}

/** Código cru do ffprobe (por/eng) → rótulo amigável (pt-br/en). */
export const codeToLang = buildCodeToLang();

// Rótulos amigáveis por idioma (espelha LANG_LABEL do CinemaPlayer na web).
export const LANG_LABEL: Record<string, string> = {
  'pt-br': 'Português (Brasil)',
  'en': 'Inglês (Original)',
  'es': 'Espanhol',
  'fr': 'Francês',
  'de': 'Alemão',
  'ja': 'Japonês',
  'it': 'Italiano',
  'ru': 'Russo',
  'ko': 'Coreano',
  'und': 'Indefinido',
};
