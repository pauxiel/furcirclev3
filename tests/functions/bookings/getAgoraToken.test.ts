const mockDocClientSend = jest.fn();
const mockGenerateRtcToken = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('../../../src/lib/agora', () => ({
  generateRtcToken: (...args: unknown[]) => mockGenerateRtcToken(...args),
}));

import { handler } from '../../../src/functions/bookings/getAgoraToken';
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

// scheduledAt within ±30 min of now
const withinWindow = new Date(Date.now() + 10 * 60 * 1000).toISOString();
// scheduledAt more than 30 min in the future
const tooEarly = new Date(Date.now() + 60 * 60 * 1000).toISOString();

const bookingRow = (scheduledAt: string, status = 'upcoming') => ({
  PK: 'BOOKING#booking-1',
  SK: 'BOOKING',
  bookingId: 'booking-1',
  ownerId: 'owner-123',
  vetId: 'vet-123',
  duration: 30,
  scheduledAt,
  status,
  agoraChannelId: 'furcircle-booking-booking-1',
});

describe('getAgoraToken handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    mockGenerateRtcToken.mockResolvedValue({ token: '006mockToken', appId: 'test-app-id' });
  });

  it('returns 404 when booking not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const res = (await handler(makeEvent('booking-999'))) as Result;
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe('NOT_FOUND');
  });

  it('returns 403 when user is neither owner nor vet', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: bookingRow(withinWindow) });

    const res = (await handler(makeEvent('booking-1', 'random-user'))) as Result;
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('FORBIDDEN');
  });

  it('returns 400 when booking status is not upcoming', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: bookingRow(withinWindow, 'completed') });

    const res = (await handler(makeEvent('booking-1'))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('INVALID_STATUS');
  });

  it('returns 403 TOO_EARLY when scheduledAt is more than 30 min away', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: bookingRow(tooEarly) });

    const res = (await handler(makeEvent('booking-1'))) as Result;
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('TOO_EARLY');
  });

  it('returns 200 with valid token shape for booking owner', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: bookingRow(withinWindow) });

    const res = (await handler(makeEvent('booking-1', 'owner-123'))) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toBe('006mockToken');
    expect(body.channelId).toBe('furcircle-booking-booking-1');
    expect(body.appId).toBe('test-app-id');
    expect(typeof body.uid).toBe('number');
    expect(body.expiresAt).toBeDefined();
  });

  it('returns 200 for vet accessing their own booking', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: bookingRow(withinWindow) });

    const res = (await handler(makeEvent('booking-1', 'vet-123'))) as Result;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).token).toBe('006mockToken');
  });
});
