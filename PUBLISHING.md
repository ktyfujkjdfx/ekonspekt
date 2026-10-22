# Публикация: что сделать руками

Всё техническое готово: `npm run release` собирает и проверяет архивы (`release/`). Ниже — шаги, для которых нужны ваши аккаунты. Репозиторий: https://github.com/ktyfujkjdfx/ekonspekt.

## 1. GitHub: репозиторий и безопасность
1. Включите двухфакторную защиту аккаунта: https://github.com/settings/security
2. Создайте репозиторий `ekonspekt` (можно сразу публичным): https://github.com/new — **без** README и .gitignore (они уже есть).
3. Первый коммит и отправка (из папки проекта):
   ```bash
   git add -A
   git status            # убедитесь, что нет _files/, new LECTURES/, proverka/, dist/, release/
   git commit -m "еКонспект 1.0.0"
   git branch -M main
   git remote add origin https://github.com/ktyfujkjdfx/ekonspekt.git
   git push -u origin main
   ```
4. Settings репозитория:
   - **Code security** → включить Dependabot alerts и security updates, Secret scanning и **Push protection**, **Private vulnerability reporting**.
   - **Branches** → Add rule для `main`: Require a pull request before merging, Require status checks to pass (`Типы, линт, тесты, сборки, архивы`, `Поиск секретов (gitleaks)`), Do not allow bypassing.
   - **Pages** → Source: Deploy from a branch → `main` / `/docs`. Через минуту политика будет по адресу `https://ktyfujkjdfx.github.io/ekonspekt/privacy.html` — эту ссылку указываете в магазинах.
   - **Actions → General** → Workflow permissions: Read repository contents (по умолчанию «только чтение»; релизу права выдаются в самом workflow).

## 2. GitHub Release с архивами (для друзей)
1. Создайте тег и отправьте его: `git tag v1.0.0 && git push origin v1.0.0`.
2. Workflow «Release» сам проверит проект, соберёт архивы, контрольные суммы и создаст **черновик** релиза: https://github.com/ktyfujkjdfx/ekonspekt/releases
3. (Firefox) Добавьте в черновик подписанный `.xpi` из шага 3, затем нажмите **Publish release**.
4. Ссылку на релиз и [INSTALL.md](INSTALL.md) можно отправлять друзьям.

## 3. Firefox: подписанная версия для друзей сегодня (unlisted)
1. Войдите на https://addons.mozilla.org/developers/ (аккаунт Firefox, двухфакторная защита обязательна).
2. **Submit a New Add-on** → **On your own** (самостоятельное распространение).
3. Загрузите `release/ekonspekt-firefox-1.0.0.zip`; на вопрос об исходниках — да, приложите `release/ekonspekt-source-1.0.0.zip`; в «Notes to reviewer» — текст из `STORE.md`.
4. Автоматическая проверка занимает минуты; затем скачайте подписанный `.xpi` и приложите к GitHub Release.
   (То же из командной строки: ключи на https://addons.mozilla.org/developers/addon/api/key/ и `npx web-ext sign -s dist/firefox --channel unlisted --api-key ... --api-secret ...`.)
5. Публичная версия в каталоге AMO: Submit a New Add-on → **On this site**, те же файлы, тексты и картинки из `STORE.md` и `store/`.

## 4. Chrome Web Store
1. Регистрация разработчика ($5 один раз): https://chrome.google.com/webstore/devconsole — включите двухфакторную защиту Google-аккаунта.
2. **New item** → `release/ekonspekt-chrome-1.0.0.zip`.
3. **Store listing**: название и описания из `STORE.md` (RU основной, EN — добавьте язык English), категория Education, иконка `store/icon-128.png`, скриншоты `store/01…04*.png`, плитка `store/promo-440x280.png`, баннер `store/marquee-1400x560.png`.
4. **Privacy**: single purpose, обоснования разрешений, «не собираем данные», три подтверждения, ссылка на политику — всё в `STORE.md`.
5. **Distribution**: сначала Visibility = **Unlisted** (доступ по ссылке), после отзывов друзей — Public. Яндекс.Браузер и Opera устанавливают расширения из Chrome Web Store.

## 5. Microsoft Edge Add-ons
1. Регистрация (бесплатно): https://partner.microsoft.com/dashboard/microsoftedge/overview
2. **Create new extension** → тот же `release/ekonspekt-chrome-1.0.0.zip`.
3. Properties: категория Education, ссылка на политику; Store listings: тексты и картинки из `STORE.md`/`store/`.
4. Отправка на проверку (обычно до 7 рабочих дней).

## 6. Новая версия
Жалоба → `npm run sanitize-fixture` → тест → исправление → `npm version patch` → `git push && git push --tags` → черновик релиза → загрузка тех же архивов в магазины.
