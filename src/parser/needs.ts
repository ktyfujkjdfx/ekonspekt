import type { Media } from './text';

/**
 * Что нужно для ответа, но в текст не попадает: видео, аудио, урок/лекция, текст, изображение.
 * Без этого и человек, и нейросеть будут угадывать — поэтому в выгрузке такой вопрос помечается
 * строкой «! Нужен материал: …» с просьбой не угадывать.
 */
export type NeedKind = 'video' | 'audio' | 'media' | 'lesson' | 'text' | 'image';

export interface Need {
  kind: NeedKind;
  /** Что именно: имя файла, «Lesson 2», «текст». */
  label: string;
}

const LESSON_EN = /\b(lesson|unit|lecture|module|chapter|section|topic|workbook|e-workbook|student'?s book|textbook)\s*(?:№\s*)?(\d+(?:\.\d+)*[a-z]?)?\b/i;
const LESSON_RU =
  /(?:^|[^а-яё])(урок[аеуи]?|лекци[ияей]|тем[аеыу]|параграф[аеу]?|модул[ьяею]|раздел[аеу]?|учебник[аеу]?|практическ\S*\s+работ\S*|лабораторн\S*\s+работ\S*)\s*(?:№\s*)?(\d+(?:\.\d+)*)?/i;
/** Отсылка к уроку должна идти после «из/в/по/from/in/of/see/according to» — иначе это просто слово. */
const LESSON_CONTEXT = /\b(from|in|of|see|use|using|according to|covered in|studied in)\b|(?:^|[^а-яё])(из|в|во|по|см\.?|согласно|изученн\S*|пройденн\S*)\s*$/i;

/** Видео: только явное задание («Watch the video», «in the video», «посмотрите видео»), а не любое слово «video». */
const VIDEO =
  /\b(?:watch(?:ing)?\s+(?:the|this|a|these)\s+(?:video|clip|film|recording|fragment)s?|watch\s+and\s|(?:in|from|on)\s+the\s+(?:video|clip|film)\b|the\s+(?:video|clip)\s+(?:above|below))|(?:^|[^а-яё])(?:посмотрите\s+(?:видео|ролик|фильм|фрагмент)|(?:в|из|по)\s+(?:видео|ролик\S*|фильм\S*)(?:[^а-яё]|$)|видеозапис\S*)/i;
/** Аудио: «Listen to the recording», «Listen and…», «прослушайте»; «listen to music» — не задание. */
const AUDIO =
  /\b(?:listen(?:ing)?\s+(?:to\s+)?(?:the|this|a)\s+(?:recording|audio|dialogue|podcast|conversation|interview|track|text|lecture|story|biography|speaker)|listen\s+(?:and|again)\b|(?:in|from)\s+the\s+(?:recording|audio|podcast)\b)|(?:^|[^а-яё])(?:прослушай\S*|послушай\S*|аудиозапис\S*|(?:в|из|по)\s+аудио)/i;
/** Мнение спикера/лектора — значит, есть запись выступления. */
const SPEAKER = /\b(?:according to the speaker|the speaker[’']?s? (?:opinion|words|view))\b|по мнению (?:спикера|лектора|говорящего)/i;
const TEXT =
  /\b(?:according to the (?:text|author|article|passage|story)|(?:from|in) the (?:text|article|passage|story) (?:above|below)|read the text)\b|(?:^|[^а-яё])(?:по тексту|из текста|согласно тексту|по мнению автора|прочитайте текст|в тексте (?:выше|ниже))/i;

function nominative(word: string): string {
  const w = word.toLowerCase();
  const map: [RegExp, string][] = [
    [/^урок/, 'урок'],
    [/^лекци/, 'лекция'],
    [/^тем/, 'тема'],
    [/^параграф/, 'параграф'],
    [/^модул/, 'модуль'],
    [/^раздел/, 'раздел'],
    [/^учебник/, 'учебник'],
    [/^практическ/, 'практическая работа'],
    [/^лабораторн/, 'лабораторная работа'],
  ];
  for (const [re, nom] of map) if (re.test(w)) return nom;
  return word;
}

function lessonLabel(text: string): string | null {
  for (const re of [LESSON_EN, LESSON_RU]) {
    const g = new RegExp(re.source, 'gi');
    for (let m = g.exec(text); m; m = g.exec(text)) {
      const before = text.slice(Math.max(0, m.index - 24), m.index + (m[0].match(/^[^а-яёa-z]*/i)?.[0].length ?? 0));
      // «Lesson 2» с номером — всегда отсылка; без номера — только урок/лекция/учебник после «from/из/по…».
      const strongWord = /^(lesson|lecture|textbook|workbook|e-workbook|student|урок|лекци|учебник)/i.test(m[1]);
      if (m[2] || (strongWord && LESSON_CONTEXT.test(before.trimEnd()))) {
        const word = nominative(m[1]);
        return (m[2] ? `${word.charAt(0).toUpperCase()}${word.slice(1)} ${m[2]}` : word).replace(/\s+/g, ' ');
      }
    }
  }
  return null;
}

export function detectNeeds(text: string, media: Media[], hasPhoto: boolean, needsScreenshot: boolean): Need[] {
  const needs: Need[] = [];
  const add = (n: Need) => {
    if (!needs.some((x) => x.kind === n.kind && x.label === n.label)) needs.push(n);
  };

  for (const m of media) {
    const kind: NeedKind = m.kind === 'audio' ? 'audio' : m.kind === 'video' || m.kind === 'youtube' || m.kind === 'vimeo' ? 'video' : 'media';
    add({
      kind,
      label:
        m.kind === 'widget'
          ? `внешнее задание (${m.title})`
          : m.kind === 'h5p'
            ? `интерактивное задание «${m.title}»`
            : m.title.replace(/\.(mp4|webm|mov|m4v|mp3|m4a|ogg|wav|oga)$/i, ''),
    });
  }
  // Текст с плейсхолдерами медиа уже учтён выше — ищем отсылки в самих формулировках.
  const plain = text.replace(/\[(?:аудио|видео|видео YouTube|видео Vimeo|встроенная страница|внешнее задание|интерактивное задание):[^\]]*\]/g, ' ');
  const lesson = lessonLabel(plain);
  if (lesson) add({ kind: 'lesson', label: lesson });
  if (!needs.some((n) => n.kind === 'video') && VIDEO.test(plain)) {
    const link = plain.match(/https?:\/\/(?:www\.)?(?:youtu\.be|youtube\.com|vimeo\.com|rutube\.ru|vk\.com\/video)\S*/i)?.[0].replace(/[.,;)]+$/, '');
    add({ kind: 'video', label: link ?? 'видео к заданию' });
  }
  if (!needs.some((n) => n.kind === 'audio') && AUDIO.test(plain)) add({ kind: 'audio', label: 'аудио к заданию' });
  if (!needs.some((n) => n.kind === 'video' || n.kind === 'audio') && SPEAKER.test(plain)) add({ kind: 'audio', label: 'запись выступления' });
  // Отсылка к тексту важна, только если самого текста в вопросе нет (короткая формулировка).
  if (plain.length < 600 && TEXT.test(plain) && !needs.some((n) => n.kind === 'video' || n.kind === 'audio')) add({ kind: 'text', label: 'текст к заданию' });
  if (needsScreenshot || hasPhoto) add({ kind: 'image', label: 'изображение' });
  return needs;
}
