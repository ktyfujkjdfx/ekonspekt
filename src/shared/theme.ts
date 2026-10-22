import { ext } from './api';
import type { ThemeMessage } from './messages';

/** Сообщить фоновому скрипту тему браузера и следить за её сменой. */
export function reportBrowserTheme(): void {
  const mq = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  if (!mq) return;
  const send = () => {
    const msg: ThemeMessage = { type: 'theme', dark: mq.matches };
    try {
      const p = ext.runtime.sendMessage(msg) as unknown as Promise<unknown> | undefined;
      p?.catch?.(() => {});
    } catch {
      /* фон спит/обновляется */
    }
  };
  send();
  mq.addEventListener?.('change', send);
}
