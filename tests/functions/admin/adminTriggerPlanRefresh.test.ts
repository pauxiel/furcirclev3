const mockDocClientSend = jest.fn();
const mockSfnSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));
jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn().mockImplementation(() => ({ send: (...args: unknown[]) => mockSfnSend(...args) })),
  StartExecutionCommand: jest.fn(),
}));

import { handler } from '../../../src/functions/admin/adminTriggerPlanRefresh';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (dogId = 'dog-1', groups = 'admins'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    pathParameters: { dogId },
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
  mockSfnSend.mockReset();
  process.env['TABLE_NAME'] = 'test-table';
  process.env['STATE_MACHINE_ARN'] = 'arn:aws:states:us-east-1:123:stateMachine:furcircle-plan';
});

describe('adminTriggerPlanRefresh', () => {
  it('triggers Step Functions and marks dog planStatus=generating', async () => {
    mockDocClientSend
      .mockResolvedValueOnce({ Item: { PK: 'DOG#dog-1', SK: 'PROFILE', dogId: 'dog-1', ownerId: 'u1', name: 'Buddy' } })
      .mockResolvedValueOnce({});
    mockSfnSend.mockResolvedValueOnce({ executionArn: 'arn:aws:states:...' });

    const res = await handler(makeEvent()) as Result;
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.dogId).toBe('dog-1');
    expect(body.planStatus).toBe('generating');
  });

  it('returns 404 when dog not found', async () => {
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });
    const res = await handler(makeEvent()) as Result;
    expect(res.statusCode).toBe(404);
  });

  it('returns 403 for non-admin', async () => {
    const res = await handler(makeEvent('dog-1', 'owners')) as Result;
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when dogId missing', async () => {
    const event = makeEvent() as any;
    event.pathParameters = {};
    const res = await handler(event) as Result;
    expect(res.statusCode).toBe(400);
  });
});
