import type { Gap, Question } from '../parser/types';

/**
 * Тесты «вставьте пропущенное слово» часто собраны из одного учебного текста: фраза с пропуском в одном
 * вопросе стоит целиком в тексте другого. Находим такие места и показываем цитату, если в ней стоит
 * один из вариантов ответа. Это текст самого теста, а не догадка расширения.
 */

/** Текст в нижнем регистре без мягких переносов, ё→е, пробелы схлопнуты; map — индекс в исходной строке. */
interface Norm {
  s: string;
  map: number[];
}

function normalize(src: string): Norm {
  let s = '';
  const map: number[] = [];
  let space = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '­' || ch === '​') continue;
    if (/\s/.test(ch)) {
      if (!space && s) {
        s += ' ';
        map.push(i);
      }
      space = true;
      continue;
    }
    space = false;
    s += ch.toLowerCase().replace('ё', 'е');
    map.push(i);
  }
  return { s, map };
}

const GAP_MARK = /\s*(?:\.{2,}|…)\s*/;
const MIN_CONTEXT = 20;
const QUOTE_BEFORE = 45;
const QUOTE_AFTER = 30;

const cleanOption = (o: string) =>
  normalize(o)
    .s.replace(/^[«"“„(]+|[.,;:!?»"”)]+$/g, '')
    .trim();

interface Source {
  number: string;
  raw: string;
  norm: Norm;
}

function sourcesOf(q: Question): string[] {
  return [q.text, ...q.gaps.map((g) => g.label), ...q.choices.map((c) => c.text)].filter(Boolean);
}

/** Контекст вокруг пропуска: текст строки соответствия или текст вопроса вокруг «[N]». */
function contextOf(q: Question, g: Gap): { left: string; right: string } | null {
  if (/^\[\d+\]$/.test(g.label)) {
    const at = q.text.indexOf(g.label);
    if (at < 0) return null;
    return { left: q.text.slice(0, at), right: q.text.slice(at + g.label.length) };
  }
  const m = GAP_MARK.exec(g.label);
  if (!m) return { left: g.label, right: '' };
  return { left: g.label.slice(0, m.index), right: g.label.slice(m.index + m[0].length) };
}

const MAX_WORDS = 10;

/** Хвосты (или начала) контекста от длинного к короткому: склейка в начале фразы не мешает найти её конец. */
function pieces(s: string, fromEnd: boolean): string[] {
  const words = normalize(s.replace(/\[\d+\]|\.{2,}|…/g, ' '))
    .s.trim()
    .split(' ')
    .filter(Boolean);
  const out: string[] = [];
  for (let n = Math.min(MAX_WORDS, words.length); n > 0; n--) {
    const p = (fromEnd ? words.slice(-n) : words.slice(0, n)).join(' ');
    if (p.length < MIN_CONTEXT) break;
    out.push(p);
  }
  return out;
}

function quote(src: Source, from: number, to: number): string {
  const a = src.norm.map[Math.max(0, from)];
  const b = src.norm.map[Math.min(src.norm.map.length - 1, to - 1)] + 1;
  let start = Math.max(0, a - QUOTE_BEFORE);
  let end = Math.min(src.raw.length, b + QUOTE_AFTER);
  if (start > 0) start = src.raw.indexOf(' ', start) + 1 || a;
  if (end < src.raw.length) end = src.raw.lastIndexOf(' ', end) > b ? src.raw.lastIndexOf(' ', end) : end;
  const body = src.raw.slice(start, end).replace(/­/g, '').replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${body}${end < src.raw.length ? '…' : ''}`;
}

/** Ищем «левый контекст + вариант» или «вариант + правый контекст» в тексте других вопросов. */
function findIn(src: Source, left: string, right: string, options: string[]): { option: string; quote: string } | null {
  const s = src.norm.s;
  for (const l of pieces(left, true)) {
    for (let at = s.indexOf(l); at >= 0; at = s.indexOf(l, at + 1)) {
      const after = s.slice(at + l.length).replace(/^[\s.,:;—–-]+/, '');
      const gapStart = s.length - after.length;
      for (const o of options) {
        if (after.startsWith(o) && !/[\p{L}\p{N}]/u.test(after.charAt(o.length))) return { option: o, quote: quote(src, at, gapStart + o.length) };
      }
    }
  }
  for (const r of pieces(right, false)) {
    for (let at = s.indexOf(r); at >= 0; at = s.indexOf(r, at + 1)) {
      const before = s.slice(0, at).replace(/[\s.,:;—–-]+$/, '');
      for (const o of options) {
        if (before.endsWith(o) && !/[\p{L}\p{N}]/u.test(before.charAt(before.length - o.length - 1)))
          return { option: o, quote: quote(src, before.length - o.length, at + r.length) };
      }
    }
  }
  return null;
}

/** Gap → «в вопросе 29: «…цитата…»». Только если все найденные места указывают на один вариант. */
export function crossReferences(questions: Question[]): Map<Gap, string> {
  const out = new Map<Gap, string>();
  const all = questions.filter((q) => q.kind !== 'info');
  const pool = all.map((q) => ({ q, sources: sourcesOf(q).map((raw) => ({ number: q.number, raw, norm: normalize(raw) })) }));

  for (const q of all) {
    for (const g of q.gaps) {
      if (!g.options.length || g.label === 'Единицы' || g.label === 'Порядок') continue;
      const ctx = contextOf(q, g);
      if (!ctx) continue;
      const options = [...new Set(g.options.map(cleanOption).filter((o) => o.length >= 2))].sort((a, b) => b.length - a.length);
      const hits: { number: string; option: string; quote: string }[] = [];
      for (const p of pool) {
        if (p.q === q) continue;
        for (const src of p.sources) {
          const hit = findIn(src, ctx.left, ctx.right, options);
          if (hit) {
            hits.push({ number: src.number, ...hit });
            break;
          }
        }
      }
      if (!hits.length || new Set(hits.map((h) => h.option)).size > 1) continue;
      out.set(g, `в вопросе ${hits[0].number}: «${hits[0].quote}»`);
    }
  }
  return out;
}
