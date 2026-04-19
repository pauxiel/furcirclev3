const mockDocClientSend = jest.fn();
const mockGetStripe = jest.fn();
const mockSubscriptionsUpdate = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('../../../src/lib/stripe', () => ({
  getStripe: () => mockGetStripe(),
}));

import { handler } from '../../../src/functions/subscriptions/cancelSubscription';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (userId = 'owner-123'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    body: '{}',
    requestContext: {
      authorizer: { jwt: { claims: { sub: userId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const periodEnd = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
const subRecord = { plan: 'proactive', stripeSubscriptionId: 'sub_abc', status: 'active', currentPeriodEnd: periodEnd };

describe('cancelSubscription handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStripe.mockResolvedValue({ subscriptions: { update: mockSubscriptionsUpdate } });
    mockSubscriptionsUpdate.mockResolvedValue({ cancel_at_period_end: true });
    mockDocClientSend
      .mockResolvedValueOnce({ Item: subRecord })
      .mockResolvedValueOnce({});
  });

  it('calls Stripe with cancel_at_period_end: true', async () => {
    await handler(makeEvent());
    expect(mockSubscriptionsUpdate).toHaveBeenCalledWith('sub_abc', { cancel_at_period_end: true });
  });

  it('returns status=cancelling and cancelsAt', async () => {
    const result = (await handler(makeEvent())) as Result;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.status).toBe('cancelling');
    expect(body.cancelsAt).toBe(periodEnd);
  });

  it('returns 400 when no stripeSubscriptionId', async () => {
    mockDocClientSend.mockReset();
    mockDocClientSend.mockResolvedValueOnce({ Item: { plan: 'welcome', status: 'active' } });

    const result = (await handler(makeEvent())) as Result;

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('NO_ACTIVE_SUBSCRIPTION');
  });

  it('returns 404 when subscription record not found', async () => {
    mockDocClientSend.mockReset();
    mockDocClientSend.mockResolvedValueOnce({ Item: undefined });

    const result = (await handler(makeEvent())) as Result;

    expect(result.statusCode).toBe(404);
  });
});
