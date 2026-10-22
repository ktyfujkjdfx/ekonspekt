// Проверка готовых архивов перед загрузкой в магазины: распаковываем каждый zip и смотрим, что внутри.
// Запускается в конце `npm run release`; при любой проблеме — код выхода 1 и список нарушений.
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { unzipSync } from 'fflate';

const ROOT = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const v = pkg.version;
const problems = [];
const fail = (zip, msg) => problems.push(`${zip}: ${msg}`);
const text = (bytes) => new TextDecoder().decode(bytes);

// Признаки личных данных и машины разработчика — не должно быть ни в одном архиве.
const PERSONAL = [
  [/sesskey(?:=|":"|" value=")(?!X{10})[A-Za-z0-9]{10}/, 'ключ сессии Moodle'],
  [/MoodleSession=[A-Za-z0-9]{10,}/, 'cookie Moodle'],
  [/[A-Z]:\\{1,2}(Users|Projects)\\/i, 'путь Windows с машины разработчика'],
  [/\/(home|Users)\/[a-z0-9_-]+\//i, 'путь Unix с машины разработчика'],
  [/sourceMappingURL/, 'ссылка на source map'],
];
// ФИО, логины, почты разработчика — в локальном файле (в git не попадает, см. .gitignore), по строке-регулярке.
try {
  for (const line of readFileSync(join(ROOT, 'scripts', 'personal-markers.local.txt'), 'utf8').split(/\r?\n/)) {
    if (line.trim() && !line.startsWith('#')) PERSONAL.unshift([new RegExp(line.trim(), 'i'), 'личные данные разработчика']);
  }
} catch {
  console.log('(нет scripts/personal-markers.local.txt — проверка ФИО пропущена)');
}
/** Адреса, которые вправе встречаться в коде расширения. */
const ALLOWED_HOSTS = new Set(['e.sfu-kras.ru', 'www.w3.org', 'mail.google.com', 'mail.yandex.ru', 'e.mail.ru']);

function checkExtension(target) {
  const zip = `ekonspekt-${target}-${v}.zip`;
  const path = join(ROOT, 'release', zip);
  let files;
  try {
    files = unzipSync(readFileSync(path));
  } catch {
    fail(zip, 'архив не найден или повреждён');
    return;
  }
  const names = Object.keys(files);
  const allowed =
    /^(manifest\.json|content\.js|popup\.js|background\.js|popup\.html|popup\.css|THIRD_PARTY_NOTICES\.txt|icons\/.+\.(png|svg)|fonts\/.+\.(woff2|txt)|_locales\/(ru|en)\/messages\.json)$/;
  for (const n of names) if (!allowed.test(n)) fail(zip, `лишний файл в архиве: ${n}`);
  for (const must of [
    'manifest.json',
    'content.js',
    'popup.js',
    'background.js',
    'popup.html',
    'THIRD_PARTY_NOTICES.txt',
    '_locales/ru/messages.json',
    '_locales/en/messages.json',
  ])
    if (!files[must]) fail(zip, `нет обязательного файла ${must}`);

  const m = JSON.parse(text(files['manifest.json']));
  if (m.manifest_version !== 3) fail(zip, 'manifest_version не 3');
  if (m.version !== v) fail(zip, `версия в манифесте ${m.version} ≠ ${v}`);
  for (const s of ['16', '32', '48', '128']) if (!files[m.icons?.[s]]) fail(zip, `нет иконки ${s}px (${m.icons?.[s]})`);
  const hosts = m.host_permissions ?? [];
  if (JSON.stringify(hosts) !== JSON.stringify(['https://e.sfu-kras.ru/*'])) fail(zip, `host_permissions шире нужного: ${JSON.stringify(hosts)}`);
  const matches = (m.content_scripts ?? []).flatMap((c) => c.matches);
  if (!matches.every((x) => x.startsWith('https://e.sfu-kras.ru/mod/'))) fail(zip, `content_scripts.matches шире нужного: ${matches.join(', ')}`);
  if (m.web_accessible_resources) fail(zip, 'объявлены web_accessible_resources');
  if (m.externally_connectable) fail(zip, 'объявлен externally_connectable');
  const csp = m.content_security_policy?.extension_pages ?? '';
  if (!/script-src 'self'/.test(csp) || /unsafe-(inline|eval)/.test(csp)) fail(zip, `CSP не строгая: ${csp}`);
  const perms = new Set(m.permissions ?? []);
  const expected = target === 'firefox' ? ['storage', 'downloads'] : ['storage'];
  if (perms.size !== expected.length || !expected.every((p) => perms.has(p)))
    fail(zip, `разрешения: ${[...perms].join(', ')} (ожидались ${expected.join(', ')})`);
  if (target === 'firefox' && !m.browser_specific_settings?.gecko?.id) fail(zip, 'нет gecko.id');
  for (const loc of ['ru', 'en']) {
    const msgs = JSON.parse(text(files[`_locales/${loc}/messages.json`]));
    if (msgs.extName.message.length > 45) fail(zip, `название (${loc}) длиннее 45 символов`);
    if (msgs.extDescription.message.length > 132) fail(zip, `описание (${loc}) длиннее 132 символов`);
  }

  for (const [n, bytes] of Object.entries(files)) {
    if (!/\.(js|json|html|css|txt|svg)$/.test(n)) continue;
    const t = text(bytes);
    for (const [re, what] of PERSONAL) if (re.test(t)) fail(zip, `${n}: найдено — ${what}`);
    if (/\.js$/.test(n)) {
      if (/ecxE2E/.test(t)) fail(zip, `${n}: тестовый крючок попал в релиз`);
      if (/\.innerHTML\s*=|insertAdjacentHTML|document\.write\(|\beval\(|new Function\(/.test(t)) fail(zip, `${n}: опасная конструкция (innerHTML/eval)`);
      for (const h of t.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) if (!ALLOWED_HOSTS.has(h[1].toLowerCase())) fail(zip, `${n}: сторонний адрес ${h[1]}`);
    }
  }
  const size = statSync(path).size;
  if (size > 10 * 1024 * 1024) fail(zip, `архив больше 10 МБ (${(size / 1048576).toFixed(1)} МБ)`);
  console.log(`✓ ${zip}: ${names.length} файлов, ${(size / 1024).toFixed(0)} КБ`);
}

function checkSource() {
  const zip = `ekonspekt-source-${v}.zip`;
  let files;
  try {
    files = unzipSync(readFileSync(join(ROOT, 'release', zip)));
  } catch {
    fail(zip, 'архив не найден или повреждён');
    return;
  }
  const names = Object.keys(files);
  for (const n of names) {
    if (/^(_files|new LECTURES|proverka|research_notes|node_modules|dist|release|\.vscode|\.VSCodeCounter)\//.test(n) || /\.(mhtml|htm|zip|pem|env)$/.test(n))
      fail(zip, `личное или лишнее: ${n}`);
    if (/\.(ts|js|mjs|json|md|html|css|txt|yml|yaml)$/.test(n)) {
      const t = text(files[n]);
      for (const [re, what] of PERSONAL.filter(([, w]) => !/путь|source map/.test(w))) if (re.test(t)) fail(zip, `${n}: найдено — ${what}`);
    }
  }
  console.log(`✓ ${zip}: ${names.length} файлов`);
}

checkExtension('chrome');
checkExtension('firefox');
checkSource();
if (problems.length) {
  console.error('\n✗ Архивы не готовы к публикации:\n' + problems.map((p) => '  - ' + p).join('\n'));
  process.exit(1);
}
console.log('\nВсе архивы готовы к загрузке в магазины.');
