const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/vet/vetBulkSetAvailability';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (body: Record<string, unknown>, vetId = 'vet-123'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    body: JSON.stringify(body),
    requestContext: {
      authorizer: { jwt: { claims: { sub: vetId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const futureEntry = (date: string) => ({
  date,
  slots: [{ time: '09:00', available: true }, { time: '10:00', available: true }],
});

describe('vetBulkSetAvailability handler', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 400 when dates array missing', async () => {
    const res = (await handler(makeEvent({}))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when dates exceed 30', async () => {
    const dates = Array.from({ length: 31 }, (_, i) => futureEntry(`2026-12-${String(i + 1).padStart(2, '0')}`));
    const res = (await handler(makeEvent({ dates }))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('TOO_MANY_DATES');
  });

  it('returns 400 for past date in batch', async () => {
    const res = (await handler(makeEvent({ dates: [futureEntry('2020-01-01')] }))) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('PAST_DATE');
  });

  it('returns 400 for invalid time in batch', async () => {
    const res = (await handler(
      makeEvent({ dates: [{ date: '2026-12-01', slots: [{ time: '09:15', available: true }] }] }),
    )) as Result;
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('INVALID_TIME');
  });

  it('returns 200 with updated count on success', async () => {
    mockDocClientSend.mockResolvedValue({});

    const res = (await handler(makeEvent({ dates: [futureEntry('2026-12-01'), futureEntry('2026-12-02')] }))) as Result;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.updated).toBe(2);
    expect(body.skipped).toBe(0);
  });
});
