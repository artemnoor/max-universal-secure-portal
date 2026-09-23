import { createHmac } from 'node:crypto';

export const TEST_BOT_TOKEN = 'fixture-only-max-bot-token';

type InitDataOptions = Readonly<{
  userId?: number;
  authDate?: number;
  firstName?: string;
  userExtras?: Readonly<Record<string, unknown>>;
}>;

export const createSignedInitData = (options: InitDataOptions = {}): string => {
  const params = new URLSearchParams({
    auth_date: String(options.authDate ?? Math.floor(Date.now() / 1000)),
    user: JSON.stringify({
      id: options.userId ?? 42,
      first_name: options.firstName ?? 'Fixture',
      username: 'fixture_user',
      ...options.userExtras,
    }),
  });
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(TEST_BOT_TOKEN).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  params.set('hash', hash);
  return params.toString();
};
