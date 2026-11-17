import { emit } from './events.js';

export const comicWords = {
  'FWIP!': { tint: 0xffe1ad, scale: 0.23 },
  'KRRUNCH!': { tint: 0xffd468, scale: 0.36 },
  'FWHIP!': { tint: 0xb7eff2, scale: 0.24 },
  'P’LUNK!': { tint: 0xffa858, scale: 0.30 },
  'KA-CHAK!': { tint: 0xffe67a, scale: 0.33 },
  'TIK!': { tint: 0xffe1ad, scale: 0.23 },
  'R-R-R-CHUNK.': { tint: 0xffba75, scale: 0.45 },
  'DING-DONG.': { tint: 0xffe8a6, scale: 0.34 },
  'TUP.': { tint: 0xffe1ad, scale: 0.22 },
  'KLIK.': { tint: 0xb7eff2, scale: 0.25 },
  'PIP.': { tint: 0xb7eff2, scale: 0.23 },
  'TOK.': { tint: 0xffad9c, scale: 0.26 },
} as const;

export type ComicWord = keyof typeof comicWords;
export type ComicWordCue = { word: ComicWord; position?: { x: number; y: number; z: number } };

export function showComicWord(word: ComicWord, position?: ComicWordCue['position']) {
  emit('comic-word', { word, position } satisfies ComicWordCue);
}
