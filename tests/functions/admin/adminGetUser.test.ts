const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/admin/adminGetUser';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (userId = 'u1', groups = 'admins'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { userId },
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

describe('adminGetUser', () => {
  it('returns owner profile + subscription + dogs', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({
        Responses: {
          'test-table': [
            { PK: 'OWNER#u1', SK: 'PROFILE', userId: 'u1', firstName: 'Alice', email: 'a@test.com', createdAt: '2026-04-01T00:00:00Z' },
            { PK: 'OWNER#u1', SK: 'SUBSCRIPTION', plan: 'proactive', creditBalance: 70 },
          ],
        },
      })
      .mockResolvedValueOnce({
        Items: [{ PK: 'DOG#d1', SK: 'PROFILE', dogId: 'd1', name: 'Buddy', breed: 'Labrador' }],
      });

    const res = await handler(makeEvent()) as Result;
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.userId).toBe('u1');
    expect(body.subscription.plan).toBe('proactive');
    expect(body.dogs).toHaveLength(1);
  });

  it('returns 404 when user not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Responses: { 'test-table': [] } });
    const res = await handler(makeEvent()) as Result;
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 for non-admin', async () => {
    const res = await handler(makeEvent('u1', 'owners')) as Result;
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when userId missing', async () => {
    const event = makeEvent() as any;
    event.pathParameters = {};
    const res = await handler(event) as Result;
    expect(res.statusCode).toBe(400);
  });
});
