const mockDocClientSend = jest.fn();
const mockSnsSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn().mockImplementation(() => ({ send: (...args: unknown[]) => mockSnsSend(...args) })),
  PublishCommand: jest.fn(),
}));

import { handler } from '../../../src/functions/vet/vetCloseThread';
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

describe('vetCloseThread handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    process.env['SNS_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:123:test';
    mockSnsSend.mockResolvedValue({});
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

  it('returns 400 when thread already closed', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...openThread, status: 'closed' } });
    const res = (await handler(makeEvent('thread-1'))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('ALREADY_CLOSED');
  });

  it('returns 200 with closed status', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: openThread });
    mockDocClientSend.mockResolvedValueOnce({});

    const res = (await handler(makeEvent('thread-1'))) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.threadId).toBe('thread-1');
    expect(body.status).toBe('closed');
    expect(body.closedAt).toBeDefined();
  });
});
