import { Keyboard } from '@maxhub/max-bot-api';
import { config } from '../../config.js';
import { configuredOrigins } from '../../core/url-policy.js';
import type { PortalResponse } from '../../portal/contracts.js';

export type RenderedAttachments = NonNullable<NonNullable<Parameters<import('@maxhub/max-bot-api').Context['reply']>[1]>['attachments']>;
type InlineButton = ReturnType<typeof Keyboard.button.callback> | ReturnType<typeof Keyboard.button.openApp> | ReturnType<typeof Keyboard.button.link>;
const safeStartParam = (value: string | undefined): string | undefined => value && /^[A-Za-z0-9._:,-]{1,512}$/u.test(value) ? value : undefined;
const safeLink = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && configuredOrigins(config.publicAppOrigins).includes(url.origin) ? url.href : undefined;
  } catch { return undefined; }
};
export function renderPortalResponseAttachments(response: PortalResponse): RenderedAttachments {
  const rows: InlineButton[][] = [];
  for (const action of response.actions.slice(0, 210)) {
    const label = action.label.trim().slice(0, 128);
    if (!label) continue;
    if (action.kind === 'callback') {
      const payload = action.data ? `${action.actionId}:${action.data}` : action.actionId;
      if (Buffer.byteLength(payload, 'utf8') <= 1024) rows.push([Keyboard.button.callback(label, payload)]);
    } else if (action.kind === 'open_app') rows.push([Keyboard.button.openApp(label, config.miniAppBotUsername, undefined, safeStartParam(action.startParam))]);
    else {
      const url = safeLink(action.url);
      if (url) rows.push([Keyboard.button.link(label, url)]);
    }
  }
  return rows.length ? [Keyboard.inlineKeyboard(rows)] : [];
}
