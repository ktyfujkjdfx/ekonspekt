import { getQuestionElements } from '../parser/page';
import { BlockedRequestError, isAllowedUrl } from '../shared/netguard';

/**
 * Загрузка страниц теста (только GET, ничего не отправляем).
 * В Firefox content.fetch выполняет запрос «от имени страницы» (с её cookie),
 * обычный fetch content-скрипта там идёт от имени расширения.
 */
export function pageFetch(input: string, init: RequestInit): Promise<Response> {
  // Только сайт курсов: ни картинок с чужих сайтов, ни других адресов.
  if (!isAllowedUrl(input, location.href)) return Promise.reject(new BlockedRequestError('Запрос к стороннему адресу заблокирован.'));
  const c = (globalThis as unknown as { content?: { fetch?: typeof fetch } }).content;
  return c?.fetch ? c.fetch(input, init) : fetch(input, init);
}

export class FetchError extends Error {}
/** Сессия Moodle истекла — продолжать бессмысленно. */
export class SessionError extends FetchError {}

export async function fetchQuizDocument(url: string): Promise<Document> {
  let res: Response;
  try {
    res = await pageFetch(url, { credentials: 'include', redirect: 'follow', cache: 'no-store' });
  } catch {
    throw new FetchError('Не удалось загрузить страницу теста: нет связи с сайтом курсов. Проверьте интернет и попробуйте ещё раз.');
  }
  if (!res.ok) throw new FetchError(`Сайт ответил ошибкой ${res.status} при загрузке страницы теста.`);
  // После вопросов — только навигация курса и скрипты: их не качаем (экономия 20–35 % объёма страницы).
  const html = await readHtmlUntil(res, 'activity-navigation');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const bodyId = doc.body?.id || '';
  if (/login/.test(res.url) || bodyId === 'page-login-index') {
    throw new SessionError('Сессия истекла: войдите на сайт курсов заново и повторите выгрузку.');
  }
  if (!getQuestionElements(doc).length && !/mod-quiz/.test(bodyId)) {
    throw new FetchError('Moodle вернул не страницу теста (возможно, попытка уже завершена или доступ закрыт).');
  }
  return doc;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Текст ответа, но только до метки stopAt (например, конца основного блока страницы): дальше — скрипты и
 * навигация сайта, их не качаем. На странице лекции нужное — первые ~27 %, остальное экономим.
 */
export async function readHtmlUntil(res: Response, stopAt: string): Promise<string> {
  const reader = res.body?.getReader?.();
  if (!reader) return res.text();
  const decoder = new TextDecoder();
  let html = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const from = Math.max(0, html.length - stopAt.length);
      html += decoder.decode(value, { stream: true });
      if (html.indexOf(stopAt, from) >= 0) {
        void reader.cancel().catch(() => {});
        break;
      }
    }
  } catch {
    /* обрыв — разбираем то, что успели получить */
  }
  return html + decoder.decode();
}
