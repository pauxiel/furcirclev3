const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/vet/vetListThreads';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (qs: Record<string, string> = {}, vetId = 'vet-123'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    queryStringParameters: qs,
    requestContext: {
      authorizer: { jwt: { claims: { sub: vetId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const threadMeta = {
  PK: 'THREAD#thread-1', SK: 'METADATA',
  threadId: 'thread-1', type: 'ask_a_vet', status: 'open',
  ownerId: 'owner-1', vetId: 'vet-123', dogId: 'dog-1',
  createdAt: '2026-04-15T10:00:00Z',
  GSI2PK: 'VET#vet-123', GSI2SK: 'THREAD#open#2026-04-15T10:00:00Z',
};

const ownerProfile = { PK: 'OWNER#owner-1', SK: 'PROFILE', userId: 'owner-1', firstName: 'Joshua', lastName: 'Smith' };
const dogProfile = { PK: 'DOG#dog-1', SK: 'PROFILE', dogId: 'dog-1', name: 'Buddy', breed: 'Golden Retriever', ageMonths: 3 };
const ownerSub = { PK: 'OWNER#owner-1', SK: 'SUBSCRIPTION', plan: 'proactive' };

const lastMsg = {
  PK: 'THREAD#thread-1', SK: 'MSG#1713178800000#msg-1',
  messageId: 'msg-1', senderType: 'owner', body: 'Hi doc', readAt: null, createdAt: '2026-04-15T10:10:00Z',
};

describe('vetListThreads handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns empty list when no threads', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });
    const res = (await handler(makeEvent())) as Result;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).threads).toHaveLength(0);
  });

  it('returns threads enriched with owner, dog, lastMessage, isPriority', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [threadMeta] });
    mockDocClientSend.mockResolvedValueOnce({
      Responses: { 'furcircle-test': [ownerProfile, dogProfile, ownerSub] },
    });
    mockDocClientSend.mockResolvedValueOnce({ Items: [lastMsg] });

    const res = (await handler(makeEvent())) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0].owner.firstName).toBe('Joshua');
    expect(body.threads[0].dog.name).toBe('Buddy');
    expect(body.threads[0].lastMessage.body).toBe('Hi doc');
    expect(body.threads[0].isPriority).toBe(true);
  });

  it('isPriority false for welcome plan owner', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [threadMeta] });
    mockDocClientSend.mockResolvedValueOnce({
      Responses: { 'furcircle-test': [ownerProfile, dogProfile, { ...ownerSub, plan: 'welcome' }] },
    });
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });

    const res = (await handler(makeEvent())) as Result;
    expect(JSON.parse(res.body).threads[0].isPriority).toBe(false);
  });
});
