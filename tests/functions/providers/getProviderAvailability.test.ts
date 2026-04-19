const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/providers/getProviderAvailability';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (
  vetId: string,
  params: Record<string, string> = {},
): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { vetId },
    queryStringParameters: Object.keys(params).length ? params : undefined,
    requestContext: {
      authorizer: { jwt: { claims: { sub: 'owner-123' }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const availRow = {
  PK: 'VET#vet-123',
  SK: 'AVAIL#2026-04-18',
  vetId: 'vet-123',
  date: '2026-04-18',
  slots: [
    { time: '10:00', duration: [15, 30], available: true },
    { time: '10:30', duration: [15, 30], available: false },
  ],
};

describe('getProviderAvailability handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 400 when startDate missing', async () => {
    const res = (await handler(makeEvent('vet-123', { endDate: '2026-04-19' }))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('INVALID_REQUEST');
  });

  it('returns 400 when date range exceeds 14 days', async () => {
    const res = (await handler(
      makeEvent('vet-123', { startDate: '2026-04-01', endDate: '2026-04-20' }),
    )) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('INVALID_REQUEST');
  });

  it('returns 200 with per-date slots', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [availRow] });

    const res = (await handler(
      makeEvent('vet-123', { startDate: '2026-04-18', endDate: '2026-04-19' }),
    )) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.vetId).toBe('vet-123');
    expect(body.availability).toHaveLength(2);
    expect(body.availability[0].date).toBe('2026-04-18');
    expect(body.availability[0].slots).toHaveLength(2);
    expect(body.availability[1].date).toBe('2026-04-19');
    expect(body.availability[1].slots).toHaveLength(0);
  });

  it('returns empty slots for all dates when no availability records', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Items: [] });

    const res = (await handler(
      makeEvent('vet-123', { startDate: '2026-04-18', endDate: '2026-04-18' }),
    )) as Result;
    const body = JSON.parse(res.body);
    expect(body.availability).toHaveLength(1);
    expect(body.availability[0].slots).toHaveLength(0);
  });
});
