/**
 * Обезвреживание копий разметки со страницы перед вставкой в документ (снимки вопросов, карточка «С картинкой»).
 *
 * Копия вопроса ненадолго попадает в скрытый контейнер на странице, чтобы её сфотографировать. Если в тексте
 * вопроса окажется <img onerror=…>, <script> или javascript:-ссылка, браузер выполнил бы их — в мире самой
 * страницы, а не расширения, но и это лишнее. Поэтому из копии убираем всё исполняемое: элементы-контейнеры
 * кода и встраивания, обработчики on*, опасные URL. Для снимка этого достаточно: вид вопроса не меняется.
 */

const DROP = 'script, noscript, iframe, frame, frameset, object, embed, applet, base, meta, link, portal, template';
const URL_ATTRS = ['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'background', 'data', 'srcset'];
const DANGEROUS_URL = /^\s*(javascript|vbscript|data\s*:\s*text\/html)/i;

/** Обезвреживает элемент и всё внутри (на месте). Возвращает тот же элемент. */
export function neutralize<T extends Element>(root: T): T {
  root.querySelectorAll(DROP).forEach((n) => n.remove());
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') el.removeAttribute(attr.name);
      // eslint-disable-next-line no-control-regex -- управляющие символы внутри «java<TAB>script:» убираем намеренно
      else if (URL_ATTRS.includes(name) && DANGEROUS_URL.test(attr.value.replace(/[\u0000-\u0020]+/g, ''))) el.removeAttribute(attr.name);
    }
  }
  return root;
}
