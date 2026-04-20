const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/vet/vetGetAvailability';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (qs: Record<string, string>, vetId = 'vet-123'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    queryStringParameters: qs,
    requestContext: {
      authorizer: { jwt: { claims: { sub: vetId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

describe('vetGetAvailability handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 400 when startDate missing', async () => {
    const res = (await handler(makeEvent({ endDate: '2026-04-25' }))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when endDate missing', async () => {
    const res = (await handler(makeEvent({ startDate: '2026-04-20' }))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when date range exceeds 30 days', async () => {
    const res = (await handler(makeEvent({ startDate: '2026-04-01', endDate: '2026-05-15' }))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('DATE_RANGE_TOO_LARGE');
  });

  it('returns availability with empty slots for missing dates', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });

    const res = (await handler(makeEvent({ startDate: '2026-04-20', endDate: '2026-04-22' }))) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.vetId).toBe('vet-123');
    expect(body.availability).toHaveLength(3);
    expect(body.availability[0].date).toBe('2026-04-20');
    expect(body.availability[0].slots).toEqual([]);
  });

  it('merges DynamoDB records with date range', async () => {
    mockDocClientSend.mockResolvedValueOnce({
      Items: [
        {
          SK: 'AVAIL#2026-04-21',
          slots: [{ time: '09:00', available: true }],
        },
      ],
    });

    const res = (await handler(makeEvent({ startDate: '2026-04-20', endDate: '2026-04-22' }))) as Result;
    const body = JSON.parse(res.body);
    expect(body.availability[0].slots).toEqual([]);
    expect(body.availability[1].slots).toHaveLength(1);
    expect(body.availability[1].slots[0].time).toBe('09:00');
    expect(body.availability[2].slots).toEqual([]);
  });
});
