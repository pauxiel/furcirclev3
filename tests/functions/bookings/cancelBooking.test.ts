const mockDocClientSend = jest.fn();
const mockSnsSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn().mockImplementation(() => ({ send: (...args: unknown[]) => mockSnsSend(...args) })),
  PublishCommand: jest.fn().mockImplementation((input: unknown) => input),
}));

import { handler } from '../../../src/functions/bookings/cancelBooking';
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

const future48h = new Date(Date.now() + 86400000 * 2).toISOString();
const future12h = new Date(Date.now() + 3600000 * 12).toISOString();

const bookingRow = (scheduledAt: string, status = 'upcoming') => ({
  PK: 'BOOKING#booking-1',
  SK: 'BOOKING',
  bookingId: 'booking-1',
  ownerId: 'owner-123',
  vetId: 'vet-123',
  dogId: 'dog-123',
  duration: 30,
  scheduledAt,
  status,
  creditsDeducted: 30,
  agoraChannelId: 'furcircle-booking-booking-1',
  createdAt: '2026-04-15T10:00:00Z',
});

const availRow = (scheduledAt: string) => ({
  PK: 'VET#vet-123',
  SK: `AVAIL#${scheduledAt.substring(0, 10)}`,
  vetId: 'vet-123',
  date: scheduledAt.substring(0, 10),
  slots: [{ time: scheduledAt.substring(11, 16), available: false, duration: [15, 30] }],
});

describe('cancelBooking handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    process.env['SNS_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:123:furcircle-test';
  });

  it('returns 404 when booking not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const res = (await handler(makeEvent('booking-999'))) as Result;
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe('NOT_FOUND');
  });

  it('returns 403 when ownerId does not match authenticated user', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: bookingRow(future48h) });

    const res = (await handler(makeEvent('booking-1', 'other-owner'))) as Result;
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('FORBIDDEN');
  });

  it('returns 400 when booking status is not upcoming', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: bookingRow(future48h, 'cancelled') });

    const res = (await handler(makeEvent('booking-1'))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('INVALID_STATUS');
  });

  it('refunds credits when cancelled > 24h before scheduledAt', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: bookingRow(future48h) })   // GetItem booking
      .mockResolvedValueOnce({})                                  // UpdateItem booking status=cancelled
      .mockResolvedValueOnce({ Attributes: { creditBalance: 70 } }) // UpdateItem refund credits
      .mockResolvedValueOnce({ Item: availRow(future48h) })      // GetItem availability
      .mockResolvedValueOnce({});                                 // UpdateItem restore slot

    const res = (await handler(makeEvent('booking-1'))) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.creditsRefunded).toBe(30);
    expect(body.creditBalance).toBe(70);
  });

  it('no credit refund when cancelled <= 24h before scheduledAt', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: bookingRow(future12h) })
      .mockResolvedValueOnce({})                      // UpdateItem booking
      .mockResolvedValueOnce({ Item: availRow(future12h) }) // GetItem availability
      .mockResolvedValueOnce({});                     // UpdateItem restore slot

    const res = (await handler(makeEvent('booking-1'))) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.creditsRefunded).toBe(0);
  });

  it('returns 200 even when SNS publish fails', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: bookingRow(future48h) })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Attributes: { creditBalance: 70 } })
      .mockResolvedValueOnce({ Item: availRow(future48h) })
      .mockResolvedValueOnce({});
    mockSnsSend.mockRejectedValue(new Error('SNS down'));

    const res = (await handler(makeEvent('booking-1'))) as Result;
    expect(res.statusCode).toBe(200);
  });
});
