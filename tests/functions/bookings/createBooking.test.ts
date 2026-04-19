const mockDocClientSend = jest.fn();
const mockSnsSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn().mockImplementation(() => ({ send: (...args: unknown[]) => mockSnsSend(...args) })),
  PublishCommand: jest.fn().mockImplementation((input: unknown) => input),
}));

jest.mock('uuid', () => ({ v4: () => 'booking-uuid-123' }));

import { handler } from '../../../src/functions/bookings/createBooking';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const FUTURE = new Date(Date.now() + 86400000 * 2).toISOString(); // 2 days from now

const makeEvent = (
  body: Record<string, unknown>,
  userId = 'owner-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    body: JSON.stringify(body),
    pathParameters: {},
    queryStringParameters: undefined,
    requestContext: {
      authorizer: { jwt: { claims: { sub: userId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const validBody = {
  vetId: 'vet-123',
  dogId: 'dog-123',
  assessmentId: 'assess-123',
  duration: 30,
  scheduledAt: FUTURE,
};

const subRow = { PK: 'OWNER#owner-123', SK: 'SUBSCRIPTION', plan: 'proactive', creditBalance: 70 };
const assessmentRow = { assessmentId: 'assess-123', ownerId: 'owner-123', vetId: 'vet-123', status: 'approved' };
const vetRow = { PK: 'VET#vet-123', SK: 'PROFILE', vetId: 'vet-123', providerType: 'behaviourist', firstName: 'Emma', lastName: 'Clarke', photoUrl: null };
const availRow = {
  PK: 'VET#vet-123',
  SK: `AVAIL#${FUTURE.substring(0, 10)}`,
  vetId: 'vet-123',
  date: FUTURE.substring(0, 10),
  slots: [{ time: FUTURE.substring(11, 16), available: true, duration: [15, 30] }],
};

describe('createBooking handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
    process.env['SNS_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:123:furcircle-test';
  });

  it('returns 400 when duration is not 15 or 30', async () => {
    const res = (await handler(makeEvent({ ...validBody, duration: 45 }))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when scheduledAt is in the past', async () => {
    const past = new Date(Date.now() - 3600000).toISOString();
    const res = (await handler(makeEvent({ ...validBody, scheduledAt: past }))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('VALIDATION_ERROR');
  });

  it('returns 403 when owner plan is not proactive', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...subRow, plan: 'protector' } });

    const res = (await handler(makeEvent(validBody))) as Result;
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe('FORBIDDEN');
  });

  it('returns 402 when creditBalance < duration', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...subRow, creditBalance: 15 } });

    const res = (await handler(makeEvent({ ...validBody, duration: 30 }))) as Result;
    expect(res.statusCode).toBe(402);
    expect(JSON.parse(res.body).error).toBe('INSUFFICIENT_CREDITS');
  });

  it('returns 400 when behaviourist booking has no approved assessment', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: subRow })
      .mockResolvedValueOnce({ Item: vetRow })
      .mockResolvedValueOnce({ Item: { ...assessmentRow, status: 'pending' } });

    const res = (await handler(makeEvent(validBody))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('ASSESSMENT_REQUIRED');
  });

  it('returns 409 when slot is unavailable', async () => {
    const unavailRow = {
      ...availRow,
      slots: [{ time: FUTURE.substring(11, 16), available: false, duration: [15, 30] }],
    };
    mockDocClientSend
      .mockResolvedValueOnce({ Item: subRow })
      .mockResolvedValueOnce({ Item: vetRow })
      .mockResolvedValueOnce({ Item: assessmentRow })
      .mockResolvedValueOnce({ Item: unavailRow });

    const res = (await handler(makeEvent(validBody))) as Result;
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe('SLOT_UNAVAILABLE');
  });

  it('returns 201 with booking details and deducts credits', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: subRow })           // GetItem subscription
      .mockResolvedValueOnce({ Item: vetRow })            // GetItem vet
      .mockResolvedValueOnce({ Item: assessmentRow })     // GetItem assessment
      .mockResolvedValueOnce({ Item: availRow })          // GetItem availability
      .mockResolvedValueOnce({ Attributes: { creditBalance: 40 } }) // UpdateItem credits (conditional)
      .mockResolvedValueOnce({})                          // UpdateItem availability
      .mockResolvedValueOnce({});                         // PutItem booking

    const res = (await handler(makeEvent(validBody))) as Result;
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.bookingId).toBe('booking-uuid-123');
    expect(body.agoraChannelId).toBe('furcircle-booking-booking-uuid-123');
    expect(body.creditsDeducted).toBe(30);
    expect(body.creditBalance).toBe(40);
  });

  it('returns 201 even when SNS publish fails', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: subRow })
      .mockResolvedValueOnce({ Item: vetRow })
      .mockResolvedValueOnce({ Item: assessmentRow })
      .mockResolvedValueOnce({ Item: availRow })
      .mockResolvedValueOnce({ Attributes: { creditBalance: 40 } })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    mockSnsSend.mockRejectedValue(new Error('SNS down'));

    const res = (await handler(makeEvent(validBody))) as Result;
    expect(res.statusCode).toBe(201);
  });
});
