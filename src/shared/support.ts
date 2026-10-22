/**
 * Поддержка — как у большинства продуктов без собственного сервера обращений: кнопка открывает готовое письмо
 * в почте студента (Gmail, Яндекс, Mail.ru или почтовая программа). Адрес, тема и шаблон уже заполнены,
 * скриншоты и файлы выгрузки прикрепляются обычной скрепкой, ответ приходит в ту же переписку.
 * Расширение само ничего не отправляет. В шаблон подставляются только версия, браузер и тип страницы —
 * без адресов страниц, номеров попыток и ФИО.
 */

/** Почта поддержки. Меняется здесь одной строкой. */
export const SUPPORT_EMAIL = 'achiimindkit@gmail.com';

export type SupportKind = 'bug' | 'idea' | 'question';

export interface SupportContext {
  version: string;
  browser: string;
  /** Где открыто окно: «тест (попытка)», «лекция»… */
  place: string;
}

export const KIND_LABEL: Record<SupportKind, string> = { bug: 'Проблема', idea: 'Идея', question: 'Вопрос' };

/** Что написать — и подсказки в окне, и вопросы в шаблоне письма. */
export const PROMPTS: Record<SupportKind, string[]> = {
  bug: ['Что случилось', 'Что нажимали перед этим'],
  idea: ['Что хотелось бы', 'Зачем это вам'],
  question: ['Ваш вопрос'],
};

/** Тема — законченная фраза, а не обрыв на двоеточии. */
const SUBJECT: Record<SupportKind, string> = {
  bug: 'что-то не работает',
  idea: 'идея',
  question: 'вопрос',
};

export function supportSubject(kind: SupportKind): string {
  return `еКонспект: ${SUBJECT[kind]}`;
}

/**
 * Письмо, которое хочется дописать: приветствие уже стоит (начать — самое трудное), ответ пишется сразу
 * после двоеточия, о файлах — подсказка «как», а не указание. Служебное — в подписи письма («-- »).
 */
export function supportBody(kind: SupportKind, ctx: SupportContext): string {
  const lines = ['Здравствуйте!', ''];
  for (const p of PROMPTS[kind]) lines.push(`${p}: `, '');
  if (kind !== 'question') lines.push('Скриншот или файл выгрузки можно просто перетащить в письмо.', '');
  lines.push('-- ', `еКонспект ${ctx.version} · ${ctx.browser} · ${ctx.place}`);
  return lines.join('\n');
}

export function mailtoUrl(kind: SupportKind, ctx: SupportContext, to = SUPPORT_EMAIL): string {
  return `mailto:${to}?subject=${encodeURIComponent(supportSubject(kind))}&body=${encodeURIComponent(supportBody(kind, ctx))}`;
}

export type MailerId = 'gmail' | 'yandex' | 'mailru' | 'app';

export interface Mailer {
  id: MailerId;
  /** «Написать в …» на главной кнопке. */
  label: string;
  /** Коротко — в строке «Другая почта». */
  short: string;
}

export const MAILERS: Mailer[] = [
  { id: 'gmail', label: 'Написать в Gmail', short: 'Gmail' },
  { id: 'yandex', label: 'Написать в Яндекс Почте', short: 'Яндекс' },
  { id: 'mailru', label: 'Написать в Почте Mail.ru', short: 'Mail.ru' },
  { id: 'app', label: 'Открыть в почтовой программе', short: 'Программа' },
];

/**
 * Ссылка «новое письмо» в выбранной почте. Для Яндекса и Mail.ru — их собственный формат обработчика mailto
 * (тот же, что они регистрируют в браузере), поэтому тема и текст подставляются надёжно.
 */
export function composeUrl(mailer: MailerId, kind: SupportKind, ctx: SupportContext, to = SUPPORT_EMAIL): string {
  const mailto = mailtoUrl(kind, ctx, to);
  switch (mailer) {
    case 'gmail':
      return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(supportSubject(kind))}&body=${encodeURIComponent(supportBody(kind, ctx))}`;
    case 'yandex':
      return `https://mail.yandex.ru/compose?mailto=${encodeURIComponent(mailto)}`;
    case 'mailru':
      return `https://e.mail.ru/compose/?mailto=${encodeURIComponent(mailto)}`;
    default:
      return mailto;
  }
}

/** «Chrome 141», «Edge 141», «Яндекс.Браузер 25», «Firefox 140» — без лишних подробностей. */
export function browserName(ua: string): string {
  const pick = (re: RegExp, name: string) => {
    const m = ua.match(re);
    return m ? `${name} ${m[1]}` : null;
  };
  return (
    pick(/YaBrowser\/(\d+)/, 'Яндекс.Браузер') ??
    pick(/Edg\/(\d+)/, 'Edge') ??
    pick(/OPR\/(\d+)/, 'Opera') ??
    pick(/Firefox\/(\d+)/, 'Firefox') ??
    pick(/Chrome\/(\d+)/, 'Chrome') ??
    'браузер не определён'
  );
}

/** Где открыто окно — по адресу вкладки, без самого адреса. */
export function placeOf(url: string): string {
  if (/\/mod\/quiz\/attempt\.php/.test(url)) return 'тест (попытка)';
  if (/\/mod\/quiz\/review\.php/.test(url)) return 'тест (просмотр результатов)';
  if (/\/mod\/quiz\//.test(url)) return 'страница теста';
  if (/\/mod\/lesson\//.test(url)) return 'лекция';
  return 'другая страница';
}
