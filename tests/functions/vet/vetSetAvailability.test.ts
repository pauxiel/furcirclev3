const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/vet/vetSetAvailability';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (
  date: string,
  body: Record<string, unknown>,
  vetId = 'vet-123',
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { date },
    body: JSON.stringify(body),
    requestContext: {
      authorizer: { jwt: { claims: { sub: vetId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const futureDate = '2026-12-01';
const validSlots = [
  { time: '09:00', available: true },
  { time: '09:30', available: true },
  { time: '10:00', available: true },
];

describe('vetSetAvailability handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 400 for past date', async () => {
    const res = (await handler(makeEvent('2020-01-01', { slots: validSlots }))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('PAST_DATE');
  });

  it('returns 400 for invalid time format (not 30-min boundary)', async () => {
    const res = (await handler(makeEvent(futureDate, { slots: [{ time: '09:15', available: true }] }))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('INVALID_TIME');
  });

  it('returns 409 when trying to modify a booked slot', async () => {
    mockDocClientSend.mockResolvedValueOnce({
      Item: {
        slots: [{ time: '09:00', available: false }],
      },
    });

    const res = (await handler(makeEvent(futureDate, { slots: [{ time: '09:00', available: true }] }))) as Result;
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toBe('SLOT_BOOKED');
  });

  it('returns 200 on successful set', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });
    mockDocClientSend.mockResolvedValueOnce({});

    const res = (await handler(makeEvent(futureDate, { slots: validSlots }))) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.date).toBe(futureDate);
    expect(body.slots).toHaveLength(3);
  });

  it('allows free slot modifications when existing record present', async () => {
    mockDocClientSend.mockResolvedValueOnce({
      Item: { slots: [{ time: '09:00', available: true }, { time: '10:00', available: false }] },
    });
    mockDocClientSend.mockResolvedValueOnce({});

    const res = (await handler(makeEvent(futureDate, { slots: [{ time: '09:00', available: false }] }))) as Result;
    expect(res.statusCode).toBe(200);
  });
});
