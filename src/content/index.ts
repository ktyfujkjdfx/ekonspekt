import { ext, fromOurExtension } from '../shared/api';
import { getSettings, onSettingsChanged, type Settings } from '../shared/settings';
import type { ProgressMessage, QuizStatus, Request, Response, TypeCounts } from '../shared/messages';
import { detectMode, getQuestionElements, parsePageMeta, parseViewPage } from '../parser/page';
import { parseQuestion } from '../parser/question';
import { injectButtons, observe, ProgressOverlay, removeButtons } from './ui';
import { collectAll, collectQuick, prefetchReview, type Progress } from './collect';
import { exportQuiz } from './export';
import { saveQuestions } from './store';
import { rememberResults } from './known';
import { countLectures } from './lectures';
import { lessonMain } from './lesson';
import { isLessonUrl } from '../parser/lesson';
import { reportBrowserTheme } from '../shared/theme';
import { installFetchGuard } from '../shared/netguard';

/** Команды, которые понимает страница теста; всё остальное игнорируем. */
const KNOWN = new Set<string>(['status', 'export', 'collectAttemptPages']);

const mode = detectMode(location.href, document);
const w = window as unknown as { __ecxLoaded?: boolean };

if (!w.__ecxLoaded) {
  w.__ecxLoaded = true;
  installFetchGuard(location.href); // сеть — только к сайту курсов
  reportBrowserTheme(); // иконка на панели Chromium под тему браузера
  if (mode) void main();
  else if (isLessonUrl(location.href)) void lessonMain();
  else if (/\/mod\/quiz\/view\.php$/.test(location.pathname)) viewPage();
}

/** Страница теста (view.php): подсказываем popup, где взять вопросы. */
function viewPage() {
  ext.runtime.onMessage.addListener((msg: Request, sender, sendResponse: (r: Response) => void) => {
    if (!fromOurExtension(sender) || msg?.type !== 'status') return false;
    sendResponse({ ok: true, view: parseViewPage(document) });
    return false;
  });
}

async function main() {
  let settings: Settings = await getSettings();
  const ctx = { withResults: () => mode === 'review' && settings.includeResults };

  if (settings.showButtons) injectButtons(ctx);
  observe(() => settings.showButtons, ctx);
  onSettingsChanged((s) => {
    const was = settings.showButtons;
    settings = s;
    if (s.showButtons && !was) injectButtons(ctx);
    if (!s.showButtons && was) removeButtons();
  });

  // Попытка: запоминаем вопросы текущей страницы, пока пользователь листает тест.
  if (mode === 'attempt') {
    const meta = parsePageMeta(document, location.href);
    void saveQuestions(meta, getQuestionElements(document), meta.currentPage);
  }
  // Просмотр результатов: запоминаем, что сайт отметил верным и неверным, — пригодится в следующей попытке.
  if (mode === 'review') {
    const meta = parsePageMeta(document, location.href);
    void rememberResults(
      meta,
      getQuestionElements(document).map((el) => parseQuestion(el, { withResults: true })),
    );
  }

  let busy = false;
  const overlay = new ProgressOverlay();
  const progress: Progress = (text, done, total) => {
    overlay.show(text, done, total);
    sendProgress({ type: 'progress', text, done, total });
  };

  const handle = async (msg: Request): Promise<Response> => {
    switch (msg?.type) {
      case 'status':
        // Окно расширения открыто — вероятно, сейчас нажмут «Скачать»: начинаем грузить вопросы заранее.
        if (mode === 'review' && !busy) prefetchReview();
        return { ok: true, status: await status(busy) };
      case 'export':
      case 'collectAttemptPages': {
        if (busy) return { ok: false, error: 'Выгрузка уже идёт, дождитесь окончания.' };
        busy = true;
        overlay.begin();
        try {
          let message: string;
          if (msg.type === 'export') {
            message = await exportQuiz({ zip: msg.zip, includeResults: msg.includeResults, onProgress: progress });
          } else {
            const c = await collectAll({ fetchAttemptPages: true, onProgress: progress });
            message = c.missingNumbers.length
              ? `Собрано ${c.entries.filter((e) => e.number !== 'i').length} из ${c.meta.totalQuestions}. Не удалось: ${c.missingNumbers.map((n) => '№' + n).join(', ')}`
              : `Собраны все вопросы: ${c.entries.filter((e) => e.number !== 'i').length}`;
          }
          overlay.show(message, 1, 1);
          overlay.hide(4000);
          sendProgress({ type: 'progress', text: message, finished: true });
          return { ok: true, message };
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          overlay.show(error, 0, 0, true);
          overlay.hide(8000);
          sendProgress({ type: 'progress', text: error, finished: true, error });
          return { ok: false, error };
        } finally {
          busy = false;
        }
      }
      default:
        return { ok: false, error: 'Неизвестная команда' };
    }
  };

  ext.runtime.onMessage.addListener((msg: Request, sender, sendResponse: (r: Response) => void) => {
    if (!fromOurExtension(sender) || !KNOWN.has(msg?.type)) return false;
    handle(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  });

  // Только для тестовой сборки (--e2e): команды со страницы, т.к. драйвер Firefox не открывает moz-extension://.
  // В сборках для магазинов __E2E__ = false, и esbuild вырезает этот блок.
  if (__E2E__) {
    window.addEventListener('message', (ev) => {
      if (ev.source !== window || !ev.data?.ecxE2E) return;
      void handle(ev.data.msg).then((r) => window.postMessage({ ecxE2EResult: r, id: ev.data.id }, '*'));
    });
  }
}

declare const __E2E__: boolean;

function sendProgress(m: ProgressMessage) {
  try {
    const p = ext.runtime.sendMessage(m) as unknown as Promise<unknown> | undefined;
    p?.catch?.(() => {}); // popup закрыт — не страшно
  } catch {
    /* ignore */
  }
}

async function status(busy: boolean): Promise<QuizStatus> {
  const c = await collectQuick();
  const counts: TypeCounts = { single: 0, multi: 0, match: 0, other: 0, photo: 0, media: 0, others: [] };
  const others = new Map<string, number>();
  for (const e of c.entries) {
    const q = parseQuestion(e.el);
    if (q.media.length) counts.media++;
    if (q.kind === 'info') continue;
    counts[q.kind]++;
    if (q.hasPhoto) counts.photo++;
    if (q.kind === 'other') {
      const name = q.typeName ?? 'неизвестный тип';
      others.set(name, (others.get(name) ?? 0) + 1);
    }
  }
  counts.others = Array.from(others).sort((a, b) => b[1] - a[1]);
  const found = c.entries.filter((e) => e.number !== 'i').length;
  return {
    mode: c.meta.mode!,
    quizTitle: c.meta.quizTitle,
    course: c.meta.course,
    found,
    total: Math.max(c.meta.totalQuestions, found),
    counts,
    missingNumbers: c.missingNumbers,
    willCollectAll: c.meta.mode === 'review',
    freeNavigation: c.meta.freeNavigation,
    rightAnswersShown: c.rightAnswersShown,
    lectures: await countLectures(c.meta),
    busy,
  };
}
