/**
 * Unit tests for PUT /owners/me
 */

const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/owners/updateMe';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

const makeEvent = (body: Record<string, unknown>, userId = 'user-123'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    body: JSON.stringify(body),
    requestContext: {
      authorizer: {
        jwt: { claims: { sub: userId }, scopes: [] },
        principalId: '',
        integrationLatency: 0,
      },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const updatedAttributes = {
  PK: 'OWNER#user-123',
  SK: 'PROFILE',
  userId: 'user-123',
  firstName: 'Josh',
  lastName: 'Smith',
  email: 'joshua@example.com',
  pushToken: 'ExponentPushToken[test123]',
  updatedAt: '2026-04-15T11:00:00Z',
};

describe('updateMe handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('updates pushToken and returns 200', async () => {
    mockDocClientSend.mockResolvedValue({ Attributes: updatedAttributes });

    const res = await handler(makeEvent({ pushToken: 'ExponentPushToken[test123]' }));

    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.pushToken).toBe('ExponentPushToken[test123]');
    expect(body.userId).toBe('user-123');
  });

  it('ignores unknown fields — does not write them', async () => {
    mockDocClientSend.mockResolvedValue({ Attributes: updatedAttributes });

    await handler(makeEvent({ pushToken: 'ExponentPushToken[abc]', secretField: 'injected', plan: 'pro' }));

    const cmd = mockDocClientSend.mock.calls[0][0] as {
      input: { ExpressionAttributeNames: Record<string, string> };
    };
    const writtenFields = Object.values(cmd.input.ExpressionAttributeNames);
    expect(writtenFields).not.toContain('secretField');
    expect(writtenFields).not.toContain('plan');
    expect(writtenFields).toContain('pushToken');
  });

  it('returns 400 when no valid fields provided', async () => {
    const res = await handler(makeEvent({ unknownField: 'x' }));
    expect((res as { statusCode: number }).statusCode).toBe(400);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when owner does not exist (ConditionalCheckFailedException)', async () => {
    const err = Object.assign(new Error('ConditionalCheckFailed'), {
      name: 'ConditionalCheckFailedException',
    });
    mockDocClientSend.mockRejectedValue(err);

    const res = await handler(makeEvent({ firstName: 'Josh' }));
    expect((res as { statusCode: number }).statusCode).toBe(404);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.error).toBe('OWNER_NOT_FOUND');
  });

  it('rethrows unexpected DynamoDB errors', async () => {
    mockDocClientSend.mockRejectedValue(new Error('ProvisionedThroughputExceededException'));

    await expect(
      handler(makeEvent({ firstName: 'Josh' })),
    ).rejects.toThrow('ProvisionedThroughputExceededException');
  });

  it('returns 400 for malformed JSON body', async () => {
    const event = {
      body: 'not-json{{{',
      requestContext: {
        authorizer: { jwt: { claims: { sub: 'user-123' }, scopes: [] }, principalId: '', integrationLatency: 0 },
      },
    } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;

    const res = await handler(event);
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('builds UpdateExpression with only provided allowed fields', async () => {
    mockDocClientSend.mockResolvedValue({ Attributes: updatedAttributes });

    await handler(makeEvent({ firstName: 'Josh', lastName: 'Smith' }));

    const cmd = mockDocClientSend.mock.calls[0][0] as {
      input: {
        UpdateExpression: string;
        ConditionExpression: string;
        ExpressionAttributeNames: Record<string, string>;
      };
    };
    expect(cmd.input.UpdateExpression).toContain('firstName');
    expect(cmd.input.UpdateExpression).toContain('lastName');
    expect(cmd.input.UpdateExpression).toContain('updatedAt');
    expect(cmd.input.ConditionExpression).toBe('attribute_exists(PK)');
  });
});
