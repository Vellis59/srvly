const en = require("./en.json");

const locales: Record<string, Record<string, string>> = {
  en,
};

/**
 * Simple i18n: get a translation by key.
 * Falls back to the key itself if not found.
 */
export function t(key: string, locale: string = "en"): string {
  return locales[locale]?.[key] || key;
}

/**
 * Hook for React components.
 * Returns a t() function bound to the current locale.
 */
export function useT() {
  // For now, hardcoded to "en". Could use React context or URL param later.
  return (key: string) => t(key, "en");
}
