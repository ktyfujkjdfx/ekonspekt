# Тексты и ответы для магазинов / Store listing

Пакеты (после `npm run release`):
- `release/ekonspekt-chrome-1.0.0.zip` — Chrome Web Store, Microsoft Edge Add-ons, Opera Add-ons;
- `release/ekonspekt-firefox-1.0.0.zip` — Firefox Add-ons (AMO) + `release/ekonspekt-source-1.0.0.zip` (исходники для ревьюера).

Изображения (`npm run store-assets`, только демо-данные):
| Файл | Размер | Куда |
|---|---|---|
| `store/icon-128.png` | 128×128 | иконка карточки (Chrome, Edge, AMO) |
| `store/01-copy-button.png`, `02-txt-export.png`, `03-media-notes.png`, `04-dark.png` | 1280×800 | скриншоты (Chrome — до 5, Edge — до 10, AMO) |
| `store/promo-440x280.png` | 440×280 | малая промо-плитка Chrome; Edge — небольшая плитка |
| `store/marquee-1400x560.png` | 1400×560 | большая плитка Chrome (необязательна) |

Ссылка на политику конфиденциальности: `https://ktyfujkjdfx.github.io/ekonspekt/privacy.html` (GitHub Pages из папки `docs/`).
Почта поддержки: **achiimindkit@gmail.com**. Язык интерфейса: русский. Категория: Chrome — «Образование» (Education); Edge — «Education»; AMO — «Other» (или «Download Management»).

> Правило для публичных текстов: без названия вуза и сайта («еКурсы»), без обещаний «для списывания». Позиционирование — подготовка к экзаменам и повторение. Домен сайта — только в разрешениях и их обосновании.

---

## Русский

**Название (≤ 45):** еКонспект — вопросы теста в один файл

**Краткое описание (≤ 132):** Вопросы тестов электронных курсов — в один файл за клик. Для повторения и подготовки к экзаменам; удобно работать с нейросетями.

**Полное описание:**

еКонспект помогает готовиться к экзаменам по тестам электронных курсов на платформе Moodle: вопросы пройденных тестов не теряются, и по ним удобно повторять материал — самому или вместе с нейросетью.

Возможности
• Кнопка «Копировать» у каждого вопроса: текст, варианты ответа и тип вопроса сразу попадают в буфер обмена.
• «С картинкой» у вопросов с изображением: одна картинка с текстом вопроса, вариантами и рисунком — её одинаково вставляют ChatGPT, Claude, Gemini, Qwen и Word.
• Весь тест одним файлом — в том же порядке и с теми же номерами, что на сайте. По желанию — архив со снимками вопросов с фото и схемами.
• После завершения теста — ваши ответы, «верно / неверно», баллы и правильные ответы, если преподаватель их открыл.
• Знак «!» у вопросов, для ответа на которые нужен материал вне файла (видео, аудио, изображение): такие ответы не угадывают, а сверяют с материалом — это понятно и человеку, и нейросети.
• Ответы, уже подтверждённые сайтом в прошлых попытках, подставляются к тем же вопросам.
• Светлая и тёмная тема, спокойное оформление, которое не мешает работе с тестом.

Принципы
• Расширение только читает страницы, которые вы открыли. Оно не отвечает на вопросы и ничего не отправляет от вашего имени.
• Все данные остаются в браузере: нет сторонних серверов, аналитики и рекламы.
• Поддержка — кнопкой в окне расширения: откроется готовое письмо разработчику.

Расширение независимое и не связано с владельцами сайта электронных курсов.

---

## English

**Name (≤ 45):** eKonspekt — quiz questions in one file

**Summary (≤ 132):** Save e-course quiz questions to one tidy file in a click — for revision and exam prep, ready for AI assistants.

**Description:**

eKonspekt helps students prepare for exams on a Moodle-based e-learning site: questions from quizzes you have taken are kept in one tidy file for revision — on your own or together with an AI assistant. The interface is in Russian.

Features
• "Copy" button next to every question: question text, answer options and question type go straight to the clipboard.
• "With picture" for questions with images: one image with the question text, options and the picture — pastes the same way into ChatGPT, Claude, Gemini, Qwen and Word.
• The whole quiz in one file, in the same order and numbering as on the site; optionally a ZIP with snapshots of questions that contain photos or diagrams.
• After a quiz is finished: your answers, correct / incorrect marks, points and the right answers if the teacher shows them.
• A "!" mark on questions that need material outside the file (video, audio, image), so neither you nor an AI guesses the answer.
• Answers already confirmed by the site in previous attempts are added to the same questions.
• Light and dark themes, calm design that stays out of the way.

Principles
• The extension only reads pages you opened. It never answers questions or submits anything on your behalf.
• All data stays in your browser: no third-party servers, analytics or ads.
• Support: a button in the popup opens a ready-made e-mail to the developer.

This extension is independent and not affiliated with the owners of the e-learning site.

---

## Единственная цель / Single purpose (Chrome, Edge)
RU: Копирование и выгрузка вопросов тестов электронных курсов (Moodle) в файл для повторения и подготовки к экзаменам.
EN: Copy and export quiz questions from a Moodle e-learning site to a file for revision and exam preparation.

## Обоснование разрешений / Permission justification
| Разрешение | RU | EN |
|---|---|---|
| `storage` | Локально хранит настройки, текст вопросов текущей попытки (чтобы собрать полный тест, пока пользователь листает страницы; записи старше 30 дней удаляются), текст открытых учебных страниц курса для выгрузки и отметки «верно / неверно» из просмотренных результатов. Ничего не передаётся. | Stores locally: settings, question text of the current attempt (to assemble the full quiz while the user pages through it; entries older than 30 days are removed), text of course pages the user opened (for export), and correct/incorrect marks from viewed results. Nothing is transmitted. |
| Host `https://e.sfu-kras.ru/*` | Единственный сайт, где работает расширение: кнопки у вопросов на страницах тестов и учебных страницах курса, чтение других страниц того же теста или курса (GET) для полной выгрузки и рисунков для архива. Ответы и формы не отправляются. | The only site the extension works on: buttons next to questions on quiz and course pages, read-only (GET) loading of other pages of the same quiz or course for a complete export, and images for the ZIP. No answers or forms are ever submitted. |
| `downloads` (только Firefox) | Сохранение готового файла в папку загрузок. | Saving the generated file to the downloads folder. |
| Удалённый код / Remote code | Не используется: весь код в пакете, шрифты и иконки локальные. | None: all code is in the package; fonts and icons are local. |

## Конфиденциальность / Privacy practices (Chrome «Privacy» tab, Edge)
- Собираемые данные / Data collected: **нет / none** — не отмечаем ни одной категории. Данные со страниц обрабатываются и хранятся только локально; разработчику ничего не передаётся.
- Подтверждения: данные не продаются третьим лицам; не используются и не передаются для целей, не связанных с единственной целью; не используются для оценки кредитоспособности.
- Политика конфиденциальности: `https://ktyfujkjdfx.github.io/ekonspekt/privacy.html`.

## Firefox AMO
- `data_collection_permissions`: `none` (уже в манифесте).
- Notes to reviewer (EN): *Source code attached (ekonspekt-source-1.0.0.zip). Build: `npm ci && npm run build:firefox` with Node 24 / npm 11 — see BUILD-AMO.txt. Bundled with esbuild, not minified, no source maps, no remote code. Third-party: html-to-image 1.11.13 (question snapshots), fflate 0.8.3 (ZIP); a build-time patch replaces the only innerHTML in html-to-image with textContent. Network: only read-only GET requests to e.sfu-kras.ru; all other URLs are blocked in code. To test without an account, run `npm run e2e:firefox` on the anonymized fixtures in test/fixtures.*
- Версия для друзей до публикации: «On your own» (unlisted) — см. PUBLISHING.md.
