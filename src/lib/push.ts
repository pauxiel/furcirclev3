const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default';
}

export async function sendPush(message: PushMessage): Promise<void> {
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...message, sound: 'default' }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Expo push failed ${res.status}: ${text}`);
  }
}
