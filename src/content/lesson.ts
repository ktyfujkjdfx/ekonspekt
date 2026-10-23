import { strToU8, zipSync, type Zippable } from 'fflate';
import { ext, fromOurExtension } from '../shared/api';
import { getSettings, onSettingsChanged, type Settings } from '../shared/settings';
import type { LessonStatus, ProgressMessage, Request, Response } from '../shared/messages';
import { explicitPageIds, parseLessonEnd, parseLessonMeta, parseLessonPage, readSubmittedAnswer, type LessonMeta, type LessonPage } from '../parser/lesson';
import { collectLesson } from './lessonCrawl';
import { codeText, isMonoBlock } from '../parser/text';
import { formatLessonDocument, formatLessonPageForClipboard, formatLessonQuestionForClipboard, imageKey, lessonTypeShort } from '../format/lesson';
import { factFromLessonPage, normalize, type Fact } from '../format/known';
import { safeFileName } from '../format/txt';
import { orderedPages, orderIsApproximate, rememberPage, updateLesson, loadLesson, type StoredLesson } from './lessonStore';
import { rememberFacts } from './known';
import { copyChip, noteFor, ProgressOverlay, withoutImageNeed } from './ui';
import { contentImages } from './copyImage';
import { download } from './export';
import { pageFetch } from './fetchPages';

/**
 * Лекция: страницы запоминаются, пока студент их листает (ничего не отправляем и не обходим сами —
 * переход по лекции засчитывает прохождение). На странице — «Копировать страницу / вопрос / код»,
 * в окне расширения — конспект всей лекции одним файлом (и рисунки в ZIP).
 */
export async function lessonMain(): Promise<void> {
  let settings: Settings = await getSettings();
  const meta = parseLessonMeta(document, location.href);
  const page = parseLessonPage(document, location.href, meta);

  await remember(meta, page);
  watchSubmit(meta, page);

  if (settings.showButtons) injectLessonButtons(meta, page);
  onSettingsChanged((s) => {
    const was = settings.showButtons;
    settings = s;
    if (s.showButtons && !was) injectLessonButtons(meta, page);
    if (!s.showButtons && was) document.querySelectorAll('[data-ecx-lesson]').forEach((n) => n.remove());
  });

  let busy = false;
  const overlay = new ProgressOverlay();
  const progress = (text: string, done?: number, total?: number) => {
    overlay.show(text, done, total);
    send({ type: 'progress', text, done, total });
  };

  const handle = async (msg: Request): Promise<Response> => {
    if (msg?.type === 'status') return { ok: true, lesson: await lessonStatus(meta, busy) };
    if (msg?.type !== 'export' && msg?.type !== 'collectLesson') return { ok: false, error: 'Неизвестная команда' };
    if (busy) return { ok: false, error: 'Выгрузка уже идёт, дождитесь окончания.' };
    busy = true;
    overlay.begin();
    try {
      const message = msg.type === 'collectLesson' ? await collectLesson(meta, progress) : await exportLesson(meta, msg.zip, msg.includeResults, progress);
      overlay.show(message, 1, 1);
      overlay.hide(4000);
      send({ type: 'progress', text: message, finished: true });
      return { ok: true, message };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      overlay.show(error, 0, 0, true);
      overlay.hide(8000);
      send({ type: 'progress', text: error, finished: true, error });
      return { ok: false, error };
    } finally {
      busy = false;
    }
  };
  ext.runtime.onMessage.addListener((msg: Request, sender, sendResponse: (r: Response) => void) => {
    if (!fromOurExtension(sender) || !['status', 'export', 'collectLesson'].includes(msg?.type)) return false;
    handle(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  });
  if (__E2E__) {
    window.addEventListener('message', (ev) => {
      if (ev.source !== window || !ev.data?.ecxE2E) return;
      void handle(ev.data.msg).then((r) => window.postMessage({ ecxE2EResult: r, id: ev.data.id }, '*'));
    });
  }
}

declare const __E2E__: boolean;

function send(m: ProgressMessage) {
  try {
    const p = ext.runtime.sendMessage(m) as unknown as Promise<unknown> | undefined;
    p?.catch?.(() => {});
  } catch {
    /* popup закрыт */
  }
}

/** Запоминаем открытую страницу; на финальной странице и в отзыве — подтверждённые ответы. */
async function remember(meta: LessonMeta, page: LessonPage | null): Promise<StoredLesson | null> {
  if (!meta.cmid || !page) return null;
  const facts: Fact[] = [];
  const links = explicitPageIds(document, meta.cmid);
  const rec = await updateLesson(meta, (r) => {
    if (links.length) r.known = Array.from(new Set([...(r.known ?? []), ...links]));
    if (page.kind === 'content' || page.kind === 'question') {
      rememberPage(r, page);
      return;
    }
    if (page.kind === 'feedback') {
      // Отзыв после ответа: относится к вопросу, который студент только что отправил.
      const target =
        (r.pending && r.pages[r.pending]) || Object.values(r.pages).find((p) => p.kind === 'question' && normalize(p.text) === normalize(page.text));
      if (target) {
        target.correct = page.correct;
        if (!target.answer && page.answer) target.answer = page.answer;
        const f = factFromLessonPage(target, r.cmid);
        if (f) facts.push(f);
      }
      r.pending = null;
      return;
    }
    if (page.kind === 'end') {
      const end = parseLessonEnd(document);
      r.finished = true;
      r.progress = 100;
      r.score = end.score;
      r.max = end.max;
      // Полный балл: все отправленные ответы (кроме эссе — их проверяют вручную) верны.
      if (end.max && end.score === end.max) {
        for (const p of Object.values(r.pages)) {
          if (p.kind === 'question' && p.answer && p.qtype !== 'essay' && p.correct == null) p.correct = true;
          const f = factFromLessonPage(p, r.cmid);
          if (f) facts.push(f);
        }
      }
    }
  });
  if (rec && facts.length) await rememberFacts(rec.course, facts);
  return rec;
}

/** Запоминаем ответ в момент отправки формы — только читаем, отправку не трогаем. */
function watchSubmit(meta: LessonMeta, page: LessonPage | null) {
  if (!page || page.kind !== 'question') return;
  const form = document.querySelector<HTMLFormElement>('[role="main"] form.mform[action*="continue.php"], #region-main form.mform[action*="continue.php"]');
  form?.addEventListener(
    'submit',
    () => {
      const answer = readSubmittedAnswer(form);
      if (!answer) return;
      void updateLesson(meta, (r) => {
        const p = r.pages[page.pageid];
        if (p) {
          p.answer = answer;
          p.correct = null;
        }
        r.pending = page.pageid;
      });
    },
    { capture: true, passive: true } as AddEventListenerOptions,
  );
}

function mark(el: HTMLElement): HTMLElement {
  el.setAttribute('data-ecx-lesson', '');
  return el;
}

function injectLessonButtons(meta: LessonMeta, page: LessonPage | null) {
  if (!page || document.querySelector('[data-ecx-lesson]')) return;
  const main = document.querySelector('[role="main"], #region-main');
  if (!main) return;

  if (page.kind === 'content') {
    const h2 = main.querySelector('h2');
    const chip = mark(
      copyChip({
        label: 'Копировать страницу',
        title: 'Скопировать текст страницы лекции',
        badge: 'Сохранено в конспект',
        getText: () => formatLessonPageForClipboard(parseLessonPage(document, location.href, meta) ?? page, meta.title),
      }),
    );
    if (h2) h2.after(chip);
    else main.querySelector('.contents')?.before(chip);
  }

  if (page.kind === 'question') {
    const chip = mark(
      copyChip({
        label: 'Копировать вопрос',
        title: 'Скопировать вопрос с вариантами; если он ссылается на пример или предыдущий вопрос — вместе с ними',
        badge: `${lessonTypeShort(page)} · сохранено в конспект`,
        getText: async () => {
          const rec = meta.cmid ? await loadLesson(meta.cmid) : null;
          return formatLessonQuestionForClipboard(page, meta.title, rec ? orderedPages(rec) : []);
        },
        // Вопрос с рисунком: вторая кнопка — одна картинка, где и текст вопроса, и рисунок на своём месте.
        withImage: page.images.length
          ? async () => {
              const rec = meta.cmid ? await loadLesson(meta.cmid) : null;
              const stem = main.querySelector('#id_pageheadercontainer .contents') ?? main.querySelector('.contents') ?? main;
              return {
                text: formatLessonQuestionForClipboard(withoutImageNeed(page), meta.title, rec ? orderedPages(rec) : []),
                images: contentImages(stem),
                note: noteFor(page.needs),
              };
            }
          : undefined,
      }),
    );
    const form = main.querySelector('form.mform');
    (form ?? main.querySelector('.contents'))?.before(chip);
  }

  // Код: кнопка над каждым блоком (<pre> или подряд идущие абзацы моноширинным шрифтом).
  const contents = main.querySelector('.contents');
  if (!contents) return;
  const blocks: Element[][] = [];
  for (const el of Array.from(contents.querySelectorAll('pre, p, div'))) {
    if (el.tagName === 'PRE') {
      if (!el.parentElement?.closest('pre')) blocks.push([el]);
      continue;
    }
    if (!isMonoBlock(el) || el.closest('pre')) continue;
    if (isMonoBlock(el.previousElementSibling)) blocks[blocks.length - 1]?.push(el);
    else blocks.push([el]);
  }
  for (const group of blocks) {
    const text = () => group.map((g) => codeText(g).replace(/\s+$/, '')).join('\n');
    if (text().split('\n').length < 2) continue;
    group[0].before(mark(copyChip({ label: 'Копировать код', title: 'Скопировать код с отступами', compact: true, getText: text })));
  }
}

async function lessonStatus(meta: LessonMeta, busy: boolean): Promise<LessonStatus> {
  const rec = meta.cmid ? await loadLesson(meta.cmid) : null;
  const pages = rec ? orderedPages(rec) : [];
  return {
    title: rec?.title || meta.title,
    course: rec?.course || meta.course,
    pages: pages.length,
    content: pages.filter((p) => p.kind === 'content').length,
    questions: pages.filter((p) => p.kind === 'question').length,
    images: pages.reduce((n, p) => n + p.images.length, 0),
    media: pages.reduce((n, p) => n + p.media.length, 0),
    menuTotal: rec?.menu.length || null,
    progress: rec?.progress ?? meta.progress,
    finished: !!rec?.finished,
    answers: pages.filter((p) => p.kind === 'question' && p.answer).length,
    approxOrder: rec ? orderIsApproximate(rec) : false,
    busy,
  };
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
};

async function fetchImage(src: string): Promise<{ data: Uint8Array; ext: string } | null> {
  try {
    const res = await pageFetch(src, { credentials: 'include', cache: 'force-cache' });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    const ext =
      EXT[type] ||
      src
        .match(/\.(png|jpe?g|gif|svg|webp|bmp)(?:[?#]|$)/i)?.[1]
        .toLowerCase()
        .replace('jpeg', 'jpg') ||
      'png';
    return { data: new Uint8Array(await res.arrayBuffer()), ext };
  } catch {
    return null;
  }
}

async function exportLesson(meta: LessonMeta, zip: boolean, withAnswers: boolean, progress: (t: string, d?: number, n?: number) => void): Promise<string> {
  progress('Собираю конспект…', 0, 100);
  const rec = meta.cmid ? await loadLesson(meta.cmid) : null;
  const pages = rec ? orderedPages(rec) : [];
  if (!rec || !pages.length) throw new Error('Пока нечего выгружать: откройте страницы лекции — они запомнятся сами.');

  const imagePaths = new Map<string, string>();
  const files: Zippable = {};
  const failed: string[] = [];
  if (zip) {
    const all = pages.flatMap((p) => p.images.map((img, i) => ({ p, img, i })));
    // Рисунки качаем пачками параллельно; номера файлов — в порядке чтения лекции.
    const got: Awaited<ReturnType<typeof fetchImage>>[] = new Array(all.length).fill(null);
    let done = 0;
    for (let k = 0; k < all.length; k += 6) {
      await Promise.all(
        all.slice(k, k + 6).map(async ({ img }, j) => {
          got[k + j] = await fetchImage(img.src);
          done++;
          progress(`Сохраняю рисунки: ${done} из ${all.length}`, Math.round(10 + (80 * done) / Math.max(1, all.length)), 100);
        }),
      );
    }
    all.forEach(({ p, img, i }, n) => {
      const g = got[n];
      if (!g) {
        failed.push(img.name);
        return;
      }
      const path = `картинки/рис-${String(n + 1).padStart(2, '0')}.${g.ext}`;
      files[path] = [g.data, { level: 0 }];
      imagePaths.set(imageKey(p.pageid, i), path);
    });
  }

  const have = new Set(pages.map((p) => p.pageid));
  const now = new Date();
  const txt = formatLessonDocument(
    {
      title: rec.title,
      course: rec.course,
      section: rec.section,
      url: rec.url,
      progress: rec.progress,
      finished: rec.finished,
      score: rec.score,
      max: rec.max,
      missing: rec.menu.filter((m) => !have.has(m.pageid)).map((m) => m.title),
      approxOrder: orderIsApproximate(rec),
      exportedAt: now,
    },
    pages,
    { imagePaths, withAnswers },
  );

  // Имя файла — как у тестов: «<название>_<дата>».
  const name = rec.title;
  if (zip && imagePaths.size) {
    files[safeFileName(name, now, 'txt')] = strToU8('﻿' + txt);
    progress('Упаковываю архив…', 95, 100);
    await download(zipSync(files), safeFileName(name, now, 'zip'), 'application/zip');
  } else {
    await download(strToU8('﻿' + txt), safeFileName(name, now, 'txt'), 'text/plain;charset=utf-8');
  }

  const content = pages.filter((p) => p.kind === 'content').length;
  const qs = pages.length - content;
  let msg = `Готово: ${content} стр. текста${qs ? `, ${qs} вопр.` : ''}`;
  if (zip) msg += imagePaths.size ? `, рисунков: ${imagePaths.size}` : ', рисунков нет — сохранён TXT';
  if (failed.length) msg += `. Не скачались рисунки: ${failed.slice(0, 3).join(', ')}`;
  return msg;
}
