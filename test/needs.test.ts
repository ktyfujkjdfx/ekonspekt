import { describe, expect, it } from 'vitest';
import { detectNeeds } from '../src/parser/needs';

const kinds = (t: string) => detectNeeds(t, [], false, false).map((n) => `${n.kind}:${n.label}`);

describe('вопросы, которым нужен внешний материал', () => {
  it('ссылка на урок (случай из жизни: нейросеть выдумала ответы)', () => {
    expect(kinds('Task 1. Fill in the blanks using the appropriate vocabulary items from Lesson 2.')).toEqual(['lesson:Lesson 2']);
    expect(kinds('Вставьте слова из урока 5')).toEqual(['lesson:Урок 5']);
    expect(kinds('Используйте определения из лекции')).toEqual(['lesson:лекция']);
    expect(kinds('Ответьте по материалам Unit 3.')).toEqual(['lesson:Unit 3']);
  });

  it('видео и аудио в формулировке', () => {
    expect(kinds('Watch the video. Fill in the gaps according to the speaker’s opinion.')).toEqual(['video:видео к заданию']);
    expect(kinds('Fill in the gaps according to the speaker’s opinion.')).toEqual(['audio:запись выступления']);
    expect(kinds('Listen and fill in the gaps.')).toEqual(['audio:аудио к заданию']);
    expect(kinds('Listen to the recording and choose the correct answer.')).toEqual(['audio:аудио к заданию']);
    expect(kinds('Посмотрите видео и ответьте на вопросы')).toEqual(['video:видео к заданию']);
    expect(kinds('7. Watch this video* and fill in the gaps. *https://youtu.be/3icBxO6Wjz0')).toEqual(['video:https://youtu.be/3icBxO6Wjz0']);
  });

  it('текст', () => {
    expect(kinds('According to the text, why did they move?')).toEqual(['text:текст к заданию']);
    expect(kinds('По тексту определите главную мысль')).toEqual(['text:текст к заданию']);
  });

  it('медиа в самом вопросе (имя без расширения)', () => {
    const n = detectNeeds('Fill in the gaps', [{ kind: 'video', title: 'Family values Edward Mungai.mp4', url: null }], false, false);
    expect(n).toEqual([{ kind: 'video', label: 'Family values Edward Mungai' }]);
  });

  it('обычные вопросы не помечаются', () => {
    for (const t of [
      'Регуляция углеродного цикла и потоков парниковых газов относится к категории экосистемных услуг;',
      'Какой принцип ООП позволяет скрыть внутреннее состояние объекта?',
      'Choose the correct form of the verb: She ___ to school every day.',
      'Сопоставьте ОС и разработчика.',
      'Лингвистика, предполагающая построение лингвистических теорий, называется...',
      'Темп роста ВВП в разделе экономики составил...',
      'Do you want to listen to music or _______ TV?',
      'I like watching videos about cooking. Choose the correct form.',
      'Fill in the gaps in the text with an appropriate verb form.',
      'Посмотрите на схему и выберите ответ',
    ])
      expect(kinds(t)).toEqual([]);
  });

  it('изображение', () => {
    expect(detectNeeds('Что на схеме?', [], true, false)).toEqual([{ kind: 'image', label: 'изображение' }]);
  });
});
