const mockSendEmail = jest.fn();
const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/email', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/notifications/sendProviderEmail';

const makeSnsEvent = (subject: string, message: Record<string, unknown>) => ({
  Records: [{ Sns: { Subject: subject, Message: JSON.stringify(message) } }],
});

const intakePayload = {
  ownerId: 'owner-1',
  vetId: 'vet-1',
  dogId: 'dog-1',
  assessmentId: 'a-1',
  description: 'Buddy barks at every visitor and lunges on the lead near other dogs.',
  mediaUrls: ['https://furcircle.s3.amazonaws.com/assessments/x/v.mp4'],
};

// docClient resolves owner, dog, vet in that order (Promise.all)
const mockIntakeLookups = () => {
  mockDocClientSend
    .mockResolvedValueOnce({ Item: { firstName: 'Jane', lastName: 'Doe', email: 'jane@owner.com' } })
    .mockResolvedValueOnce({ Item: { name: 'Buddy', breed: 'Labrador' } })
    .mockResolvedValueOnce({ Item: { firstName: 'Sam', email: 'sam@behaviourist.com' } });
};

beforeEach(() => {
  mockSendEmail.mockReset();
  mockDocClientSend.mockReset();
  process.env['TABLE_NAME'] = 'test-table';
  mockSendEmail.mockResolvedValue(undefined);
});

describe('sendProviderEmail', () => {
  it('silently skips unknown event subjects', async () => {
    await handler(makeSnsEvent('unknown_event', { foo: 'bar' }) as any);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('emails the behaviourist owner details on behaviourist_intake', async () => {
    mockIntakeLookups();

    await handler(makeSnsEvent('behaviourist_intake', intakePayload) as any);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const email = mockSendEmail.mock.calls[0][0];
    expect(email.to).toBe('sam@behaviourist.com');
    expect(email.text).toContain('Jane Doe');
    expect(email.text).toContain('jane@owner.com');
    expect(email.text).toContain('Buddy');
    expect(email.text).toContain('barks at every visitor');
    expect(email.html).toContain('jane@owner.com');
  });

  it('skips when the behaviourist has no email on file', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: { firstName: 'Jane', lastName: 'Doe', email: 'jane@owner.com' } })
      .mockResolvedValueOnce({ Item: { name: 'Buddy' } })
      .mockResolvedValueOnce({ Item: { firstName: 'Sam', email: null } });

    await handler(makeSnsEvent('behaviourist_intake', intakePayload) as any);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('does not throw when email send fails', async () => {
    mockIntakeLookups();
    mockSendEmail.mockRejectedValueOnce(new Error('SES down'));

    await expect(
      handler(makeSnsEvent('behaviourist_intake', intakePayload) as any),
    ).resolves.not.toThrow();
  });
});
