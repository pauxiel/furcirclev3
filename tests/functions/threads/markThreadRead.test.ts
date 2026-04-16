/**
 * Unit tests for PUT /threads/{threadId}/read (markThreadRead)
 */

const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/threads/markThreadRead';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

const makeEvent = (
  threadId: string,
  userId = 'owner-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { threadId },
    requestContext: {
      authorizer: { jwt: { claims: { sub: userId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const threadMeta = {
  PK: 'THREAD#thread-1',
  SK: 'METADATA',
  threadId: 'thread-1',
  ownerId: 'owner-123',
  vetId: 'vet-123',
  status: 'open',
};

const vetMsgUnread = {
  PK: 'THREAD#thread-1',
  SK: 'MSG#1713179200000#msg-1',
  messageId: 'msg-1',
  senderType: 'vet',
  readAt: null,
};

const vetMsgRead = {
  PK: 'THREAD#thread-1',
  SK: 'MSG#1713179300000#msg-2',
  messageId: 'msg-2',
  senderType: 'vet',
  readAt: '2026-04-15T10:00:00Z',
};

const ownerMsg = {
  PK: 'THREAD#thread-1',
  SK: 'MSG#1713179400000#msg-3',
  messageId: 'msg-3',
  senderType: 'owner',
  readAt: null,
};

describe('markThreadRead handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 200 markedRead=0 when no unread vet messages', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: threadMeta })                // GetItem METADATA
      .mockResolvedValueOnce({ Items: [vetMsgRead, ownerMsg] });  // Query messages (no unread vet)

    const res = await handler(makeEvent('thread-1'));
    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.markedRead).toBe(0);
    expect(body.threadId).toBe('thread-1');
  });

  it('returns correct markedRead count', async () => {
    const unread2 = { ...vetMsgUnread, messageId: 'msg-4', SK: 'MSG#1713179500000#msg-4' };
    mockDocClientSend
      .mockResolvedValueOnce({ Item: threadMeta })
      .mockResolvedValueOnce({ Items: [vetMsgUnread, unread2] })
      .mockResolvedValueOnce({})   // UpdateItem msg-1
      .mockResolvedValueOnce({});  // UpdateItem msg-4

    const res = await handler(makeEvent('thread-1'));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.markedRead).toBe(2);
  });

  it('only updates vet msgs with readAt=null (not owner msgs, not already-read msgs)', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: threadMeta })
      .mockResolvedValueOnce({ Items: [vetMsgUnread, vetMsgRead, ownerMsg] })
      .mockResolvedValueOnce({});  // UpdateItem for vetMsgUnread only

    await handler(makeEvent('thread-1'));

    const updateCalls = mockDocClientSend.mock.calls.filter((c: unknown[]) => {
      const input = (c[0] as { input?: Record<string, unknown> }).input ?? {};
      return 'UpdateExpression' in input;
    });
    expect(updateCalls).toHaveLength(1);
  });

  it('paginates query loop until LastEvaluatedKey exhausted', async () => {
    const lastKey = { PK: { S: 'THREAD#thread-1' }, SK: { S: 'MSG#123#abc' } };
    const unread2 = { ...vetMsgUnread, messageId: 'msg-5', SK: 'MSG#1713179600000#msg-5' };
    mockDocClientSend
      .mockResolvedValueOnce({ Item: threadMeta })
      .mockResolvedValueOnce({ Items: [vetMsgUnread], LastEvaluatedKey: lastKey }) // page 1
      .mockResolvedValueOnce({ Items: [unread2] })                                 // page 2
      .mockResolvedValueOnce({})   // UpdateItem msg-1
      .mockResolvedValueOnce({});  // UpdateItem msg-5

    const res = await handler(makeEvent('thread-1'));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.markedRead).toBe(2);

    const queryCalls = mockDocClientSend.mock.calls.filter((c: unknown[]) => {
      const input = (c[0] as { input?: Record<string, unknown> }).input ?? {};
      return 'KeyConditionExpression' in input;
    });
    expect(queryCalls).toHaveLength(2);
  });

  it('chunks UpdateItem in batches of 25', async () => {
    // 26 unread vet messages → 2 chunks (25 + 1)
    const manyUnread = Array.from({ length: 26 }, (_, i) => ({
      ...vetMsgUnread,
      messageId: `msg-${i}`,
      SK: `MSG#${Date.now() + i}#msg-${i}`,
    }));
    mockDocClientSend
      .mockResolvedValueOnce({ Item: threadMeta })
      .mockResolvedValueOnce({ Items: manyUnread });
    // Mock all 26 update calls
    for (let i = 0; i < 26; i++) {
      mockDocClientSend.mockResolvedValueOnce({});
    }

    const res = await handler(makeEvent('thread-1'));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.markedRead).toBe(26);

    const updateCalls = mockDocClientSend.mock.calls.filter((c: unknown[]) => {
      const input = (c[0] as { input?: Record<string, unknown> }).input ?? {};
      return 'UpdateExpression' in input;
    });
    expect(updateCalls).toHaveLength(26);
  });

  it('returns 404 THREAD_NOT_FOUND when thread does not exist', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeEvent('unknown'));
    expect((res as { statusCode: number }).statusCode).toBe(404);
    expect(JSON.parse((res as { body: string }).body).error).toBe('THREAD_NOT_FOUND');
  });

  it('returns 403 FORBIDDEN when ownerId does not match userId', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...threadMeta, ownerId: 'other' } });

    const res = await handler(makeEvent('thread-1', 'attacker'));
    expect((res as { statusCode: number }).statusCode).toBe(403);
    expect(JSON.parse((res as { body: string }).body).error).toBe('FORBIDDEN');
  });

  it('readAt is set to ISO timestamp string', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: threadMeta })
      .mockResolvedValueOnce({ Items: [vetMsgUnread] })
      .mockResolvedValueOnce({});

    await handler(makeEvent('thread-1'));

    const updateCall = mockDocClientSend.mock.calls.find((c: unknown[]) => {
      const input = (c[0] as { input?: Record<string, unknown> }).input ?? {};
      return 'UpdateExpression' in input;
    });
    const updateInput = (updateCall![0] as { input: { ExpressionAttributeValues: Record<string, unknown> } }).input;
    const readAt = updateInput.ExpressionAttributeValues[':readAt'] as string;
    expect(readAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
