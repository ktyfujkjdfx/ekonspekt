import type { PageMode } from '../parser/types';
import type { ViewPageInfo } from '../parser/page';

export interface TypeCounts {
  single: number;
  multi: number;
  match: number;
  other: number;
  photo: number;
  /** Вопросы и инфо-блоки с аудио/видео/виджетами. */
  media: number;
  /** Из чего состоят «Другие типы»: [название, количество]. */
  others: [string, number][];
}

export interface QuizStatus {
  mode: PageMode;
  quizTitle: string;
  course: string;
  /** Сколько вопросов уже известно (на странице / накоплено). */
  found: number;
  /** Всего вопросов в тесте по навигации. */
  total: number;
  counts: TypeCounts;
  missingNumbers: string[];
  /** В review всё соберётся автоматически при выгрузке. */
  willCollectAll: boolean;
  freeNavigation: boolean;
  rightAnswersShown: boolean;
  /** Сколько лекций темы уже собрано — они уйдут в файл теста как материал. */
  lectures: number;
  busy: boolean;
}

/** Лекция (mod/lesson): что уже собрано по мере чтения. */
export interface LessonStatus {
  title: string;
  course: string;
  /** Страниц в конспекте (текст + вопросы). */
  pages: number;
  content: number;
  questions: number;
  images: number;
  media: number;
  /** Страниц в меню лекции, если оно есть (иначе null). */
  menuTotal: number | null;
  progress: number | null;
  finished: boolean;
  /** Вопросов с вашим ответом. */
  answers: number;
  /** Порядок части страниц — догадка по id (студент открывал не все сам). */
  approxOrder: boolean;
  busy: boolean;
}

export type Request =
  { type: 'status' } | { type: 'export'; zip: boolean; includeResults: boolean } | { type: 'collectAttemptPages' } | { type: 'collectLesson' };

export type Response = { ok: true; status?: QuizStatus; lesson?: LessonStatus; view?: ViewPageInfo; message?: string } | { ok: false; error: string };

/** Сообщение о прогрессе (content → popup). */
export interface ProgressMessage {
  type: 'progress';
  text: string;
  done?: number;
  total?: number;
  finished?: boolean;
  error?: string;
}

/** Firefox: content → background, скачать файл через downloads API. */
export interface DownloadMessage {
  type: 'download';
  filename: string;
  mime: string;
  data: Uint8Array;
}

/** popup/content → background: тема браузера (для иконки на панели в Chromium). */
export interface ThemeMessage {
  type: 'theme';
  dark: boolean;
}
