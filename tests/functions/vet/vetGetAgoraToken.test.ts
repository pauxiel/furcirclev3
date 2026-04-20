const mockDocClientSend = jest.fn();
const mockGenerateRtcToken = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('../../../src/lib/agora', () => ({
  generateRtcToken: (...args: unknown[]) => mockGenerateRtcToken(...args),
}));

import { handler } from '../../../src/functions/vet/vetGetAgoraToken';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (bookingId: string, vetId = 'vet-123'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { bookingId },
    requestContext: {
      authorizer: { jwt: { claims: { sub: vetId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const withinWindow = new Date(Date.now() + 10 * 60 * 1000).toISOString();
const tooEarly = new Date(Date.now() + 60 * 60 * 1000).toISOString();

const bookingRow = (scheduledAt: string, status = 'upcoming') => ({
  PK: 'BOOKING#booking-1', SK: 'BOOKING',
  bookingId: 'booking-1', ownerId: 'owner-1', vetId: 'vet-123',
  duration: 30, scheduledAt, status,
  agoraChannelId: 'furcircle-booking-booking-1',
});

describe('vetGetAgoraToken handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    mockGenerateRtcToken.mockResolvedValue({ token: '006mockToken', appId: 'test-app-id' });
  });

  it('returns 404 when booking not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });
    const res = (await handler(makeEvent('booking-999'))) as Result;
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 when vet does not own booking', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: bookingRow(withinWindow) });
    const res = (await handler(makeEvent('booking-1', 'other-vet'))) as Result;
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('FORBIDDEN');
  });

  it('returns 400 when booking is not upcoming', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: bookingRow(withinWindow, 'completed') });
    const res = (await handler(makeEvent('booking-1'))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('INVALID_STATUS');
  });

  it('returns 403 TOO_EARLY when more than 30 min away', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: bookingRow(tooEarly) });
    const res = (await handler(makeEvent('booking-1'))) as Result;
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('TOO_EARLY');
  });

  it('returns 200 with valid token for vet', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: bookingRow(withinWindow) });
    const res = (await handler(makeEvent('booking-1', 'vet-123'))) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toBe('006mockToken');
    expect(body.channelId).toBe('furcircle-booking-booking-1');
    expect(typeof body.uid).toBe('number');
  });
});
