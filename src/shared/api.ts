/**
 * Единая точка доступа к API расширений: Firefox (и в будущем Safari) дают `browser`
 * с промисами, Chromium — `chrome` (в MV3 тоже с промисами).
 */
const g = globalThis as unknown as { browser?: typeof chrome; chrome?: typeof chrome };
export const ext: typeof chrome = (g.browser ?? g.chrome)!;

/** Подставляется esbuild при сборке: 'chrome' | 'firefox'. */
declare const __BROWSER__: string;
export const TARGET: string = typeof __BROWSER__ !== 'undefined' ? __BROWSER__ : 'chrome';

export const SITE_ORIGIN = 'https://e.sfu-kras.ru';

/**
 * Сообщение пришло от этого же расширения (popup, фон, наш content script), а не от чужого расширения.
 * Сайты напрямую слать runtime-сообщения не могут, externally_connectable не объявлен — это вторая линия защиты.
 */
export function fromOurExtension(sender: { id?: string } | undefined): boolean {
  return !!sender && sender.id === ext.runtime.id;
}
