const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/admin/adminListBookings';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (groups = 'admins', qs: Record<string, string> = {}): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    queryStringParameters: qs,
    requestContext: {
      authorizer: {
        jwt: { claims: { sub: 'admin-1', 'cognito:groups': groups }, scopes: [] },
        principalId: '', integrationLatency: 0,
      },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const booking = {
  PK: 'BOOKING#b1', SK: 'BOOKING',
  bookingId: 'b1', vetId: 'v1', ownerId: 'u1', dogId: 'd1',
  status: 'upcoming', scheduledAt: '2026-04-25T10:00:00Z', duration: 30,
};

beforeEach(() => {
  mockDocClientSend.mockReset();
  process.env['TABLE_NAME'] = 'test-table';
});

describe('adminListBookings', () => {
  it('returns all bookings', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [booking] });

    const res = await handler(makeEvent()) as Result;
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.bookings).toHaveLength(1);
    expect(body.bookings[0].bookingId).toBe('b1');
  });

  it('returns 403 for non-admin', async () => {
    const res = await handler(makeEvent('owners')) as Result;
    expect(res.statusCode).toBe(403);
  });
});
