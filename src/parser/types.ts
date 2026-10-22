import type { Media } from './text';
import type { Need } from './needs';
export type { Media, MediaKind } from './text';
export type { Need, NeedKind } from './needs';

/** Категория вопроса для пометок и сводки. */
export type QuestionKind = 'single' | 'multi' | 'match' | 'other' | 'info';

export interface Choice {
  /** Буква/номер варианта из Moodle («a», «b», …) или порядковый номер. */
  label: string;
  text: string;
  hasImage: boolean;
  /** Отмечен ли вариант пользователем. */
  checked: boolean;
  /** true — вариант верный (по данным страницы), false — неверный, null — неизвестно. */
  correct: boolean | null;
}

export type GapKind = 'text' | 'select' | 'radio' | 'checkbox' | 'drag' | 'essay';

/**
 * Поле ответа: строка соответствия, пропуск в тексте (Cloze, gapselect, ddwtos),
 * поле «Ответ:» короткого/числового ответа, эссе.
 */
export interface Gap {
  kind: GapKind;
  /** Подпись: текст строки соответствия или «[N]» для пропуска в тексте. */
  label: string;
  /** Варианты на выбор (для select/radio/checkbox/drag). */
  options: string[];
  /** Ответ студента (для checkbox — через «; »). */
  answer: string | null;
  correct: boolean | null;
  /** «Правильный ответ: …» этого поля, если Moodle его показал. */
  rightAnswer: string | null;
}

export interface QuestionResult {
  /** Текст состояния Moodle: «Верно», «Неверно», «Выполнен», «Ответ сохранен»… */
  state: string | null;
  /** «Баллов: 1,00 из 1,00» → «1,00 из 1,00». */
  grade: string | null;
  outcome: 'correct' | 'incorrect' | 'partial' | null;
  /** Текст «Правильный ответ: …» без префикса или null, если на странице не показан. */
  rightAnswer: string | null;
  /** Общий / специфичный отзыв («Ваш ответ верный.»). */
  feedback: string | null;
}

export interface Question {
  /** id DOM-элемента (question-<qubaid>-<slot>), уникален в рамках попытки. */
  id: string;
  /** Номер из шапки Moodle («Вопрос 10» → «10»); для информационных блоков — «i». */
  number: string;
  slot: number | null;
  /** Тип Moodle из классов .que (multichoice, match, …). */
  qtype: string;
  kind: QuestionKind;
  /** Человекочитаемое название типа для «[ДРУГОЙ ТИП: …]». */
  typeName: string | null;
  text: string;
  choices: Choice[];
  gaps: Gap[];
  /** Видимый текст области ответа для неизвестных/прочих типов. */
  otherText: string | null;
  /** Имена прикреплённых файлов (эссе). */
  attachments: string[];
  hasPhoto: boolean;
  /** Аудио/видео/виджеты — текстом не передать. */
  media: Media[];
  /** Смысл вопроса в картинке (перетаскивание на изображение и т.п.) — нужен скриншот. */
  needsScreenshot: boolean;
  /** Что нужно для ответа, но в текст не попало (видео, урок, текст, изображение). */
  needs: Need[];
  result: QuestionResult | null;
}

export type PageMode = 'attempt' | 'review';

export interface NavPage {
  page: number;
  url: string;
  numbers: string[];
}

export interface PageMeta {
  mode: PageMode | null;
  quizTitle: string;
  course: string;
  /** Раздел курса («Тема 9. …»), если есть в навигационной цепочке. */
  section: string;
  sectionId: string | null;
  url: string;
  attemptId: string | null;
  cmid: string | null;
  /** Номер текущей страницы (0-based) или -1 для showall. */
  currentPage: number;
  pages: NavPage[];
  /** Всего вопросов (кнопок навигации, кроме информационных). */
  totalQuestions: number;
  freeNavigation: boolean;
  showAll: boolean;
}

/** Строка сводки попытки на странице просмотра («Баллы» → «73/75»). */
export interface SummaryRow {
  title: string;
  value: string;
}
