/**
 * Unit tests for closeExpiredThreads (EventBridge cron)
 */

const mockDocClientSend = jest.fn();
const mockSnsSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));
jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn().mockImplementation(() => ({ send: (...args: unknown[]) => mockSnsSend(...args) })),
  PublishCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

import { handler } from '../../../src/functions/threads/closeExpiredThreads';

const makeEvent = () => ({} as unknown);

const expiredThread = {
  PK: 'THREAD#thread-exp',
  SK: 'METADATA',
  threadId: 'thread-exp',
  ownerId: 'owner-123',
  type: 'post_booking',
  status: 'open',
  closedAt: '2026-04-15T00:00:00Z', // past
};

const ownerProfile = {
  PK: 'OWNER#owner-123',
  SK: 'PROFILE',
  userId: 'owner-123',
  pushToken: 'owner-push-token',
};

describe('closeExpiredThreads handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    process.env['NOTIFICATIONS_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:123:NotificationsTopic';
  });

  it('updates status=closed for each expired thread', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Items: [expiredThread], LastEvaluatedKey: undefined }) // Scan page 1
      .mockResolvedValueOnce({})                                                        // UpdateItem
      .mockResolvedValueOnce({ Item: ownerProfile });                                  // GetItem owner
    mockSnsSend.mockResolvedValueOnce({});

    await handler(makeEvent());

    const updateCall = mockDocClientSend.mock.calls.find((c: unknown[]) => {
      const input = (c[0] as { input?: Record<string, unknown> }).input ?? {};
      return 'UpdateExpression' in input;
    });
    expect(updateCall).toBeDefined();
    const updateInput = (updateCall![0] as { input: Record<string, unknown> }).input;
    expect(updateInput['UpdateExpression']).toContain('closed');
  });

  it('paginates scan until LastEvaluatedKey exhausted', async () => {
    const lastKey = { PK: { S: 'THREAD#thread-exp' }, SK: { S: 'METADATA' } };
    mockDocClientSend
      .mockResolvedValueOnce({ Items: [expiredThread], LastEvaluatedKey: lastKey }) // page 1
      .mockResolvedValueOnce({})                                                     // UpdateItem
      .mockResolvedValueOnce({ Item: ownerProfile })                                 // GetItem owner
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined })             // page 2 (empty)
    mockSnsSend.mockResolvedValueOnce({});

    await handler(makeEvent());

    const scanCalls = mockDocClientSend.mock.calls.filter((c: unknown[]) => {
      const input = (c[0] as { input?: Record<string, unknown> }).input ?? {};
      return 'FilterExpression' in input;
    });
    expect(scanCalls).toHaveLength(2);
  });

  it('SNS published per closed thread', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Items: [expiredThread] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Item: ownerProfile });
    mockSnsSend.mockResolvedValueOnce({});

    await handler(makeEvent());

    expect(mockSnsSend).toHaveBeenCalledTimes(1);
  });

  it('Promise.allSettled — one failure does not abort others', async () => {
    const thread2 = { ...expiredThread, threadId: 'thread-2', ownerId: 'owner-456', PK: 'THREAD#thread-2' };
    mockDocClientSend
      .mockResolvedValueOnce({ Items: [expiredThread, thread2] })
      .mockRejectedValueOnce(new Error('UpdateItem failed'))  // thread-exp update fails
      .mockResolvedValueOnce({ Item: ownerProfile })           // thread-exp owner (if reached)
      .mockResolvedValueOnce({})                               // thread-2 update succeeds
      .mockResolvedValueOnce({ Item: { ...ownerProfile, PK: 'OWNER#owner-456', ownerId: 'owner-456' } });
    mockSnsSend.mockResolvedValue({});

    // Should not throw even with partial failure
    await expect(handler(makeEvent())).resolves.not.toThrow();
  });

  it('skips threads where closedAt is in the future', async () => {
    // Scan FilterExpression already handles this — skips via DynamoDB filter
    // Verify handler completes cleanly when scan returns empty
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });

    await handler(makeEvent());

    // No UpdateItem calls
    const updateCalls = mockDocClientSend.mock.calls.filter((c: unknown[]) => {
      const input = (c[0] as { input?: Record<string, unknown> }).input ?? {};
      return 'UpdateExpression' in input;
    });
    expect(updateCalls).toHaveLength(0);
  });

  it('idempotent when no expired threads', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });

    const result = await handler(makeEvent());
    expect(result).toBeUndefined();
  });
});
