const mockDocClientSend = jest.fn();
const mockSnsSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn().mockImplementation(() => ({ send: (...args: unknown[]) => mockSnsSend(...args) })),
  PublishCommand: jest.fn(),
}));

import { handler } from '../../../src/functions/vet/vetSendMessage';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (threadId: string, body: Record<string, unknown>, vetId = 'vet-123'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { threadId },
    body: JSON.stringify(body),
    requestContext: {
      authorizer: { jwt: { claims: { sub: vetId, 'cognito:groups': 'vets' }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const openThread = {
  PK: 'THREAD#thread-1', SK: 'METADATA',
  threadId: 'thread-1', status: 'open', ownerId: 'owner-1', vetId: 'vet-123', dogId: 'dog-1',
};

// Ask-a-Vet group thread: shared, no owning vet (vetId === null).
const groupThread = {
  PK: 'THREAD#thread-1', SK: 'METADATA',
  threadId: 'thread-1', status: 'open', ownerId: 'owner-1', vetId: null, dogId: 'dog-1',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('vetSendMessage handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    process.env['SNS_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:123:test';
    mockSnsSend.mockResolvedValue({});
  });

  it('returns 403 when caller is not in the vets group', async () => {
    const nonVetEvent = {
      pathParameters: { threadId: 'thread-1' },
      body: JSON.stringify({ body: 'I am an owner pretending to be a vet' }),
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'owner-1', 'cognito:groups': 'owners' }, scopes: [] }, principalId: '', integrationLatency: 0 },
      },
    } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;

    const res = (await handler(nonVetEvent)) as Result;
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('FORBIDDEN');
    // Rejected before any DynamoDB access.
    expect(mockDocClientSend).not.toHaveBeenCalled();
  });

  it('returns 400 when body is empty', async () => {
    const res = (await handler(makeEvent('thread-1', { body: '' }))) as Result;
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when body exceeds 2000 chars', async () => {
    const res = (await handler(makeEvent('thread-1', { body: 'x'.repeat(2001) }))) as Result;
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when thread not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });
    const res = (await handler(makeEvent('thread-999', { body: 'Hello' }))) as Result;
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when vet does not own thread', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...openThread, vetId: 'other-vet' } });
    const res = (await handler(makeEvent('thread-1', { body: 'Hello' }))) as Result;
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('FORBIDDEN');
  });

  it('returns 403 when thread is closed', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...openThread, status: 'closed' } });
    const res = (await handler(makeEvent('thread-1', { body: 'Hello' }))) as Result;
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('THREAD_CLOSED');
  });

  it('returns 201 with message on success', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: openThread });
    mockDocClientSend.mockResolvedValueOnce({});

    const res = (await handler(makeEvent('thread-1', { body: 'Hi Joshua!' }))) as Result;
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.senderType).toBe('vet');
    expect(body.body).toBe('Hi Joshua!');
  });

  it('lets any vet reply to a shared group thread without claiming it', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: groupThread }) // Get metadata
      .mockResolvedValueOnce({});                   // Put message

    const res = (await handler(makeEvent('thread-1', { body: 'Happy to help!' }, 'vet-999'))) as Result;
    expect(res.statusCode).toBe(201);

    // No claim: the only writes are the Get (metadata) and the Put (message);
    // the thread metadata is never updated to assign a vet.
    expect(mockDocClientSend).toHaveBeenCalledTimes(2);
    const put = mockDocClientSend.mock.calls[1][0];
    const input = (put.input ?? put) as Record<string, any>;
    expect(input.Item.senderType).toBe('vet');
    expect(input.Item.senderId).toBe('vet-999');
  });

  it('lets a second vet also reply to the same group thread', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: groupThread }) // Get metadata
      .mockResolvedValueOnce({});                   // Put message

    const res = (await handler(makeEvent('thread-1', { body: 'Adding to that...' }, 'vet-888'))) as Result;
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).senderType).toBe('vet');
  });
});
