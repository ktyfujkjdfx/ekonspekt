import { SITE_ORIGIN } from './api';

/**
 * Сетевой сторож content script: расширение ходит в сеть только к сайту курсов (чтение страниц попытки,
 * просмотра, лекции и их рисунков). Любой другой адрес — картинка с чужого сайта в тексте вопроса,
 * шрифт с CDN, который пыталась бы подгрузить библиотека снимков, — блокируется. data: и blob: — локальные.
 */
export function isAllowedUrl(input: string, base = SITE_ORIGIN): boolean {
  let u: URL;
  try {
    u = new URL(input, base);
  } catch {
    return false;
  }
  if (u.protocol === 'data:' || u.protocol === 'blob:') return true;
  return u.origin === SITE_ORIGIN;
}

export class BlockedRequestError extends Error {}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

let installed = false;

/** Подменяет fetch в изолированном мире content script (на страницу и другие расширения не влияет). */
export function installFetchGuard(base: string): void {
  if (installed) return;
  installed = true;
  const native = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    if (!isAllowedUrl(url, base))
      return Promise.reject(new BlockedRequestError(`еКонспект: запрос к стороннему адресу заблокирован (${new URL(url, base).origin})`));
    return native(input, init);
  }) as typeof fetch;
}
