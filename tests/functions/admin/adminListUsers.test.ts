const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/admin/adminListUsers';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (groups = 'admins', qs: Record<string, string> = {}): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    queryStringParameters: qs,
    requestContext: {
      authorizer: {
        jwt: { claims: { sub: 'admin-1', 'cognito:groups': groups }, scopes: [] },
        principalId: '', integrationLatency: 0,
      },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const ownerProfile = {
  PK: 'OWNER#u1', SK: 'PROFILE',
  userId: 'u1', firstName: 'Alice', lastName: 'Jones', email: 'alice@test.com', createdAt: '2026-04-01T00:00:00Z',
};
const ownerSub = {
  PK: 'OWNER#u1', SK: 'SUBSCRIPTION',
  plan: 'proactive', creditBalance: 70, status: 'active',
};

beforeEach(() => {
  mockDocClientSend.mockReset();
  process.env['TABLE_NAME'] = 'test-table';
});

describe('adminListUsers', () => {
  it('returns list of owners with subscription', async () => {
    mockDocClientSend.mockResolvedValueOnce({
      Items: [ownerProfile, ownerSub],
    });

    const res = await handler(makeEvent()) as Result;
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.users).toHaveLength(1);
    expect(body.users[0].userId).toBe('u1');
    expect(body.users[0].subscription.plan).toBe('proactive');
  });

  it('returns 403 for non-admin', async () => {
    const res = await handler(makeEvent('owners')) as Result;
    expect(res.statusCode).toBe(403);
  });
});
