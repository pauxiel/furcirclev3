const mockDocClientSend = jest.fn();
const mockGetStripe = jest.fn();
const mockPaymentMethodsAttach = jest.fn();
const mockCustomersUpdate = jest.fn();
const mockSubscriptionsCreate = jest.fn();

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('../../../src/lib/stripe', () => ({
  getStripe: () => mockGetStripe(),
}));

import { handler } from '../../../src/functions/subscriptions/subscribeToPlan';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

type Result = { statusCode: number; body: string };

const makeEvent = (body: Record<string, unknown>, userId = 'owner-123'): APIGatewayProxyEventV2WithJWTAuthorizer =>
  ({
    body: JSON.stringify(body),
    requestContext: {
      authorizer: { jwt: { claims: { sub: userId }, scopes: [] }, principalId: '', integrationLatency: 0 },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer);

const subRecord = { plan: 'welcome', creditBalance: 0, stripeCustomerId: 'cus_123', status: 'active' };
const stripeSubResult = {
  id: 'sub_abc',
  items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 2592000 }] },
};

describe('subscribeToPlan handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetStripe.mockResolvedValue({
      paymentMethods: { attach: mockPaymentMethodsAttach },
      customers: { update: mockCustomersUpdate },
      subscriptions: { create: mockSubscriptionsCreate },
    });
    mockPaymentMethodsAttach.mockResolvedValue({});
    mockCustomersUpdate.mockResolvedValue({});
    mockSubscriptionsCreate.mockResolvedValue(stripeSubResult);
    mockDocClientSend
      .mockResolvedValueOnce({ Item: subRecord })
      .mockResolvedValueOnce({});
  });

  it('returns 400 for invalid planKey', async () => {
    const result = (await handler(makeEvent({ planKey: 'invalid', paymentMethodId: 'pm_x' }))) as Result;
    expect(result.statusCode).toBe(400);
  });

  it('returns 400 when planKey is welcome', async () => {
    const result = (await handler(makeEvent({ planKey: 'welcome', paymentMethodId: 'pm_x' }))) as Result;
    expect(result.statusCode).toBe(400);
  });

  it('returns 400 when stripeCustomerId not set', async () => {
    mockDocClientSend.mockReset();
    mockDocClientSend.mockResolvedValueOnce({ Item: { ...subRecord, stripeCustomerId: undefined } });

    const result = (await handler(makeEvent({ planKey: 'proactive', paymentMethodId: 'pm_x' }))) as Result;
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('STRIPE_CUSTOMER_REQUIRED');
  });

  it('attaches payment method and creates Stripe subscription', async () => {
    await handler(makeEvent({ planKey: 'proactive', paymentMethodId: 'pm_test' }));

    expect(mockPaymentMethodsAttach).toHaveBeenCalledWith('pm_test', { customer: 'cus_123' });
    expect(mockSubscriptionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_123' }),
    );
  });

  it('sets creditBalance=70 when subscribing to proactive', async () => {
    const result = (await handler(makeEvent({ planKey: 'proactive', paymentMethodId: 'pm_test' }))) as Result;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.plan).toBe('proactive');
    expect(body.creditBalance).toBe(70);
    expect(body.status).toBe('active');
  });

  it('sets creditBalance=0 when subscribing to protector', async () => {
    const result = (await handler(makeEvent({ planKey: 'protector', paymentMethodId: 'pm_test' }))) as Result;

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.plan).toBe('protector');
    expect(body.creditBalance).toBe(0);
  });

  it('returns 400 when paymentMethodId missing', async () => {
    const result = (await handler(makeEvent({ planKey: 'proactive' }))) as Result;
    expect(result.statusCode).toBe(400);
  });
});
