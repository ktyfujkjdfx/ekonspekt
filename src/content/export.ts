import { strToU8, zipSync, type Zippable } from 'fflate';
import { ext, TARGET } from '../shared/api';
import { parseQuestion } from '../parser/question';
import { parseAttemptSummary } from '../parser/page';
import { formatDocument, imageFileName, safeFileName } from '../format/txt';
import type { DownloadMessage } from '../shared/messages';
import { captureQuestion, disposeRenderContainer, withLightTheme } from './capture';
import { collectAll, type Progress } from './collect';
import { knownForExport, rememberResults } from './known';
import { lecturesForQuiz } from './lectures';

export interface ExportOptions {
  zip: boolean;
  includeResults: boolean;
  onProgress: Progress;
}

const BOM = '﻿';

export async function exportQuiz(opts: ExportOptions): Promise<string> {
  const { onProgress } = opts;
  // Одна полоска на всю выгрузку: сбор страниц, затем снимки, затем упаковка. Она только растёт.
  const stage =
    (from: number, to: number): Progress =>
    (text, d, t) =>
      onProgress(text, Math.round(from + (to - from) * (t ? Math.min(1, (d ?? 0) / t) : 0)), 100);
  const collectEnd = opts.zip ? 60 : 95;
  stage(0, collectEnd)('Собираю вопросы…');
  const collected = await collectAll({ onProgress: stage(0, collectEnd) });
  const { meta, entries } = collected;
  if (!entries.length) throw new Error('На этой странице нет вопросов теста. Откройте страницу с вопросами или просмотр результатов.');

  const withResults = opts.includeResults && meta.mode === 'review';
  const questions = entries.map((e) => parseQuestion(e.el, { withResults }));
  // Ответы, уже подтверждённые сайтом в прошлых попытках курса, и запоминание отметок этой попытки.
  const { known, appendix } = await knownForExport(meta, questions);
  const lectures = await lecturesForQuiz(meta, questions);
  if (meta.mode === 'review') await rememberResults(meta, withResults ? questions : entries.map((e) => parseQuestion(e.el, { withResults: true })));
  const now = new Date();
  const imagePaths = new Map<string, string>();
  const files: Zippable = {};
  const failed: string[] = [];

  if (opts.zip) {
    // Снимки: вопросы с фото/заданием на изображении и инфо-блоки с картинками (в них часто текст к заданию).
    const photoIdx = questions.map((q, i) => (q.hasPhoto ? i : -1)).filter((i) => i >= 0);
    let done = 0;
    let infoNo = 0;
    await withLightTheme(async () => {
      for (const i of photoIdx) {
        const e = entries[i];
        const q = questions[i];
        stage(60, 95)(`Делаю снимки: ${done + 1} из ${photoIdx.length}`, done, photoIdx.length);
        const path = imageFileName(q.number, q.kind === 'info' ? ++infoNo : 0);
        try {
          files[path] = [await captureQuestion(e.el), { level: 0 }];
          imagePaths.set(q.id, path);
        } catch (err) {
          failed.push(q.kind === 'info' ? 'инфо' : '№' + e.number);
          console.warn('[еКонспект] не удалось сделать снимок вопроса', e.number, err);
        }
        done++;
      }
    });
    disposeRenderContainer();
  }

  const txt = formatDocument(
    {
      meta,
      exportedAt: now,
      rightAnswersShown: collected.rightAnswersShown,
      missingNumbers: collected.missingNumbers,
      attemptSummary: meta.mode === 'review' ? parseAttemptSummary(document) : [],
    },
    questions,
    { withResults, imagePaths, known, appendix, material: lectures.blocks, materialTitles: lectures.titles },
  );

  const title = meta.quizTitle || 'Тест';
  if (opts.zip) {
    const txtName = safeFileName(title, now, 'txt');
    files[txtName] = strToU8(BOM + txt);
    onProgress('Упаковываю архив…', 97, 100);
    const zip = zipSync(files);
    await download(zip, safeFileName(title, now, 'zip'), 'application/zip');
  } else {
    await download(strToU8(BOM + txt), safeFileName(title, now, 'txt'), 'text/plain;charset=utf-8');
  }

  const real = questions.filter((q) => q.kind !== 'info').length;
  const plural = (n: number, one: string, few: string, many: string) => {
    const a = n % 10,
      b = n % 100;
    return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
  };
  const cheers = ['Удачной подготовки', 'Удачи на экзамене', 'Всё получится'];
  let msg = `Готово: ${real} ${plural(real, 'вопрос', 'вопроса', 'вопросов')}`;
  if (lectures.blocks.length) msg += ` + ${lectures.blocks.length} ${plural(lectures.blocks.length, 'лекция', 'лекции', 'лекций')} темы`;
  if (opts.zip) msg += imagePaths.size ? `, ${imagePaths.size} ${plural(imagePaths.size, 'снимок', 'снимка', 'снимков')}` : ', снимков нет';
  if (failed.length) msg += `. Без снимка: ${failed.join(', ')} — сделайте скриншот вручную`;
  if (collected.missingNumbers.length) msg += `. Не собраны: ${collected.missingNumbers.map((n) => '№' + n).join(', ')}`;
  else if (!failed.length) msg += `. ${cheers[now.getSeconds() % cheers.length]}`;
  return msg;
}

export async function download(data: Uint8Array, filename: string, mime: string): Promise<void> {
  if (TARGET === 'firefox') {
    // В Firefox blob-ссылки content-скрипта страница скачать не может — отдаём фоновому скрипту.
    const msg: DownloadMessage = { type: 'download', filename, mime, data };
    const res = (await ext.runtime.sendMessage(msg)) as { ok: boolean; error?: string } | undefined;
    if (!res?.ok) throw new Error(res?.error || 'Не удалось сохранить файл.');
    return;
  }
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.setAttribute('data-ecx', '');
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 30000);
}
