// Отладка: прогнать парсер и форматтер по сохранённой странице и вывести TXT.
// Использование: npm run dump -- <файл.html> [--results] [--url <url>]
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { hasRightAnswers, parsePageMeta, parseQuestions, parseAttemptSummary } from '../src/parser/page';
import { formatDocument } from '../src/format/txt';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'))!;
const withResults = args.includes('--results');
const urlIdx = args.indexOf('--url');
const html = readFileSync(file, 'utf8');
const canonical =
  html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ??
  html.match(/https:\/\/e\.sfu-kras\.ru\/mod\/quiz\/(?:review|attempt)\.php\?attempt=\d+(?:&amp;cmid=\d+)?/)?.[0]?.replace(/&amp;/g, '&');
const url = urlIdx >= 0 ? args[urlIdx + 1] : (canonical ?? 'https://e.sfu-kras.ru/mod/quiz/review.php');
const doc = new JSDOM(html, { url }).window.document;
const meta = parsePageMeta(doc, url);
const qs = parseQuestions(doc, { withResults });
process.stdout.write(
  formatDocument({ meta, exportedAt: new Date(), rightAnswersShown: hasRightAnswers(doc), attemptSummary: parseAttemptSummary(doc) }, qs, {
    withResults,
  }).replace(/\r\n/g, '\n'),
);
