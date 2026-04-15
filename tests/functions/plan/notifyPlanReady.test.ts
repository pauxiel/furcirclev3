/**
 * Unit tests for Step Function step: NotifyPlanReady
 */

const mockDocClientSend = jest.fn();
const mockSNSClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn(() => ({ send: (...args: unknown[]) => mockSNSClientSend(...args) })),
  PublishCommand: jest.fn((input: unknown) => ({ input })),
}));

import { handler } from '../../../src/functions/plan/notifyPlanReady';

const planInput = {
  dogId: 'dog-123',
  ownerId: 'owner-123',
  name: 'Buddy',
  planStatus: 'ready',
  wellnessScore: 72,
};

const ownerProfile = {
  PK: 'OWNER#owner-123',
  SK: 'PROFILE',
  userId: 'owner-123',
  pushToken: 'ExponentPushToken[test123]',
};

describe('notifyPlanReady handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    process.env['SNS_PLATFORM_APP_ARN'] = 'arn:aws:sns:us-east-1:123:app/GCM/furcircle';
    mockSNSClientSend.mockResolvedValue({ MessageId: 'msg-1' });
  });

  it('sends SNS notification when pushToken present', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: ownerProfile });

    await handler(planInput);

    expect(mockSNSClientSend).toHaveBeenCalledTimes(1);
    const cmd = mockSNSClientSend.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(cmd.input['TargetArn'] ?? cmd.input['Token']).toBeDefined();
  });

  it('skips SNS when owner has no pushToken', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...ownerProfile, pushToken: null } });

    await handler(planInput);

    expect(mockSNSClientSend).not.toHaveBeenCalled();
  });

  it('returns input unchanged', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: ownerProfile });

    const result = (await handler(planInput)) as Record<string, unknown>;
    expect(result['dogId']).toBe('dog-123');
    expect(result['planStatus']).toBe('ready');
  });

  it('skips SNS when owner profile not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    await handler(planInput);

    expect(mockSNSClientSend).not.toHaveBeenCalled();
  });
});
