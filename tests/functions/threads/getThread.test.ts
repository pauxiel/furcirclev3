/**
 * Unit tests for GET /threads/{threadId} (getThread)
 */

const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/threads/getThread';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { encodeCursor } from '../../../src/lib/threads';

const makeEvent = (
  threadId: string,
  params: Record<string, string> = {},
  userId = 'owner-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { threadId },
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
  createdAt: '2026-04-15T10:00:00Z',
  closedAt: null,
};

const vetProfile = {
  PK: 'VET#vet-123',
  SK: 'PROFILE',
  vetId: 'vet-123',
  firstName: 'Sarah',
  lastName: 'Mitchell',
  providerType: 'behaviourist',
  specialisation: 'Puppy behaviour & early socialisation',
  photoUrl: 'https://example.com/sarah.jpg',
};

const dogProfile = {
  PK: 'DOG#dog-123',
  SK: 'PROFILE',
  dogId: 'dog-123',
  name: 'Buddy',
  breed: 'Golden Retriever',
  ageMonths: 3,
};

const ownerProfile = {
  PK: 'OWNER#owner-123',
  SK: 'PROFILE',
  userId: 'owner-123',
  firstName: 'Paul',
  lastName: 'Oba',
};

const messages = [
  {
    PK: 'THREAD#thread-1',
    SK: 'MSG#1713179200000#msg-1',
    messageId: 'msg-1',
    senderId: 'owner-123',
    senderType: 'owner',
    body: 'Is mouthing normal?',
    readAt: null,
    createdAt: '2026-04-15T10:00:00Z',
  },
  {
    PK: 'THREAD#thread-1',
    SK: 'MSG#1713179400000#msg-2',
    messageId: 'msg-2',
    senderId: 'vet-123',
    senderType: 'vet',
    body: 'Yes, totally normal at 3 months.',
    readAt: null,
    createdAt: '2026-04-15T10:30:00Z',
  },
];

describe('getThread handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 200 with full thread and messages', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: threadMeta })   // GetItem METADATA
      .mockResolvedValueOnce({ Items: messages })    // Query messages
      .mockResolvedValueOnce({ Item: vetProfile })   // GetItem vet
      .mockResolvedValueOnce({ Item: dogProfile })   // GetItem dog
      .mockResolvedValueOnce({ Item: ownerProfile }); // GetItem owner

    const res = await handler(makeEvent('thread-1'));
    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.threadId).toBe('thread-1');
    expect(body.messages).toHaveLength(2);
    expect(body.vet.specialisation).toBe('Puppy behaviour & early socialisation');
    expect(body.dog.ageMonths).toBe(3);
    expect(body.dogProfileVisible).toBe(true);
  });

  it('returns 400 when threadId missing', async () => {
    const event = makeEvent('thread-1');
    (event as unknown as { pathParameters: null }).pathParameters = null;
    const res = await handler(event);
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 404 THREAD_NOT_FOUND for unknown threadId', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeEvent('unknown'));
    expect((res as { statusCode: number }).statusCode).toBe(404);
    expect(JSON.parse((res as { body: string }).body).error).toBe('THREAD_NOT_FOUND');
  });

  it('returns 403 FORBIDDEN when ownerId does not match userId', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...threadMeta, ownerId: 'other' } });

    const res = await handler(makeEvent('thread-1', {}, 'attacker'));
    expect((res as { statusCode: number }).statusCode).toBe(403);
    expect(JSON.parse((res as { body: string }).body).error).toBe('FORBIDDEN');
  });

  it('senderName is owner firstName for owner messages', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: threadMeta })
      .mockResolvedValueOnce({ Items: [messages[0]] })
      .mockResolvedValueOnce({ Item: vetProfile })
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: ownerProfile });

    const res = await handler(makeEvent('thread-1'));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.messages[0].senderName).toBe('Paul');
  });

  it('senderName is "Dr. firstName lastName" for vet messages', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: threadMeta })
      .mockResolvedValueOnce({ Items: [messages[1]] })
      .mockResolvedValueOnce({ Item: vetProfile })
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: ownerProfile });

    const res = await handler(makeEvent('thread-1'));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.messages[0].senderName).toBe('Dr. Sarah Mitchell');
  });

  it('dogProfileVisible is always true', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: threadMeta })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Item: vetProfile })
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: ownerProfile });

    const res = await handler(makeEvent('thread-1'));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.dogProfileVisible).toBe(true);
  });

  it('returns nextToken when LastEvaluatedKey present', async () => {
    const lastKey = { PK: { S: 'THREAD#thread-1' }, SK: { S: 'MSG#123#abc' } };
    mockDocClientSend
      .mockResolvedValueOnce({ Item: threadMeta })
      .mockResolvedValueOnce({ Items: [messages[0]], LastEvaluatedKey: lastKey })
      .mockResolvedValueOnce({ Item: vetProfile })
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: ownerProfile });

    const res = await handler(makeEvent('thread-1'));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.nextToken).toBe(encodeCursor(lastKey as Record<string, unknown>));
  });

  it('returns empty messages array when thread has no messages', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: threadMeta })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Item: vetProfile })
      .mockResolvedValueOnce({ Item: dogProfile })
      .mockResolvedValueOnce({ Item: ownerProfile });

    const res = await handler(makeEvent('thread-1'));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.messages).toEqual([]);
  });
});
