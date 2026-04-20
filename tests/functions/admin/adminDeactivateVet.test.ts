const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/admin/adminDeactivateVet';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (vetId = 'v1', groups = 'admins'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { vetId },
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

describe('adminDeactivateVet', () => {
  it('deactivates vet and returns updated status', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: { PK: 'VET#v1', SK: 'PROFILE', vetId: 'v1', isActive: true } })
      .mockResolvedValueOnce({});

    const res = await handler(makeEvent()) as Result;
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.vetId).toBe('v1');
    expect(body.isActive).toBe(false);
  });

  it('returns 404 when vet not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });
    const res = await handler(makeEvent()) as Result;
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 for non-admin', async () => {
    const res = await handler(makeEvent('v1', 'owners')) as Result;
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when vetId missing', async () => {
    const event = makeEvent() as any;
    event.pathParameters = {};
    const res = await handler(event) as Result;
    expect(res.statusCode).toBe(400);
  });
});
