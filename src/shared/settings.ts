import { ext } from './api';

export interface Settings {
  showButtons: boolean;
  zip: boolean;
  includeResults: boolean;
  /** Пользователь подтвердил предупреждение про обход страниц попытки. */
  attemptFetchAck: boolean;
  /** Пользователь подтвердил предупреждение про «Собрать всю лекцию». */
  lessonFetchAck: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  showButtons: true,
  zip: false,
  includeResults: false,
  attemptFetchAck: false,
  lessonFetchAck: false,
};

const KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  try {
    const r = await ext.storage.local.get(KEY);
    return { ...DEFAULT_SETTINGS, ...(r?.[KEY] as Partial<Settings> | undefined) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await ext.storage.local.set({ [KEY]: next });
  return next;
}

export function onSettingsChanged(cb: (s: Settings) => void): void {
  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) cb({ ...DEFAULT_SETTINGS, ...(changes[KEY].newValue as Partial<Settings>) });
  });
}
