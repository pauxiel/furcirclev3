const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/bookings/getBooking';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (
  bookingId: string,
  userId = 'owner-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { bookingId },
    queryStringParameters: undefined,
    requestContext: {
      authorizer: { jwt: { claims: { sub: userId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const bookingRow = {
  PK: 'BOOKING#booking-1',
  SK: 'BOOKING',
  bookingId: 'booking-1',
  ownerId: 'owner-123',
  vetId: 'vet-123',
  dogId: 'dog-123',
  duration: 30,
  scheduledAt: '2026-04-18T10:00:00Z',
  status: 'upcoming',
  creditsDeducted: 30,
  agoraChannelId: 'furcircle-booking-booking-1',
  postCallSummary: null,
  createdAt: '2026-04-15T10:00:00Z',
};

describe('getBooking handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 404 when booking not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const res = (await handler(makeEvent('booking-999'))) as Result;
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe('NOT_FOUND');
  });

  it('returns 403 when ownerId does not match authenticated user', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: bookingRow });

    const res = (await handler(makeEvent('booking-1', 'other-owner'))) as Result;
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('FORBIDDEN');
  });

  it('returns 200 with full booking including agoraChannelId and postCallSummary', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: bookingRow });

    const res = (await handler(makeEvent('booking-1'))) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.bookingId).toBe('booking-1');
    expect(body.agoraChannelId).toBe('furcircle-booking-booking-1');
    expect(body.postCallSummary).toBeNull();
  });
});
