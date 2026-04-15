/**
 * Unit tests for GET /owners/me
 */

const mockDocClientSend = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

import { handler } from '../../../src/functions/owners/getMe';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

const makeEvent = (userId = 'user-123'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    requestContext: {
      authorizer: {
        jwt: { claims: { sub: userId }, scopes: [] },
        principalId: '',
        integrationLatency: 0,
      },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const profileItem = {
  PK: 'OWNER#user-123',
  SK: 'PROFILE',
  userId: 'user-123',
  firstName: 'Joshua',
  lastName: 'Smith',
  email: 'joshua@example.com',
  pushToken: null,
  referralCode: 'FUR4X2',
  createdAt: '2026-04-15T10:00:00Z',
  updatedAt: '2026-04-15T10:00:00Z',
};

const subscriptionItem = {
  PK: 'OWNER#user-123',
  SK: 'SUBSCRIPTION',
  plan: 'welcome',
  creditBalance: 0,
  status: 'active',
  currentPeriodEnd: null,
};

describe('getMe handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'furcircle-test';
  });

  it('returns 200 with owner profile and subscription', async () => {
    mockDocClientSend.mockResolvedValue({
      Responses: {
        'furcircle-test': [profileItem, subscriptionItem],
      },
    });

    const res = await handler(makeEvent());
    expect((res as { statusCode: number }).statusCode).toBe(200);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.userId).toBe('user-123');
    expect(body.email).toBe('joshua@example.com');
    expect(body.firstName).toBe('Joshua');
    expect(body.referralCode).toBe('FUR4X2');
    expect(body.subscription.plan).toBe('welcome');
    expect(body.subscription.creditBalance).toBe(0);
    expect(body.subscription.status).toBe('active');
  });

  it('returns 404 when owner profile not found', async () => {
    mockDocClientSend.mockResolvedValue({ Responses: { 'furcircle-test': [] } });

    const res = await handler(makeEvent());
    expect((res as { statusCode: number }).statusCode).toBe(404);
    const body = JSON.parse((res as { body: string }).body);
    expect(body.error).toBe('OWNER_NOT_FOUND');
  });

  it('uses userId from JWT claims', async () => {
    mockDocClientSend.mockResolvedValue({
      Responses: { 'furcircle-test': [{ ...profileItem, userId: 'other-user' }, subscriptionItem] },
    });

    await handler(makeEvent('other-user'));

    const cmd = mockDocClientSend.mock.calls[0][0] as {
      input: { RequestItems: Record<string, { Keys: Array<{ PK: string }> }> };
    };
    const keys = cmd.input.RequestItems['furcircle-test'].Keys;
    expect(keys.every((k) => k.PK.includes('other-user'))).toBe(true);
  });

  it('returns pushToken when set', async () => {
    mockDocClientSend.mockResolvedValue({
      Responses: {
        'furcircle-test': [
          { ...profileItem, pushToken: 'ExponentPushToken[test]' },
          subscriptionItem,
        ],
      },
    });

    const res = await handler(makeEvent());
    const body = JSON.parse((res as { body: string }).body);
    expect(body.pushToken).toBe('ExponentPushToken[test]');
  });
});
