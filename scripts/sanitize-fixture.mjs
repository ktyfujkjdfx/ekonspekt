// Обезличивание сохранённой страницы еКурсов для test/fixtures.
// Использование: node scripts/sanitize-fixture.mjs <вход.html> <выход.html> ["Доп. ФИО" ...]
// Убирает: скрипты (кроме math/tex), стили, ФИО (определяется по аватару/меню), id пользователя,
// sesskey, checksum, e-mail, ссылки на аватар. В конце проверяет, что ничего не осталось.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, output, ...extraNames] = process.argv;
if (!input || !output) {
  console.error('node scripts/sanitize-fixture.mjs <вход.html> <выход.html> ["ФИО" ...]');
  process.exit(1);
}
let s = readFileSync(input, 'utf8');

// ФИО: из alt/title аватара и блока #user-picture.
const names = new Set(extraNames);
for (const m of s.matchAll(/class="userpicture"[^>]*?(?:alt|title)="([^"]{5,})"/g)) names.add(m[1]);
for (const m of s.matchAll(/(?:alt|title)="([^"]{5,})"[^>]*class="userpicture"/g)) names.add(m[1]);
for (const m of s.matchAll(/id="user-picture"[\s\S]{0,600}?<div>([^<]{5,})<\/div>/g)) names.add(m[1].trim());
const userIds = new Set();
for (const m of s.matchAll(/"userId":(\d+)/g)) userIds.add(m[1]);
for (const m of s.matchAll(/data-userid="(\d+)"/g)) userIds.add(m[1]);
for (const m of s.matchAll(/\/user\/(?:view|profile)\.php\?id=(\d+)/g)) userIds.add(m[1]);

const sesskeys = new Set();
for (const m of s.matchAll(/sesskey(?:=|":"|" value=")([A-Za-z0-9]{6,})/g)) sesskeys.add(m[1]);

s = s
  // Служебные скрипты Moodle убираем (в них sesskey, userId), скрипты из текста вопроса (виджеты, TeX) оставляем.
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (m) =>
    /math\/tex/.test(m) ||
    (!/sesskey|userId|M\.cfg|require|YUI|M\.util|M\.str|M\.yui|wwwroot|importmap|e\.sfu-kras\.ru/.test(m) && /\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(m))
      ? m
      : '',
  )
  .replace(/<style\b[\s\S]*?<\/style>/gi, '')
  .replace(/<link\b[^>]*>/gi, '')
  .replace(/<!--(?!\[if)[\s\S]*?-->/g, '')
  .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/g, '');

// Навигация курса перечисляет все его материалы и темы (что именно изучает студент) — парсеру она не нужна.
s = s
  .replace(/<nav id="courseindex"[^>]*>[\s\S]*?<\/nav>/g, '<nav id="courseindex" class="courseindex"></nav>')
  .replace(/(<select[^>]*id="jump-to-activity"[^>]*>)[\s\S]*?(<\/select>)/g, '$1<option value="" selected>Перейти на...</option>$2')
  .replace(
    /(<a[^>]+id="(prev|next)-activity-link"[^>]*>)[\s\S]*?(<\/a>)/g,
    (_, open, dir, close) => open + (dir === 'prev' ? 'Предыдущий элемент курса' : 'Следующий элемент курса') + close,
  );

for (const n of names) {
  s = s.split(n).join('Студент Тестовый');
  const parts = n.split(/\s+/);
  for (const p of parts) if (p.length >= 4) s = s.split(p).join('Тестовый');
}
for (const id of userIds) s = s.replace(new RegExp(`(\\D)${id}(\\D)`, 'g'), '$1100001$2');
for (const k of sesskeys) s = s.split(k).join('XXXXXXXXXX');
s = s
  .replace(/(checksum=)[0-9a-f]+/g, '$1XXXX')
  .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, 'user@example.org')
  .replace(/pluginfile\.php\/\d+\/user\/icon\/[^"']*/g, 'pluginfile.php/1/user/icon/f2')
  .replace(/\n\s*\n+/g, '\n');

const leaks = [...names, ...sesskeys].filter((x) => s.includes(x));
if (leaks.length) {
  console.error('Остались личные данные:', leaks);
  process.exit(2);
}
writeFileSync(output, s);
console.log(`${output}: ${s.length} байт; заменено ФИО: ${[...names].join(', ') || '—'}; id: ${[...userIds].join(', ') || '—'}`);
