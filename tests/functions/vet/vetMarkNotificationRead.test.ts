const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/vet/vetMarkNotificationRead';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (vetId = 'vet-1', notifId = 'notif-1'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { notifId },
    queryStringParameters: {},
    requestContext: {
      authorizer: { jwt: { claims: { sub: vetId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

beforeEach(() => {
  mockDocClientSend.mockReset();
  process.env['TABLE_NAME'] = 'test-table';
});

describe('vetMarkNotificationRead', () => {
  it('marks notification read and returns updated item', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: { PK: 'VET#vet-1', SK: 'NOTIF#notif-1', notifId: 'notif-1', vetId: 'vet-1', readAt: null } })
      .mockResolvedValueOnce({});

    const res = await handler(makeEvent()) as Result;
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.notifId).toBe('notif-1');
    expect(body.readAt).toBeTruthy();
  });

  it('returns 404 when notification not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const res = await handler(makeEvent()) as Result;
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when notification belongs to different vet', async () => {
    mockDocClientSend.mockResolvedValueOnce({
      Item: { PK: 'VET#other-vet', SK: 'NOTIF#notif-1', notifId: 'notif-1', vetId: 'other-vet', readAt: null },
    });

    const res = await handler(makeEvent('vet-1', 'notif-1')) as Result;
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when notifId is missing', async () => {
    const event = { ...makeEvent() } as any;
    event.pathParameters = {};
    const res = await handler(event) as Result;
    expect(res.statusCode).toBe(400);
  });
});
