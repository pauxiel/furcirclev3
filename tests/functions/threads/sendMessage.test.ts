/**
 * Unit tests for POST /threads/{threadId}/messages (sendMessage)
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

import { handler } from '../../../src/functions/threads/sendMessage';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

const makeEvent = (
  threadId: string,
  body: unknown,
  userId = 'owner-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { threadId },
    body: body !== undefined ? JSON.stringify(body) : undefined,
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
  dogId: 'dog-123',
  type: 'ask_a_vet',
  status: 'open',
  createdAt: '2026-04-15T10:00:00Z',
};

const vetProfile = {
  PK: 'VET#vet-123',
  SK: 'PROFILE',
  vetId: 'vet-123',
  pushToken: 'vet-push-token',
};

describe('sendMessage handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    process.env['NOTIFICATIONS_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:123:NotificationsTopic';
  });

  it('returns 201 with message record on success', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: threadMeta })  // GetItem METADATA
      .mockResolvedValueOnce({})                     // PutItem MSG
      .mockResolvedValueOnce({ Item: vetProfile })   // GetItem vet (SNS path)
    mockSnsSend.mockResolvedValueOnce({});

    const res = await handler(makeEvent('thread-1', { body: 'Is this normal?' }));
    expect((res as { statusCode: number }).statusCode).toBe(201);
    const parsed = JSON.parse((res as { body: string }).body);
    expect(parsed.messageId).toBeDefined();
    expect(parsed.senderType).toBe('owner');
    expect(parsed.body).toBe('Is this normal?');
    expect(parsed.readAt).toBeNull();
  });

  it('MSG SK starts with MSG#, senderType=owner, readAt=null', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: threadMeta })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Item: vetProfile });
    mockSnsSend.mockResolvedValueOnce({});

    await handler(makeEvent('thread-1', { body: 'Hello' }));

    const putCall = mockDocClientSend.mock.calls.find((c: unknown[]) => {
      return (c[0] as { input?: { Item?: unknown } }).input?.Item !== undefined;
    });
    expect(putCall).toBeDefined();
    const item = (putCall![0] as { input: { Item: Record<string, unknown> } }).input.Item;
    expect((item['SK'] as string).startsWith('MSG#')).toBe(true);
    expect(item['senderType']).toBe('owner');
    expect(item['readAt']).toBeNull();
  });

  it('returns 404 THREAD_NOT_FOUND when thread does not exist', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeEvent('unknown', { body: 'Hello' }));
    expect((res as { statusCode: number }).statusCode).toBe(404);
    expect(JSON.parse((res as { body: string }).body).error).toBe('THREAD_NOT_FOUND');
  });

  it('returns 403 FORBIDDEN when ownerId does not match userId', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...threadMeta, ownerId: 'other' } });

    const res = await handler(makeEvent('thread-1', { body: 'Hello' }, 'attacker'));
    expect((res as { statusCode: number }).statusCode).toBe(403);
    expect(JSON.parse((res as { body: string }).body).error).toBe('FORBIDDEN');
  });

  it('returns 403 THREAD_CLOSED when thread status is closed', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...threadMeta, status: 'closed' } });

    const res = await handler(makeEvent('thread-1', { body: 'Hello' }));
    expect((res as { statusCode: number }).statusCode).toBe(403);
    expect(JSON.parse((res as { body: string }).body).error).toBe('THREAD_CLOSED');
  });

  it('returns 400 VALIDATION_ERROR when body is missing', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: threadMeta });

    const res = await handler(makeEvent('thread-1', undefined));
    expect((res as { statusCode: number }).statusCode).toBe(400);
    expect(JSON.parse((res as { body: string }).body).error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 VALIDATION_ERROR when body exceeds 2000 chars', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: threadMeta });

    const res = await handler(makeEvent('thread-1', { body: 'x'.repeat(2001) }));
    expect((res as { statusCode: number }).statusCode).toBe(400);
    expect(JSON.parse((res as { body: string }).body).error).toBe('VALIDATION_ERROR');
  });

  it('returns 201 even when SNS publish throws', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: threadMeta })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Item: vetProfile });
    mockSnsSend.mockRejectedValueOnce(new Error('SNS down'));

    const res = await handler(makeEvent('thread-1', { body: 'Hello' }));
    expect((res as { statusCode: number }).statusCode).toBe(201);
  });
});
