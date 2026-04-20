const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/vet/vetGetDashboard';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (vetId = 'vet-1'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    queryStringParameters: {},
    requestContext: {
      authorizer: { jwt: { claims: { sub: vetId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

beforeEach(() => {
  mockDocClientSend.mockReset();
  process.env['TABLE_NAME'] = 'test-table';
});

describe('vetGetDashboard', () => {
  it('returns counts for assessments, bookings, threads', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Count: 2 })
      .mockResolvedValueOnce({ Count: 1 })
      .mockResolvedValueOnce({ Count: 3 });

    const res = await handler(makeEvent()) as Result;
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.pendingAssessments).toBe(2);
    expect(body.upcomingBookings).toBe(1);
    expect(body.openThreads).toBe(3);
  });

  it('returns zeros when no data', async () => {
    mockDocClientSend.mockResolvedValue({ Count: 0 });

    const res = await handler(makeEvent()) as Result;
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.pendingAssessments).toBe(0);
    expect(body.upcomingBookings).toBe(0);
    expect(body.openThreads).toBe(0);
  });
});
