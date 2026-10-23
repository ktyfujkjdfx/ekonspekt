import { ext, fromOurExtension, TARGET } from '../shared/api';
import { cleanFileBase } from '../format/txt';
import { DEFAULT_SETTINGS, type Settings } from '../shared/settings';
import type { DownloadMessage, ThemeMessage } from '../shared/messages';

ext.runtime.onInstalled.addListener(async () => {
  const r = await ext.storage.local.get('settings');
  const saved = { ...((r?.settings ?? {}) as Partial<Settings>) };
  // В 1.0.0 «Мои ответы» были выключены по умолчанию и сохранялись при установке — включаем один раз.
  if ((saved.defaultsVersion ?? 1) < 2) saved.includeResults = true;
  await ext.storage.local.set({ settings: { ...DEFAULT_SETTINGS, ...saved, defaultsVersion: DEFAULT_SETTINGS.defaultsVersion } });
});

/**
 * Иконка на панели под тему браузера: в тёмной теме — светлая песочная, в светлой — тёмная.
 * Firefox делает это сам (action.theme_icons в манифесте). В Chromium service worker не видит тему,
 * поэтому её сообщают popup и content script (matchMedia), а мы меняем иконку.
 */
const iconSet = (variant: 'ink' | 'sand') => ({
  16: `icons/${variant}/icon-16.png`,
  32: `icons/${variant}/icon-32.png`,
  48: `icons/${variant}/icon-48.png`,
  128: `icons/${variant}/icon-128.png`,
});
let lastDark: boolean | null = null;

async function applyTheme(dark: boolean) {
  if (TARGET === 'firefox' || dark === lastDark) return;
  lastDark = dark;
  try {
    await ext.action.setIcon({ path: iconSet(dark ? 'sand' : 'ink') });
    await ext.storage.local.set({ themeDark: dark });
  } catch {
    /* не критично */
  }
}

// После перезапуска браузера восстанавливаем последнюю известную тему.
ext.storage.local.get('themeDark').then(
  (r) => {
    if (typeof r?.themeDark === 'boolean') void applyTheme(r.themeDark);
  },
  () => {},
);

const DOWNLOAD_MIME = new Set(['text/plain;charset=utf-8', 'application/zip']);
/** Предел на файл: конспект с рисунками или тест на 120 вопросов со снимками укладываются с запасом. */
const MAX_DOWNLOAD = 300 * 1024 * 1024;

ext.runtime.onMessage.addListener((msg: ThemeMessage | DownloadMessage, sender, sendResponse: (r: { ok: boolean; error?: string }) => void) => {
  if (!fromOurExtension(sender)) return false;
  if (msg?.type === 'theme') {
    void applyTheme(!!msg.dark);
    return false;
  }
  // Firefox: сохранение файла через downloads API (blob-ссылки content-скрипта страница скачать не может).
  if (msg?.type === 'download' && TARGET === 'firefox') {
    // Строгая проверка: только наши типы файлов, разумный размер, имя без путей.
    const data: unknown = msg.data;
    const ok =
      typeof msg.filename === 'string' &&
      DOWNLOAD_MIME.has(msg.mime) &&
      (data instanceof Uint8Array || data instanceof ArrayBuffer) &&
      data.byteLength <= MAX_DOWNLOAD;
    if (!ok) {
      sendResponse({ ok: false, error: 'Недопустимый файл.' });
      return false;
    }
    const m = msg.filename.match(/^(.*)\.(txt|zip)$/i);
    const filename = m ? `${cleanFileBase(m[1])}.${m[2].toLowerCase()}` : `${cleanFileBase(msg.filename)}.txt`;
    const url = URL.createObjectURL(new Blob([msg.data as BlobPart], { type: msg.mime }));
    ext.downloads
      .download({ url, filename, saveAs: false })
      .then(
        () => sendResponse({ ok: true }),
        (e: unknown) => sendResponse({ ok: false, error: String(e) }),
      )
      .finally(() => setTimeout(() => URL.revokeObjectURL(url), 60000));
    return true;
  }
  return false;
});
