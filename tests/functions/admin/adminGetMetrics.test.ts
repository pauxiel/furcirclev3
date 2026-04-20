const mockDocClientSend = jest.fn();
const mockCognitoSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));
jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({ send: (...args: unknown[]) => mockCognitoSend(...args) })),
  ListUsersInGroupCommand: jest.fn(),
}));

import { handler } from '../../../src/functions/admin/adminGetMetrics';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (groups = 'admins'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    queryStringParameters: {},
    requestContext: {
      authorizer: {
        jwt: { claims: { sub: 'admin-1', 'cognito:groups': groups }, scopes: [] },
        principalId: '', integrationLatency: 0,
      },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

beforeEach(() => {
  mockDocClientSend.mockReset();
  mockCognitoSend.mockReset();
  process.env['TABLE_NAME'] = 'test-table';
  process.env['USER_POOL_ID'] = 'us-east-1_test';
});

describe('adminGetMetrics', () => {
  it('returns platform metrics for admin', async () => {
    mockCognitoSend.mockResolvedValueOnce({ Users: [1, 2, 3] });
    mockDocClientSend
      .mockResolvedValueOnce({ Count: 5 })
      .mockResolvedValueOnce({ Count: 2 });

    const res = await handler(makeEvent()) as Result;
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.totalOwners).toBe(3);
    expect(body.activeSubscriptions).toBe(5);
    expect(body.bookingsToday).toBe(2);
  });

  it('returns 403 for non-admin', async () => {
    const res = await handler(makeEvent('owners')) as Result;
    expect(res.statusCode).toBe(403);
  });
});
