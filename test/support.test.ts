import { describe, expect, it } from 'vitest';
import { browserName, composeUrl, MAILERS, mailtoUrl, placeOf, supportBody, supportSubject, SUPPORT_EMAIL } from '../src/shared/support';

const ctx = { version: '1.0.0', browser: 'Chrome 141', place: 'лекция' };

describe('поддержка: письмо в почте студента', () => {
  it('письмо, которое хочется дописать: законченная тема, приветствие, вопросы, подпись', () => {
    expect(supportSubject('bug')).toBe('еКонспект: что-то не работает');
    expect(supportSubject('idea')).toBe('еКонспект: идея');
    expect(supportBody('bug', ctx)).toBe(
      [
        'Здравствуйте!',
        '',
        'Что случилось: ',
        '',
        'Что нажимали перед этим: ',
        '',
        'Скриншот или файл выгрузки можно просто перетащить в письмо.',
        '',
        '-- ',
        'еКонспект 1.0.0 · Chrome 141 · лекция',
      ].join('\n'),
    );
    expect(supportBody('question', ctx)).toBe('Здравствуйте!\n\nВаш вопрос: \n\n-- \nеКонспект 1.0.0 · Chrome 141 · лекция');
  });

  it('Gmail: адрес, тема и текст в ссылке «новое письмо»', () => {
    const url = new URL(composeUrl('gmail', 'idea', ctx));
    expect(url.origin + url.pathname).toBe('https://mail.google.com/mail/');
    expect(url.searchParams.get('view')).toBe('cm');
    expect(url.searchParams.get('to')).toBe(SUPPORT_EMAIL);
    expect(url.searchParams.get('su')).toBe('еКонспект: идея');
    expect(url.searchParams.get('body')).toContain('Зачем это вам: ');
  });

  it('Яндекс и Mail.ru: их формат обработчика mailto, внутри — то же письмо', () => {
    const y = new URL(composeUrl('yandex', 'bug', ctx));
    expect(y.origin + y.pathname).toBe('https://mail.yandex.ru/compose');
    expect(y.searchParams.get('mailto')).toBe(mailtoUrl('bug', ctx));
    const m = new URL(composeUrl('mailru', 'bug', ctx));
    expect(m.origin + m.pathname).toBe('https://e.mail.ru/compose/');
    expect(m.searchParams.get('mailto')).toBe(mailtoUrl('bug', ctx));
    expect(composeUrl('app', 'bug', ctx).startsWith(`mailto:${SUPPORT_EMAIL}?subject=`)).toBe(true);
  });

  it('четыре способа написать; главный по умолчанию — Gmail', () => {
    expect(MAILERS.map((m) => m.id)).toEqual(['gmail', 'yandex', 'mailru', 'app']);
  });

  it('в письмо не попадает адрес страницы — только тип', () => {
    const url = 'https://e.sfu-kras.ru/mod/quiz/review.php?attempt=9438238&cmid=1444279';
    const body = supportBody('bug', { ...ctx, place: placeOf(url) });
    expect(body).not.toMatch(/attempt|9438238|sfu/);
    expect(body).toContain('тест (просмотр результатов)');
  });

  it('браузер — коротко', () => {
    expect(browserName('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36')).toBe('Chrome 141');
    expect(browserName('Mozilla/5.0 Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0')).toBe('Edge 141');
    expect(browserName('Mozilla/5.0 Chrome/138.0.0.0 YaBrowser/25.8.0.0 Safari/537.36')).toBe('Яндекс.Браузер 25');
    expect(browserName('Mozilla/5.0 (Windows NT 10.0; rv:140.0) Gecko/20100101 Firefox/140.0')).toBe('Firefox 140');
  });
});
