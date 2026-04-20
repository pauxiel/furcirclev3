const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/admin/adminListVets';
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
  process.env['TABLE_NAME'] = 'test-table';
});

describe('adminListVets', () => {
  it('returns list of vets', async () => {
    mockDocClientSend.mockResolvedValueOnce({
      Items: [
        { PK: 'VET#v1', SK: 'PROFILE', vetId: 'v1', firstName: 'Dr. Sarah', providerType: 'vet', isActive: true, rating: 4.8 },
        { PK: 'VET#v2', SK: 'PROFILE', vetId: 'v2', firstName: 'Dr. James', providerType: 'behaviourist', isActive: false, rating: 4.2 },
      ],
    });

    const res = await handler(makeEvent()) as Result;
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.vets).toHaveLength(2);
    expect(body.vets[0].vetId).toBe('v1');
  });

  it('returns 403 for non-admin', async () => {
    const res = await handler(makeEvent('owners')) as Result;
    expect(res.statusCode).toBe(403);
  });
});
