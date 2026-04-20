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
      authorizer: { jwt: { claims: { sub: vetId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const openThread = {
  PK: 'THREAD#thread-1', SK: 'METADATA',
  threadId: 'thread-1', status: 'open', ownerId: 'owner-1', vetId: 'vet-123', dogId: 'dog-1',
};

describe('vetSendMessage handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    process.env['SNS_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:123:test';
    mockSnsSend.mockResolvedValue({});
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
});
