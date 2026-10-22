import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

export function loadFixture(name: string, url = 'https://e.sfu-kras.ru/mod/quiz/attempt.php?attempt=1&cmid=1'): Document {
  const html = readFileSync(resolve(process.cwd(), 'test/fixtures', name), 'utf8');
  return new JSDOM(html, { url }).window.document;
}
