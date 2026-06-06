const mockSendEmail = jest.fn();

jest.mock('../../../src/lib/email', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

import { handler } from '../../../src/functions/notifications/sendProviderEmail';

const makeSnsEvent = (subject: string, message: Record<string, unknown>) => ({
  Records: [{ Sns: { Subject: subject, Message: JSON.stringify(message) } }],
});

beforeEach(() => {
  mockSendEmail.mockReset();
  process.env['TABLE_NAME'] = 'test-table';
  mockSendEmail.mockResolvedValue(undefined);
});

describe('sendProviderEmail', () => {
  it('silently skips unknown event subjects', async () => {
    await handler(makeSnsEvent('unknown_event', { foo: 'bar' }) as any);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
