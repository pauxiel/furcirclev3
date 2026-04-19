const mockDocClientSend = jest.fn();
const mockSnsSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn().mockImplementation(() => ({ send: (...args: unknown[]) => mockSnsSend(...args) })),
  PublishCommand: jest.fn(),
}));

import { handler } from '../../../src/functions/vet/vetSubmitPostCallSummary';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (bookingId: string, body: Record<string, unknown>, vetId = 'vet-123'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { bookingId },
    body: JSON.stringify(body),
    requestContext: {
      authorizer: { jwt: { claims: { sub: vetId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const validSummary = 'We worked on desensitisation exercises for separation anxiety. Key findings: anxiety triggered by pre-departure cues.';

const booking = {
  PK: 'BOOKING#booking-1', SK: 'BOOKING',
  bookingId: 'booking-1', ownerId: 'owner-1', vetId: 'vet-123', dogId: 'dog-1',
  duration: 30, scheduledAt: '2026-04-19T10:00:00Z', status: 'upcoming',
  agoraChannelId: 'furcircle-booking-booking-1', createdAt: '2026-04-15T10:00:00Z',
};

describe('vetSubmitPostCallSummary handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    process.env['SNS_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:123:test';
    mockSnsSend.mockResolvedValue({});
  });

  it('returns 400 when summary is too short', async () => {
    const res = (await handler(makeEvent('booking-1', { summary: 'Too short.' }))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('SUMMARY_TOO_SHORT');
  });

  it('returns 400 when actionPlan exceeds 10 items', async () => {
    const actionPlan = Array.from({ length: 11 }, (_, i) => `Action ${i}`);
    const res = (await handler(makeEvent('booking-1', { summary: validSummary, actionPlan }))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('TOO_MANY_ACTION_ITEMS');
  });

  it('returns 404 when booking not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });
    const res = (await handler(makeEvent('booking-999', { summary: validSummary }))) as Result;
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe('NOT_FOUND');
  });

  it('returns 403 when vet does not own booking', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...booking, vetId: 'other-vet' } });
    const res = (await handler(makeEvent('booking-1', { summary: validSummary }))) as Result;
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('FORBIDDEN');
  });

  it('returns 400 when booking is already cancelled', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...booking, status: 'cancelled' } });
    const res = (await handler(makeEvent('booking-1', { summary: validSummary }))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('INVALID_STATUS');
  });

  it('returns 200 with followUpThreadId on success', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: booking });
    mockDocClientSend.mockResolvedValue({});

    const res = (await handler(makeEvent('booking-1', { summary: validSummary, actionPlan: ['Do X', 'Do Y'] }))) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.bookingId).toBe('booking-1');
    expect(body.status).toBe('completed');
    expect(body.followUpThreadId).toBeDefined();
    expect(body.submittedAt).toBeDefined();
  });

  it('does not fail when SNS publish fails', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: booking });
    mockDocClientSend.mockResolvedValue({});
    mockSnsSend.mockRejectedValueOnce(new Error('SNS down'));

    const res = (await handler(makeEvent('booking-1', { summary: validSummary }))) as Result;
    expect(res.statusCode).toBe(200);
  });
});
