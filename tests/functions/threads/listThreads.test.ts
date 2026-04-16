/**
 * Unit tests for GET /threads (listThreads)
 */

const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/threads/listThreads';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { encodeCursor } from '../../../src/lib/threads';

const makeEvent = (
  params: Record<string, string> = {},
  userId = 'owner-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: {},
    queryStringParameters: Object.keys(params).length ? params : undefined,
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
  GSI1PK: 'OWNER#owner-123',
  GSI1SK: 'THREAD#ask_a_vet#2026-04-15T10:00:00Z',
  createdAt: '2026-04-15T10:00:00Z',
};

const vetProfile = {
  PK: 'VET#vet-123',
  SK: 'PROFILE',
  vetId: 'vet-123',
  firstName: 'Sarah',
  lastName: 'Mitchell',
  providerType: 'behaviourist',
  photoUrl: 'https://example.com/sarah.jpg',
};

const dogProfile = {
  PK: 'DOG#dog-123',
  SK: 'PROFILE',
  dogId: 'dog-123',
  name: 'Buddy',
  breed: 'Golden Retriever',
};

const lastMessage = {
  PK: 'THREAD#thread-1',
  SK: 'MSG#1713179200000#msg-1',
  messageId: 'msg-1',
  senderType: 'vet',
  body: 'Not at all — this is normal at 3 months.',
  createdAt: '2026-04-15T10:30:00Z',
  readAt: null,
};

describe('listThreads handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 200 with threads array including vet, dog, lastMessage, unreadCount', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Items: [threadMeta] })                           // Query GSI1
      .mockResolvedValueOnce({ Responses: { 'furcircle-test': [vetProfile, dogProfile] } }) // BatchGetItem
      .mockResolvedValueOnce({ Items: [lastMessage] });                         // Query messages (last msg + unread)

    const res = await handler(makeEvent());
    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0].vet.firstName).toBe('Sarah');
    expect(body.threads[0].dog.name).toBe('Buddy');
    expect(body.threads[0].lastMessage.body).toBe('Not at all — this is normal at 3 months.');
    expect(body.threads[0].unreadCount).toBe(1); // 1 vet msg with readAt=null
  });

  it('BatchGetItem called once for all vets+dogs', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Items: [threadMeta] })
      .mockResolvedValueOnce({ Responses: { 'furcircle-test': [vetProfile, dogProfile] } })
      .mockResolvedValueOnce({ Items: [] });

    await handler(makeEvent());

    const batchCall = mockDocClientSend.mock.calls.find((c: unknown[]) => {
      return (c[0] as { input?: { RequestItems?: unknown } }).input?.RequestItems !== undefined;
    });
    expect(batchCall).toBeDefined();
    // Only one BatchGetItem call total
    const batchCalls = mockDocClientSend.mock.calls.filter((c: unknown[]) =>
      (c[0] as { input?: { RequestItems?: unknown } }).input?.RequestItems !== undefined
    );
    expect(batchCalls).toHaveLength(1);
  });

  it('unreadCount counts only vet messages with readAt=null', async () => {
    const messages = [
      { ...lastMessage, senderType: 'vet', readAt: null },
      { ...lastMessage, messageId: 'msg-2', SK: 'MSG#1713179201000#msg-2', senderType: 'vet', readAt: '2026-04-15T11:00:00Z' },
      { ...lastMessage, messageId: 'msg-3', SK: 'MSG#1713179202000#msg-3', senderType: 'owner', readAt: null },
    ];
    mockDocClientSend
      .mockResolvedValueOnce({ Items: [threadMeta] })
      .mockResolvedValueOnce({ Responses: { 'furcircle-test': [vetProfile, dogProfile] } })
      .mockResolvedValueOnce({ Items: messages });

    const res = await handler(makeEvent());
    const body = JSON.parse((res as { body: string }).body);
    expect(body.threads[0].unreadCount).toBe(1); // only first vet msg is unread
  });

  it('type filter prefixes GSI1SK with THREAD#ask_a_vet#', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Items: [] });

    await handler(makeEvent({ type: 'ask_a_vet' }));

    const queryCall = mockDocClientSend.mock.calls[0][0] as {
      input: { ExpressionAttributeValues: Record<string, string> };
    };
    const prefix = queryCall.input.ExpressionAttributeValues[':prefix'] as string;
    expect(prefix).toBe('THREAD#ask_a_vet#');
  });

  it('status filter applied post-query (closed threads excluded)', async () => {
    const closedThread = { ...threadMeta, threadId: 'thread-2', status: 'closed', SK: 'METADATA' };
    mockDocClientSend
      .mockResolvedValueOnce({ Items: [threadMeta, closedThread] })
      .mockResolvedValueOnce({ Responses: { 'furcircle-test': [vetProfile, dogProfile] } }) // BatchGet for filtered thread-1 only
      .mockResolvedValueOnce({ Items: [] });  // messages for thread-1 only (thread-2 filtered out)

    const res = await handler(makeEvent({ status: 'open' }));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0].status).toBe('open');
  });

  it('nextToken encodes LastEvaluatedKey as base64 JSON', async () => {
    const lastKey = { PK: { S: 'OWNER#owner-123' }, SK: { S: 'THREAD#ask_a_vet#2026-04-01' } };
    mockDocClientSend
      .mockResolvedValueOnce({ Items: [threadMeta], LastEvaluatedKey: lastKey })
      .mockResolvedValueOnce({ Responses: { 'furcircle-test': [vetProfile, dogProfile] } })
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent());
    const body = JSON.parse((res as { body: string }).body);
    expect(body.nextToken).toBe(encodeCursor(lastKey as Record<string, unknown>));
  });

  it('passes nextToken as ExclusiveStartKey', async () => {
    const lastKey = { PK: { S: 'OWNER#owner-123' } };
    const token = encodeCursor(lastKey as Record<string, unknown>);
    mockDocClientSend
      .mockResolvedValueOnce({ Items: [] });

    await handler(makeEvent({ nextToken: token }));

    const queryCall = mockDocClientSend.mock.calls[0][0] as {
      input: { ExclusiveStartKey?: unknown };
    };
    expect(queryCall.input.ExclusiveStartKey).toEqual(lastKey);
  });

  it('returns empty threads array when owner has no threads', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent());
    const body = JSON.parse((res as { body: string }).body);
    expect(body.threads).toEqual([]);
    expect(body.nextToken).toBeNull();
  });

  it('returns null vet/dog when missing from BatchGet response', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Items: [threadMeta] })
      .mockResolvedValueOnce({ Responses: { 'furcircle-test': [] } }) // nothing returned
      .mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent());
    const body = JSON.parse((res as { body: string }).body);
    expect(body.threads[0].vet).toBeNull();
    expect(body.threads[0].dog).toBeNull();
  });

  it('respects limit param', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });

    await handler(makeEvent({ limit: '5' }));

    const queryCall = mockDocClientSend.mock.calls[0][0] as { input: { Limit?: number } };
    expect(queryCall.input.Limit).toBe(5);
  });
});
