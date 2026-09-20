import { createContext, useContext } from 'react';
import { gl } from './gl';
import { es } from './es';
import { en } from './en';

export type Lang = 'gl' | 'es' | 'en';

/**
 * The shape every language must have, taken from the Galician dictionary: `es` and `en`
 * are typed against it, so a key they forget or invent is a compile error.
 */
export type Dict = typeof gl;

const DICTIONARIES: Record<Lang, Dict> = { gl, es, en };

export const LANGS: Lang[] = ['gl', 'es', 'en'];

/** Short code for the toggle. */
export const LANG_CODE: Record<Lang, string> = { gl: 'GL', es: 'ES', en: 'EN' };

/** Each language named in itself, so the person looking for it recognises it. */
export const LANG_NAME: Record<Lang, string> = { gl: 'Galego', es: 'Español', en: 'English' };

/** BCP 47 tag for Intl formatting, so an English reader does not get Galician month names. */
export const LOCALE: Record<Lang, string> = { gl: 'gl-ES', es: 'es-ES', en: 'en-GB' };

export function translations(lang: Lang): Dict {
  return DICTIONARIES[lang] ?? gl;
}

export function isLang(value: unknown): value is Lang {
  return value === 'gl' || value === 'es' || value === 'en';
}

/**
 * The interface language, for components. Set once at the top of the app; everything
 * below reads it through `useLang()` / `useT()` instead of a `lang` prop on every screen.
 */
export const LangContext = createContext<Lang>('gl');

export const useLang = (): Lang => useContext(LangContext);
export const useT = (): Dict => translations(useContext(LangContext));
