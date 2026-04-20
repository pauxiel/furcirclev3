const mockDocClientSend = jest.fn();
const mockFetch = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

global.fetch = mockFetch;

import { handler } from '../../../src/functions/notifications/sendPushNotification';

const makeSnsEvent = (subject: string, message: Record<string, unknown>) => ({
  Records: [{
    Sns: {
      Subject: subject,
      Message: JSON.stringify(message),
    },
  }],
});

beforeEach(() => {
  mockDocClientSend.mockReset();
  mockFetch.mockReset();
  process.env['TABLE_NAME'] = 'test-table';
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: [{ status: 'ok' }] }) });
});

describe('sendPushNotification', () => {
  it('sends push for plan_ready when owner has pushToken', async () => {
    mockDocClientSend.mockResolvedValueOnce({
      Item: { pushToken: 'ExponentPushToken[test123]' },
    });

    await handler(makeSnsEvent('plan_ready', { ownerId: 'u1', dogName: 'Buddy', dogId: 'd1' }) as any);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.to).toBe('ExponentPushToken[test123]');
    expect(body.title).toContain('FurCircle');
    expect(body.body).toContain('Buddy');
  });

  it('skips push when owner has no pushToken', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { pushToken: null } });

    await handler(makeSnsEvent('plan_ready', { ownerId: 'u1', dogName: 'Buddy', dogId: 'd1' }) as any);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends push for new_vet_message', async () => {
    mockDocClientSend.mockResolvedValueOnce({
      Item: { pushToken: 'ExponentPushToken[abc]' },
    });

    await handler(makeSnsEvent('new_vet_message', { ownerId: 'u1', threadId: 't1' }) as any);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.body).toContain('message');
  });

  it('sends push for assessment_responded', async () => {
    mockDocClientSend.mockResolvedValueOnce({
      Item: { pushToken: 'ExponentPushToken[abc]' },
    });

    await handler(makeSnsEvent('assessment_responded', { ownerId: 'u1', decision: 'approved' }) as any);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.body).toContain('approved');
  });

  it('sends push for new_booking', async () => {
    mockDocClientSend.mockResolvedValueOnce({
      Item: { pushToken: 'ExponentPushToken[abc]' },
    });

    await handler(makeSnsEvent('new_booking', { ownerId: 'u1', bookingId: 'b1' }) as any);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('silently skips unknown event subjects', async () => {
    await handler(makeSnsEvent('unknown_event', { ownerId: 'u1' }) as any);
    expect(mockDocClientSend).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not throw when Expo API returns error', async () => {
    mockDocClientSend.mockResolvedValueOnce({
      Item: { pushToken: 'ExponentPushToken[abc]' },
    });
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(
      handler(makeSnsEvent('plan_ready', { ownerId: 'u1', dogName: 'Buddy', dogId: 'd1' }) as any)
    ).resolves.not.toThrow();
  });
});
