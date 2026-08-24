import { gl } from './gl';
import { es } from './es';
import { en } from './en';

export type Lang = 'gl' | 'es' | 'en';

/**
 * The shape every language must have, taken from the Galician dictionary rather than
 * declared separately — one source of truth, and no way for the type and the strings to
 * drift apart.
 *
 * `es` and `en` are annotated with this, so a key they forget is a compile error and a
 * key they invent is one too. That is the whole reason this module exists: the previous
 * arrangement resolved an unknown language to Spanish without complaining.
 */
export type Dict = typeof gl;

const DICTIONARIES: Record<Lang, Dict> = { gl, es, en };

export const LANGS: Lang[] = ['gl', 'es', 'en'];

/** Short code for a two- or three-way toggle. */
export const LANG_CODE: Record<Lang, string> = { gl: 'GL', es: 'ES', en: 'EN' };

export function translations(lang: Lang): Dict {
  return DICTIONARIES[lang] ?? gl;
}

/**
 * BCP 47 tag for Intl formatting. Times and dates used to be formatted with a hardcoded
 * 'gl-ES' regardless of the interface language, which put Galician month names in front
 * of an English reader.
 */
export const LOCALE: Record<Lang, string> = {
  gl: 'gl-ES',
  es: 'es-ES',
  en: 'en-GB',
};

export function isLang(value: unknown): value is Lang {
  return value === 'gl' || value === 'es' || value === 'en';
}
