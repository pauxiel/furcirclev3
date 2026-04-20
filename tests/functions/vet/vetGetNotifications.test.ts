const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/vet/vetGetNotifications';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (vetId = 'vet-1'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    queryStringParameters: {},
    requestContext: {
      authorizer: { jwt: { claims: { sub: vetId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

beforeEach(() => {
  mockDocClientSend.mockReset();
  process.env['TABLE_NAME'] = 'test-table';
});

describe('vetGetNotifications', () => {
  it('returns list of notifications ordered by createdAt desc', async () => {
    const items = [
      { PK: 'VET#vet-1', SK: 'NOTIF#n2', notifId: 'n2', type: 'new_assessment', readAt: null, createdAt: '2026-04-19T10:00:00Z' },
      { PK: 'VET#vet-1', SK: 'NOTIF#n1', notifId: 'n1', type: 'new_booking', readAt: '2026-04-18T09:00:00Z', createdAt: '2026-04-18T09:00:00Z' },
    ];
    mockDocClientSend.mockResolvedValueOnce({ Items: items });

    const res = await handler(makeEvent()) as Result;
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.notifications).toHaveLength(2);
    expect(body.notifications[0].notifId).toBe('n2');
    expect(body.notifications[0].readAt).toBeNull();
    expect(body.notifications[1].readAt).toBe('2026-04-18T09:00:00Z');
  });

  it('returns empty array when no notifications', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });

    const res = await handler(makeEvent()) as Result;
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.notifications).toHaveLength(0);
  });
});
