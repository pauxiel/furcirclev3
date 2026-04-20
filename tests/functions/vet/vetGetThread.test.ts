const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/vet/vetGetThread';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (threadId: string, vetId = 'vet-123'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { threadId },
    requestContext: {
      authorizer: { jwt: { claims: { sub: vetId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const threadMeta = {
  PK: 'THREAD#thread-1', SK: 'METADATA',
  threadId: 'thread-1', type: 'ask_a_vet', status: 'open',
  ownerId: 'owner-1', vetId: 'vet-123', dogId: 'dog-1',
  createdAt: '2026-04-15T10:00:00Z',
};

const ownerProfile = { PK: 'OWNER#owner-1', SK: 'PROFILE', userId: 'owner-1', firstName: 'Joshua', lastName: 'Smith', email: 'j@ex.com' };
const ownerSub = { PK: 'OWNER#owner-1', SK: 'SUBSCRIPTION', plan: 'proactive' };
const dogProfile = { PK: 'DOG#dog-1', SK: 'PROFILE', dogId: 'dog-1', name: 'Buddy', breed: 'Golden Retriever', ageMonths: 3, wellnessScore: 72 };

const messages = [
  { PK: 'THREAD#thread-1', SK: 'MSG#1#msg-1', messageId: 'msg-1', senderType: 'owner', body: 'Hi', readAt: null, createdAt: '2026-04-15T10:00:00Z' },
];

describe('vetGetThread handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 404 when thread not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });
    const res = (await handler(makeEvent('thread-999'))) as Result;
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe('NOT_FOUND');
  });

  it('returns 403 when vet does not own thread', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...threadMeta, vetId: 'other-vet' } });
    const res = (await handler(makeEvent('thread-1'))) as Result;
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('FORBIDDEN');
  });

  it('returns 200 with full thread context', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: threadMeta });
    mockDocClientSend.mockResolvedValueOnce({
      Responses: { 'furcircle-test': [ownerProfile, ownerSub, dogProfile] },
    });
    mockDocClientSend.mockResolvedValueOnce({ Items: messages });

    const res = (await handler(makeEvent('thread-1'))) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.threadId).toBe('thread-1');
    expect(body.owner.firstName).toBe('Joshua');
    expect(body.owner.subscription.plan).toBe('proactive');
    expect(body.dog.name).toBe('Buddy');
    expect(body.messages).toHaveLength(1);
  });
});
