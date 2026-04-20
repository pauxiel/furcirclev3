const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/vet/vetMarkThreadRead';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (threadId: string, vetId = 'vet-123'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { threadId },
    requestContext: {
      authorizer: { jwt: { claims: { sub: vetId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const openThread = {
  PK: 'THREAD#thread-1', SK: 'METADATA',
  threadId: 'thread-1', status: 'open', ownerId: 'owner-1', vetId: 'vet-123', dogId: 'dog-1',
};

const unreadOwnerMsg = {
  PK: 'THREAD#thread-1', SK: 'MSG#1#msg-1',
  messageId: 'msg-1', senderType: 'owner', body: 'Hi', readAt: null,
};
const alreadyReadMsg = {
  PK: 'THREAD#thread-1', SK: 'MSG#2#msg-2',
  messageId: 'msg-2', senderType: 'owner', body: 'Again', readAt: '2026-04-15T10:05:00Z',
};
const vetMsg = {
  PK: 'THREAD#thread-1', SK: 'MSG#3#msg-3',
  messageId: 'msg-3', senderType: 'vet', body: 'Reply', readAt: null,
};

describe('vetMarkThreadRead handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 404 when thread not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });
    const res = (await handler(makeEvent('thread-999'))) as Result;
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when vet does not own thread', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...openThread, vetId: 'other-vet' } });
    const res = (await handler(makeEvent('thread-1'))) as Result;
    expect(res.statusCode).toBe(403);
  });

  it('returns 200 with count of messages marked read', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: openThread });
    mockDocClientSend.mockResolvedValueOnce({ Items: [unreadOwnerMsg, alreadyReadMsg, vetMsg] });
    mockDocClientSend.mockResolvedValue({});

    const res = (await handler(makeEvent('thread-1'))) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.threadId).toBe('thread-1');
    expect(body.markedRead).toBe(1);
  });

  it('returns 0 when no unread owner messages', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: openThread });
    mockDocClientSend.mockResolvedValueOnce({ Items: [alreadyReadMsg, vetMsg] });

    const res = (await handler(makeEvent('thread-1'))) as Result;
    expect(JSON.parse(res.body).markedRead).toBe(0);
  });
});
